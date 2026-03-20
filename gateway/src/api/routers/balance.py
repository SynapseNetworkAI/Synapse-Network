from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request
from typing import Dict, Any, Annotated, Optional

from src.api.deps import get_balance_service, get_provider_analytics_service
from src.api.schemas.pydantic_models import (
    AdminProviderWithdrawReviewRequest,
    AdminProviderWithdrawCompleteRequest,
    AdminRefundCompleteRequest,
    DepositIntentRequest,
    DepositAttemptRequest,
    DepositConfirmRequest,
    AdminDepositReplayRequest,
    RefundIntentRequest,
    RefundCompleteRequest,
    RouterConfigRequest,
    ProviderWithdrawIntentRequest,
    ProviderWithdrawCompleteRequest,
    TX_HASH_FORMAT_ERROR,
    TX_HASH_PREFIX_ERROR,
)
from src.services.platform.balance_service import BalanceService
from src.services.provider.provider_analytics_service import ProviderAnalyticsService
from src.services.platform import credential_service
from src.services.platform.internal_auth import InternalServicePrincipal, require_internal_scope
from src.services.platform.tasks.deposit_indexer import (
    get_indexer_status,
    replay_deposit_tx,
)
from src.core.common import normalize_wallet
from src.core.config import settings
from src.domain.finance import UsageLogRow
from src.storage import get_storage, BaseStorage

router = APIRouter()

AuthorizationHeader = Annotated[Optional[str], Header(alias="Authorization")]
UserAddressHeader = Annotated[Optional[str], Header(alias="X-User-Address")]


def get_owner_wallet(
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
) -> str:
    return credential_service.require_owner_wallet(authorization, x_user_address)


def _extract_request_meta(request: Request) -> Dict[str, Any]:
    client_host = request.client.host if request.client else ""
    return {
        "requestId": request.headers.get("X-Request-Id") or "",
        "clientIp": client_host,
        "userAgent": request.headers.get("User-Agent") or "",
    }


def _normalize_tx_hash_or_400(value: str) -> str:
    normalized = str(value or "").strip().lower()
    if not normalized.startswith("0x"):
        raise HTTPException(
            status_code=400,
            detail={"code": "INVALID_TX_HASH", "message": TX_HASH_PREFIX_ERROR},
        )
    hex_part = normalized[2:]
    if len(hex_part) != 64 or any(ch not in "0123456789abcdef" for ch in hex_part):
        raise HTTPException(
            status_code=400,
            detail={"code": "INVALID_TX_HASH", "message": TX_HASH_FORMAT_ERROR},
        )
    return normalized


def _ensure_fee_policy_admin(owner_wallet: str) -> str:
    owner = normalize_wallet(owner_wallet)
    admins = settings.platform_fee_admin_wallets
    if admins:
        if owner not in admins:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "FORBIDDEN",
                    "message": "Only fee policy admins can access this endpoint",
                },
            )
        return owner

    # Developer fallback for local environments: if allow-list is empty,
    # permit authenticated owner in development only.
    if str(settings.environment).lower() != "development":
        raise HTTPException(
            status_code=403,
            detail={
                "code": "FEE_ADMIN_NOT_CONFIGURED",
                "message": "PLATFORM_FEE_ADMIN_WALLETS must be configured in non-development environments",
            },
        )
    return owner


def _ensure_indexer_admin(owner_wallet: str) -> str:
    owner = normalize_wallet(owner_wallet)
    admins = set(settings.indexer_admin_wallets)
    if not admins:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "INDEXER_ADMIN_NOT_CONFIGURED",
                "message": "INDEXER_ADMIN_WALLETS (or PLATFORM_FEE_ADMIN_WALLETS) must be configured",
            },
        )
    if owner not in admins:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "FORBIDDEN",
                "message": "Only indexer admins can access this endpoint",
            },
        )
    return owner


def _clamp_rate(value: Any, fallback: Optional[float] = None) -> float:
    if value is None:
        if fallback is None:
            raise ValueError("rate is required")
        return float(fallback)
    try:
        rate = float(value)
    except Exception:
        raise ValueError("rate must be a number")
    if rate < 0 or rate > 1:
        raise ValueError("rate must be within [0,1]")
    return float(rate)


def _usage_log_sort_key(row: UsageLogRow) -> tuple[int, str]:
    return (int(row.ts or 0), str(row.id or ""))


def _usage_log_matches_query(row: UsageLogRow, query: str) -> bool:
    needle = str(query or "").strip().lower()
    if not needle:
        return True
    haystacks = [
        str(row.id or "").lower(),
        str(row.agent_id or "").lower(),
        str(row.request_id or "").lower(),
        str(row.origin_request_id or "").lower(),
        str(row.service_id or "").lower(),
        str(row.consumer_address or "").lower(),
        str(row.provider_address or "").lower(),
        str(row.status or "").lower(),
    ]
    return any(needle in value for value in haystacks if value)


def _normalize_usage_log_rows(raw_rows: Any) -> list[UsageLogRow]:
    rows: list[UsageLogRow] = []
    if not isinstance(raw_rows, list):
        return rows
    for row in raw_rows:
        if isinstance(row, UsageLogRow):
            rows.append(row)
        elif isinstance(row, dict):
            rows.append(UsageLogRow.model_validate(row))
    return rows


def _filter_owner_usage_logs(
    rows: list[UsageLogRow],
    owner_wallet: str,
    status: Optional[str],
    query: Optional[str],
) -> list[UsageLogRow]:
    owner = str(owner_wallet or "").lower()
    normalized_status = str(status or "").strip().lower()
    filtered: list[UsageLogRow] = []
    for row in rows:
        owner_address = str(row.consumer_address or "").lower()
        provider_address = str(row.provider_address or "").lower()
        if owner_address != owner and provider_address != owner:
            continue
        if normalized_status and str(row.status or "").strip().lower() != normalized_status:
            continue
        if not _usage_log_matches_query(row, str(query or "")):
            continue
        filtered.append(row)
    filtered.sort(key=_usage_log_sort_key, reverse=True)
    return filtered


def _build_usage_logs_response(
    rows: list[UsageLogRow],
    *,
    total: int,
    page: int,
    page_size: int,
    has_more: bool,
) -> dict[str, Any]:
    return {
        "status": "success",
        "logs": [row.model_dump(by_alias=True, mode="json") for row in rows],
        "count": len(rows),
        "total": total,
        "page": page,
        "pageSize": page_size,
        "hasMore": has_more,
    }


def _normalize_fee_policy_payload(
    payload: Dict[str, Any], default_fallback: float
) -> Dict[str, Any]:
    default_rate = _clamp_rate(payload.get("defaultRate"), default_fallback)
    owner_rates_raw = payload.get("ownerRates")
    if owner_rates_raw is None:
        owner_rates_raw = {}
    if not isinstance(owner_rates_raw, dict):
        raise ValueError("ownerRates must be an object")

    owner_rates: Dict[str, float] = {}
    for key, value in owner_rates_raw.items():
        owner = normalize_wallet(str(key or ""))
        if not owner:
            raise ValueError("ownerRates contains invalid wallet key")
        owner_rates[owner] = _clamp_rate(value)

    return {
        "defaultRate": default_rate,
        "ownerRates": owner_rates,
    }


@router.get("/v1/balance", responses={500: {"description": "Database IO blocked"}})
async def get_balance(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    """[极速路由] 获取当前会话 owner 的余额摘要。"""
    try:
        balance_data = await service.get_balance(owner_wallet)
        return {"status": "success", "balance": balance_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database IO blocked: {str(e)}")


@router.post("/v1/balance/deposit/intent")
async def register_deposit_intent(
    intent: DepositIntentRequest,
    request: Request,
    idempotency_key: Annotated[
        str, Header(alias="X-Idempotency-Key", min_length=16, max_length=128)
    ],
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    """登记 owner 充值意图，owner 由 session 决定。"""
    stored_intent = await service.register_deposit_intent(
        intent.model_dump(),
        owner_wallet,
        idempotency_key,
        _extract_request_meta(request),
    )
    return {
        "status": "success",
        "tx_hash": str(stored_intent.get("txHash", "mock-tx-hash")),
        "intent": stored_intent,
    }


@router.post("/v1/balance/deposit/attempts")
async def record_deposit_attempt(
    payload: DepositAttemptRequest,
    request: Request,
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    saved_attempt = await service.record_deposit_attempt(
        payload.model_dump(),
        owner_wallet,
        _extract_request_meta(request),
    )
    return {
        "status": "success",
        "attempt": saved_attempt,
    }


@router.get("/v1/balance/deposit/intents")
async def list_deposit_intents(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    intents = await service.list_deposit_intents(owner_wallet)
    return {"status": "success", "intents": intents[:limit]}


@router.get(
    "/v1/balance/deposit/sync",
    responses={400: {"description": "Invalid txHash"}},
)
async def get_deposit_sync_status(
    tx_hash: Annotated[
        str, Query(alias="txHash", min_length=66, max_length=66)
    ],
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    sync_status = await service.get_deposit_sync_status(
        owner_wallet,
        _normalize_tx_hash_or_400(tx_hash),
    )
    return {"status": "success", "sync": sync_status}


@router.post("/v1/balance/deposit/intents/{deposit_intent_id}/confirm")
async def confirm_deposit_intent(
    deposit_intent_id: str,
    payload: DepositConfirmRequest,
    request: Request,
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    confirmed = await service.confirm_deposit_intent(
        owner_wallet=owner_wallet,
        deposit_intent_id=deposit_intent_id,
        event_key=payload.eventKey,
        confirmations=payload.confirmations,
        request_meta=_extract_request_meta(request),
    )
    return {"status": "success", "intent": confirmed}


@router.post("/v1/refund")
async def process_refund(
    refund_req: RefundIntentRequest,
    request: Request,
    idempotency_key: Annotated[
        str, Header(alias="X-Idempotency-Key", min_length=16, max_length=128)
    ],
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    result = await service.process_refund_intent(
        refund_req.model_dump(),
        owner_wallet,
        idempotency_key,
        _extract_request_meta(request),
    )
    return {"status": "success", "ownerAddress": owner_wallet, **result}


@router.get("/v1/refunds")
async def list_refunds(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
):
    rows = await service.list_refunds(owner_wallet)
    return {"status": "success", "ownerAddress": owner_wallet, "refunds": rows[:limit]}


@router.post("/v1/refunds/{refund_id}/complete")
async def complete_refund(
    refund_id: str,
    payload: RefundCompleteRequest,
    request: Request,
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    request_meta = _extract_request_meta(request)
    review_meta = {
        "decision": str(payload.reviewDecision or "").strip().upper(),
        "reviewerAddress": str(payload.reviewerAddress or "").strip().lower(),
        "reviewerNote": str(payload.reviewerNote or "").strip(),
    }
    if any(review_meta.values()):
        request_meta["review"] = review_meta
    result = await service.complete_refund_intent(
        owner_wallet=owner_wallet,
        refund_id=refund_id,
        tx_hash=payload.txHash,
        request_meta=request_meta,
    )
    return {"status": "success", "ownerAddress": owner_wallet, **result}


@router.post(
    "/v1/admin/refunds/{refund_id}/complete",
    responses={403: {"description": "Forbidden or fee admin not configured"}},
)
async def complete_refund_as_admin(
    refund_id: str,
    payload: AdminRefundCompleteRequest,
    request: Request,
    principal: Annotated[InternalServicePrincipal, Depends(require_internal_scope("refund.complete"))],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    admin_wallet = _ensure_fee_policy_admin(principal.admin_wallet)
    target_owner = normalize_wallet(payload.ownerAddress)
    request_meta = _extract_request_meta(request)
    request_meta["review"] = {
        "decision": str(payload.reviewDecision or "APPROVE").strip().upper(),
        "reviewerAddress": str(payload.reviewerAddress or admin_wallet).strip().lower(),
        "reviewerNote": str(payload.reviewerNote or "").strip(),
        "requestedBy": admin_wallet,
        "actorAdminId": principal.actor_admin_id,
        "actorRole": principal.actor_role,
    }
    request_meta["adminExecution"] = {
        "requestedBy": admin_wallet,
        "targetOwner": target_owner,
        "resourceId": refund_id,
        "actorAdminId": principal.actor_admin_id,
        "actorRole": principal.actor_role,
        "serviceSubject": principal.service_subject,
    }
    result = await service.complete_refund_intent(
        owner_wallet=target_owner,
        refund_id=refund_id,
        tx_hash=payload.txHash,
        request_meta=request_meta,
    )
    return {
        "status": "success",
        "requestedBy": admin_wallet,
        "ownerAddress": target_owner,
        "refundId": result.get("refundId"),
        "refundStatus": result.get("status"),
        "txHash": result.get("txHash"),
    }


@router.get("/v1/router/config")
async def get_router_config(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    config = await service.get_router_config(owner_wallet)
    return {"status": "success", "ownerAddress": owner_wallet, "config": config}


@router.post("/v1/router/config")
async def set_router_config(
    config: RouterConfigRequest,
    request: Request,
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    saved = await service.set_router_config(
        owner_wallet, config.dailyLimitUsdc, _extract_request_meta(request)
    )
    return {"status": "success", "ownerAddress": owner_wallet, "config": saved}


@router.get("/v1/finance/audit-logs")
async def list_finance_audit_logs(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
):
    rows = await service.list_finance_audit_logs(owner_wallet, limit)
    return {
        "status": "success",
        "ownerAddress": owner_wallet,
        "logs": rows,
        "count": len(rows),
    }


@router.get("/v1/usage/logs")
async def get_usage_logs(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    storage: Annotated[BaseStorage, Depends(get_storage)],
    limit: Annotated[Optional[int], Query(ge=1, le=500)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=100)] = 20,
    status: Annotated[Optional[str], Query(min_length=1, max_length=32)] = None,
    query: Annotated[Optional[str], Query(min_length=1, max_length=128)] = None,
):
    raw_rows = storage.get_data_manager().system.gateway_state.read_invocation_billing_rows()
    rows = _normalize_usage_log_rows(raw_rows)
    filtered = _filter_owner_usage_logs(rows, owner_wallet, status, query)

    if limit is not None:
        page_rows = filtered[:limit]
        return _build_usage_logs_response(
            page_rows,
            total=len(filtered),
            page=1,
            page_size=limit,
            has_more=len(filtered) > limit,
        )

    start = (page - 1) * page_size
    end = start + page_size
    page_rows = filtered[start:end]
    return _build_usage_logs_response(
        page_rows,
        total=len(filtered),
        page=page,
        page_size=page_size,
        has_more=end < len(filtered),
    )


@router.get("/v1/providers/earnings/summary")
async def get_provider_earnings_summary(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    analytics_service: Annotated[
        ProviderAnalyticsService, Depends(get_provider_analytics_service)
    ],
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
):
    summary = analytics_service.get_provider_earnings_summary(owner_wallet, limit)
    return {
        "status": "success",
        "summary": summary,
    }


@router.post("/v1/providers/withdrawals/intent")
async def create_provider_withdraw_intent(
    payload: ProviderWithdrawIntentRequest,
    request: Request,
    idempotency_key: Annotated[
        str, Header(alias="X-Idempotency-Key", min_length=16, max_length=128)
    ],
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    result = await service.create_provider_withdraw_intent(
        payload.model_dump(),
        owner_wallet,
        idempotency_key,
        _extract_request_meta(request),
    )
    return {"status": "success", "ownerAddress": owner_wallet, **result}


@router.get("/v1/providers/withdrawals")
async def list_provider_withdrawals(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
):
    rows = await service.list_provider_withdrawals(owner_wallet)
    return {
        "status": "success",
        "ownerAddress": owner_wallet,
        "withdrawals": rows[:limit],
    }


@router.get("/v1/providers/withdrawals/capability")
async def get_provider_withdraw_capability(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    capability = await service.get_provider_withdraw_capability(owner_wallet)
    return {
        "status": "success",
        "ownerAddress": owner_wallet,
        **capability,
    }


@router.post("/v1/providers/withdrawals/{withdrawal_id}/complete")
async def complete_provider_withdrawal(
    withdrawal_id: str,
    payload: ProviderWithdrawCompleteRequest,
    request: Request,
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    result = await service.complete_provider_withdrawal(
        owner_wallet=owner_wallet,
        withdrawal_id=withdrawal_id,
        tx_hash=payload.txHash,
        request_meta=_extract_request_meta(request),
    )
    return {"status": "success", "ownerAddress": owner_wallet, **result}


@router.post(
    "/v1/admin/providers/withdrawals/{withdrawal_id}/complete",
    responses={403: {"description": "Forbidden or fee admin not configured"}},
)
async def complete_provider_withdrawal_as_admin(
    withdrawal_id: str,
    payload: AdminProviderWithdrawCompleteRequest,
    request: Request,
    principal: Annotated[InternalServicePrincipal, Depends(require_internal_scope("provider_withdraw.complete"))],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    admin_wallet = _ensure_fee_policy_admin(principal.admin_wallet)
    target_owner = normalize_wallet(payload.ownerAddress)
    request_meta = _extract_request_meta(request)
    request_meta["adminExecution"] = {
        "requestedBy": admin_wallet,
        "targetOwner": target_owner,
        "resourceId": withdrawal_id,
        "actorAdminId": principal.actor_admin_id,
        "actorRole": principal.actor_role,
        "serviceSubject": principal.service_subject,
    }
    result = await service.complete_provider_withdrawal(
        owner_wallet=target_owner,
        withdrawal_id=withdrawal_id,
        tx_hash=payload.txHash,
        request_meta=request_meta,
    )
    return {
        "status": "success",
        "requestedBy": admin_wallet,
        "ownerAddress": target_owner,
        "withdrawalId": result.get("withdrawalId"),
        "withdrawalStatus": result.get("status"),
        "txHash": result.get("txHash"),
    }


@router.post(
    "/v1/admin/providers/withdrawals/{withdrawal_id}/review",
    responses={403: {"description": "Forbidden or fee admin not configured"}},
)
async def review_provider_withdrawal_as_admin(
    withdrawal_id: str,
    payload: AdminProviderWithdrawReviewRequest,
    request: Request,
    principal: Annotated[InternalServicePrincipal, Depends(require_internal_scope("provider_withdraw.review"))],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    admin_wallet = _ensure_fee_policy_admin(principal.admin_wallet)
    target_owner = normalize_wallet(payload.ownerAddress)
    request_meta = _extract_request_meta(request)
    request_meta["review"] = {
        "decision": str(payload.reviewDecision or "").strip().upper(),
        "reviewerAddress": str(payload.reviewerAddress or admin_wallet).strip().lower(),
        "reviewerNote": str(payload.reviewerNote or "").strip(),
        "requestedBy": admin_wallet,
        "actorAdminId": principal.actor_admin_id,
        "actorRole": principal.actor_role,
    }
    request_meta["adminExecution"] = {
        "requestedBy": admin_wallet,
        "targetOwner": target_owner,
        "resourceId": withdrawal_id,
        "actorAdminId": principal.actor_admin_id,
        "actorRole": principal.actor_role,
        "serviceSubject": principal.service_subject,
    }
    result = await service.review_provider_withdrawal(
        owner_wallet=target_owner,
        withdrawal_id=withdrawal_id,
        request_meta=request_meta,
    )
    return {
        "status": "success",
        "requestedBy": admin_wallet,
        "ownerAddress": target_owner,
        **result,
    }


@router.get(
    "/v1/indexer/status",
    responses={403: {"description": "Forbidden or indexer admin not configured"}},
)
async def get_v2_indexer_status(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
):
    _ = _ensure_indexer_admin(owner_wallet)
    return {
        "status": "success",
        "indexer": get_indexer_status(),
    }


@router.get(
    "/v1/admin/fee-policy",
    responses={403: {"description": "Forbidden or fee admin not configured"}},
)
async def get_fee_policy(
    principal: Annotated[InternalServicePrincipal, Depends(require_internal_scope("fee_policy.read"))],
    storage: Annotated[BaseStorage, Depends(get_storage)],
):
    admin_wallet = _ensure_fee_policy_admin(principal.admin_wallet)
    policy = storage.get_data_manager().finance.fee_policy.get_platform_fee_policy()

    normalized = _normalize_fee_policy_payload(
        {"defaultRate": policy.default_rate, "ownerRates": policy.owner_rates},
        settings.platform_fee_rate,
    )
    response = {
        "status": "success",
        "requestedBy": admin_wallet,
        "policy": {
            **normalized,
            "updatedAt": policy.updated_at,
            "updatedBy": policy.updated_by,
        },
    }
    return response


@router.put(
    "/v1/admin/fee-policy",
    responses={
        400: {"description": "Invalid fee policy payload"},
        403: {"description": "Forbidden or fee admin not configured"},
    },
)
async def set_fee_policy(
    payload: Dict[str, Any],
    principal: Annotated[InternalServicePrincipal, Depends(require_internal_scope("fee_policy.write"))],
    storage: Annotated[BaseStorage, Depends(get_storage)],
):
    admin_wallet = _ensure_fee_policy_admin(principal.admin_wallet)
    try:
        normalized = _normalize_fee_policy_payload(
            payload if isinstance(payload, dict) else {}, settings.platform_fee_rate
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail={"code": "INVALID_FEE_POLICY", "message": str(exc)}
        )

    saved = {
        **normalized,
        "updatedAt": credential_service.now_ts(),
        "updatedBy": admin_wallet,
    }
    storage.get_data_manager().finance.fee_policy.set_platform_fee_policy(
        default_rate=float(saved.get("defaultRate") or 0.0),
        owner_rates=saved.get("ownerRates")
        if isinstance(saved.get("ownerRates"), dict)
        else {},
        updated_by=admin_wallet,
        updated_at=int(saved.get("updatedAt") or credential_service.now_ts()),
    )
    return {
        "status": "success",
        "requestedBy": admin_wallet,
        "policy": saved,
    }


@router.post(
    "/v1/admin/deposits/replay",
    responses={
        400: {"description": "Invalid replay payload"},
        403: {"description": "Forbidden or fee admin not configured"},
        404: {"description": "Deposit event not found"},
        409: {"description": "Tx not confirmed or cannot be replayed"},
    },
)
async def replay_deposit_by_tx_hash(
    payload: AdminDepositReplayRequest,
    principal: Annotated[InternalServicePrincipal, Depends(require_internal_scope("deposit.replay"))],
    storage: Annotated[BaseStorage, Depends(get_storage)],
):
    admin_wallet = _ensure_fee_policy_admin(principal.admin_wallet)
    try:
        summary = replay_deposit_tx(storage, payload.txHash, admin_wallet)
    except ValueError as exc:
        if str(exc) == "INVALID_TX_HASH":
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_TX_HASH",
                    "message": "txHash must be a valid 0x-prefixed hash.",
                },
            )
        raise
    except RuntimeError as exc:
        code = str(exc)
        if code == "TX_NOT_CONFIRMED":
            raise HTTPException(
                status_code=409,
                detail={"code": code, "message": "Transaction is not confirmed yet."},
            )
        if code == "TX_FAILED":
            raise HTTPException(
                status_code=409,
                detail={
                    "code": code,
                    "message": "Transaction failed on-chain and cannot be credited.",
                },
            )
        if code == "MISSING_TX_RECEIPT":
            raise HTTPException(
                status_code=409,
                detail={"code": code, "message": "Transaction receipt is unavailable."},
            )
        if code == "NO_MATCHING_DEPOSIT_EVENT":
            raise HTTPException(
                status_code=404,
                detail={
                    "code": code,
                    "message": "No router deposit event found for this tx hash.",
                },
            )
        raise

    return {
        "status": "success",
        "requestedBy": admin_wallet,
        "replay": summary,
    }
