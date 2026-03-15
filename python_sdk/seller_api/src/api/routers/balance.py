from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request
from typing import Dict, Any, Annotated, Optional

from src.api.deps import get_balance_service, get_provider_analytics_service
from src.models.pydantic_models import (
    DepositIntentRequest,
    DepositConfirmRequest,
    RefundIntentRequest,
    RefundCompleteRequest,
    RouterConfigRequest,
    ProviderWithdrawIntentRequest,
    ProviderWithdrawCompleteRequest,
)
from src.services.platform.balance_service import BalanceService
from src.services.seller.provider_analytics_service import ProviderAnalyticsService
from src.services.platform import credential_service
from src.services.platform.v2_indexer import get_indexer_status
from src.storage.repository_provider import fee_policy_repo, gateway_state_repo
from src.core.common import normalize_wallet
from src.core.config import settings
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


def _ensure_fee_policy_admin(owner_wallet: str) -> str:
    owner = normalize_wallet(owner_wallet)
    admins = settings.platform_fee_admin_wallets
    if admins:
        if owner not in admins:
            raise HTTPException(
                status_code=403,
                detail={"code": "FORBIDDEN", "message": "Only fee policy admins can access this endpoint"},
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


def _normalize_fee_policy_payload(payload: Dict[str, Any], default_fallback: float) -> Dict[str, Any]:
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
    idempotency_key: Annotated[str, Header(alias="X-Idempotency-Key", min_length=16, max_length=128)],
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    """登记 owner 充值意图，owner 由 session 决定。"""
    stored_intent = await service.register_deposit_intent(
        intent.model_dump(), owner_wallet, idempotency_key, _extract_request_meta(request)
    )
    return {
        "status": "success",
        "tx_hash": str(stored_intent.get("txHash", "mock-tx-hash")),
        "intent": stored_intent,
    }


@router.get("/v1/balance/deposit/intents")
async def list_deposit_intents(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    intents = await service.list_deposit_intents(owner_wallet)
    return {"status": "success", "intents": intents[:limit]}


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
    idempotency_key: Annotated[str, Header(alias="X-Idempotency-Key", min_length=16, max_length=128)],
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    result = await service.process_refund_intent(
        refund_req.model_dump(), owner_wallet, idempotency_key, _extract_request_meta(request)
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
    saved = await service.set_router_config(owner_wallet, config.dailyLimitUsdc, _extract_request_meta(request))
    return {"status": "success", "ownerAddress": owner_wallet, "config": saved}


@router.get("/v1/finance/audit-logs")
async def list_finance_audit_logs(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
):
    rows = await service.list_finance_audit_logs(owner_wallet, limit)
    return {"status": "success", "ownerAddress": owner_wallet, "logs": rows, "count": len(rows)}


@router.get("/v1/usage/logs")
async def get_usage_logs(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    storage: Annotated[BaseStorage, Depends(get_storage)],
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
):
    raw_rows = gateway_state_repo(storage).read_usage_log_rows()
    rows = [row for row in raw_rows if isinstance(row, dict)] if isinstance(raw_rows, list) else []
    owner = owner_wallet.lower()
    filtered = []
    for row in rows:
        buyer = str(row.get("buyer") or "").lower()
        seller = str(row.get("seller") or "").lower()
        if buyer == owner or seller == owner:
            filtered.append(row)

    return {
        "status": "success",
        "logs": filtered[:limit],
        "count": len(filtered[:limit]),
    }


@router.get("/v1/providers/earnings/summary")
async def get_provider_earnings_summary(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    analytics_service: Annotated[ProviderAnalyticsService, Depends(get_provider_analytics_service)],
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
    idempotency_key: Annotated[str, Header(alias="X-Idempotency-Key", min_length=16, max_length=128)],
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    result = await service.create_provider_withdraw_intent(
        payload.model_dump(), owner_wallet, idempotency_key, _extract_request_meta(request)
    )
    return {"status": "success", "ownerAddress": owner_wallet, **result}


@router.get("/v1/providers/withdrawals")
async def list_provider_withdrawals(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
):
    rows = await service.list_provider_withdrawals(owner_wallet)
    return {"status": "success", "ownerAddress": owner_wallet, "withdrawals": rows[:limit]}


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


@router.get("/v1/indexer/status")
async def get_v2_indexer_status():
    return {
        "status": "success",
        "indexer": get_indexer_status(),
    }


@router.get(
    "/v1/admin/fee-policy",
    responses={403: {"description": "Forbidden or fee admin not configured"}},
)
async def get_fee_policy(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    storage: Annotated[BaseStorage, Depends(get_storage)],
):
    admin_wallet = _ensure_fee_policy_admin(owner_wallet)
    raw = fee_policy_repo(storage).get_platform_fee_policy() or {}
    if not isinstance(raw, dict):
        raw = {}

    normalized = _normalize_fee_policy_payload(raw, settings.platform_fee_rate)
    response = {
        "status": "success",
        "requestedBy": admin_wallet,
        "policy": {
            **normalized,
            "updatedAt": raw.get("updatedAt"),
            "updatedBy": raw.get("updatedBy"),
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
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    storage: Annotated[BaseStorage, Depends(get_storage)],
):
    admin_wallet = _ensure_fee_policy_admin(owner_wallet)
    try:
        normalized = _normalize_fee_policy_payload(payload if isinstance(payload, dict) else {}, settings.platform_fee_rate)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"code": "INVALID_FEE_POLICY", "message": str(exc)})

    saved = {
        **normalized,
        "updatedAt": credential_service.now_ts(),
        "updatedBy": admin_wallet,
    }
    fee_policy_repo(storage).set_platform_fee_policy(
        default_rate=float(saved.get("defaultRate") or 0.0),
        owner_rates=saved.get("ownerRates") if isinstance(saved.get("ownerRates"), dict) else {},
        updated_by=admin_wallet,
        updated_at=int(saved.get("updatedAt") or credential_service.now_ts()),
    )
    return {
        "status": "success",
        "requestedBy": admin_wallet,
        "policy": saved,
    }
