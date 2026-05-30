"""Spending limit, voucher, audit log, usage log, fee policy and indexer admin routes."""
from typing import Any, Annotated, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request

from src.api.deps import get_balance_service
from src.api.routers.balance_helpers import (
    BalanceService,
    AdminDepositReplayRequest,
    OwnerSpendLimitUpdateRequest,
    VoucherRedeemRequest,
    InternalServicePrincipal,
    require_internal_scope,
    get_owner_wallet,
    _extract_request_meta,
    _ensure_fee_policy_admin,
    _ensure_indexer_admin,
    _normalize_usage_log_rows,
    _filter_owner_usage_logs,
    _build_usage_logs_response,
    _normalize_fee_policy_payload,
    settings,
    credential_service,
    get_indexer_status,
    replay_deposit_tx,
    BaseStorage,
    get_storage,
)
from src.services.platform.business_policy import (
    build_env_config_summary,
    get_business_policy_snapshot,
    publish_business_policy_snapshot,
    validate_business_policy_payload,
)
from src.utils.datetime_utils import now_dt_str

router = APIRouter()


@router.get("/v1/balance/spending-limit")
async def get_owner_spending_limit(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    spending_limit = await service.get_owner_spending_limit(owner_wallet)
    return {
        "status": "success",
        "ownerAddress": owner_wallet,
        "spendingLimit": spending_limit,
    }


@router.put("/v1/balance/spending-limit")
async def set_owner_spending_limit(
    payload: OwnerSpendLimitUpdateRequest,
    request: Request,
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    saved = await service.set_owner_spending_limit(
        owner_wallet=owner_wallet,
        spending_limit_usdc=payload.spendingLimitUsdc,
        allow_unlimited=payload.allowUnlimited,
        request_meta=_extract_request_meta(request),
    )
    return {
        "status": "success",
        "ownerAddress": owner_wallet,
        "spendingLimit": saved,
    }


@router.post("/v1/balance/vouchers/redeem")
async def redeem_credit_voucher(
    payload: VoucherRedeemRequest,
    request: Request,
    idempotency_key: Annotated[
        str, Header(alias="X-Idempotency-Key", min_length=16, max_length=128)
    ],
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    result = await service.redeem_credit_voucher(
        owner_wallet=owner_wallet,
        voucher_code=payload.voucherCode,
        idempotency_key=idempotency_key,
        request_meta=_extract_request_meta(request),
    )
    return {
        "status": "success",
        "ownerAddress": owner_wallet,
        **result,
    }


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


@router.get("/v1/finance/risk-overview")
async def get_risk_overview(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    overview = await service.get_risk_overview(owner_wallet)
    return {
        "status": "success",
        "ownerAddress": owner_wallet,
        "overview": overview,
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
    return {
        "status": "success",
        "requestedBy": admin_wallet,
        "policy": {
            **normalized,
            "updatedAt": policy.updated_at,
            "updatedBy": policy.updated_by,
        },
    }


@router.put(
    "/v1/admin/fee-policy",
    responses={
        400: {"description": "Invalid fee policy payload"},
        403: {"description": "Forbidden or fee admin not configured"},
    },
)
async def set_fee_policy(
    payload: dict[str, Any],
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
        ) from exc

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


@router.get(
    "/v1/admin/business-policy",
    responses={403: {"description": "Forbidden or fee admin not configured"}},
)
async def get_business_policy(
    principal: Annotated[
        InternalServicePrincipal, Depends(require_internal_scope("business_policy.read"))
    ],
    storage: Annotated[BaseStorage, Depends(get_storage)],
):
    admin_wallet = _ensure_fee_policy_admin(principal.admin_wallet)
    snapshot = get_business_policy_snapshot(storage)
    return {
        "status": "success",
        "requestedBy": admin_wallet,
        "policy": snapshot.payload,
        "source": snapshot.source,
        "publishedVersion": snapshot.published_version,
        "updatedAt": snapshot.updated_at,
        "updatedBy": snapshot.updated_by,
    }


@router.put(
    "/v1/admin/business-policy",
    responses={
        400: {"description": "Invalid business policy payload"},
        403: {"description": "Forbidden or fee admin not configured"},
    },
)
async def set_business_policy(
    payload: dict[str, Any],
    principal: Annotated[
        InternalServicePrincipal, Depends(require_internal_scope("business_policy.write"))
    ],
    storage: Annotated[BaseStorage, Depends(get_storage)],
):
    admin_wallet = _ensure_fee_policy_admin(principal.admin_wallet)
    try:
        published_version = int(payload.get("publishedVersion") or 1)
        normalized = validate_business_policy_payload(
            payload.get("policy") if isinstance(payload, dict) else {}
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": "INVALID_BUSINESS_POLICY", "message": str(exc)},
        ) from exc
    snapshot = publish_business_policy_snapshot(
        storage,
        payload=normalized,
        published_version=published_version,
        updated_by=admin_wallet,
        updated_at=now_dt_str(),
    )
    return {
        "status": "success",
        "requestedBy": admin_wallet,
        "policy": snapshot.payload,
        "source": snapshot.source,
        "publishedVersion": snapshot.published_version,
        "updatedAt": snapshot.updated_at,
        "updatedBy": snapshot.updated_by,
    }


@router.get(
    "/v1/admin/config-overview",
    responses={403: {"description": "Forbidden or fee admin not configured"}},
)
async def get_config_overview(
    principal: Annotated[
        InternalServicePrincipal, Depends(require_internal_scope("business_policy.read"))
    ],
    storage: Annotated[BaseStorage, Depends(get_storage)],
):
    admin_wallet = _ensure_fee_policy_admin(principal.admin_wallet)
    snapshot = get_business_policy_snapshot(storage)
    return {
        "status": "success",
        "requestedBy": admin_wallet,
        "businessPolicy": {
            "policy": snapshot.payload,
            "source": snapshot.source,
            "publishedVersion": snapshot.published_version,
            "updatedAt": snapshot.updated_at,
            "updatedBy": snapshot.updated_by,
        },
        "envSummary": build_env_config_summary(),
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
            ) from exc
        raise
    except RuntimeError as exc:
        code = str(exc)
        if code == "TX_NOT_CONFIRMED":
            raise HTTPException(
                status_code=409,
                detail={"code": code, "message": "Transaction is not confirmed yet."},
            ) from exc
        if code == "TX_FAILED":
            raise HTTPException(
                status_code=409,
                detail={
                    "code": code,
                    "message": "Transaction failed on-chain and cannot be credited.",
                },
            ) from exc
        if code == "MISSING_TX_RECEIPT":
            raise HTTPException(
                status_code=409,
                detail={"code": code, "message": "Transaction receipt is unavailable."},
            ) from exc
        if code == "NO_MATCHING_DEPOSIT_EVENT":
            raise HTTPException(
                status_code=404,
                detail={
                    "code": code,
                    "message": "No router deposit event found for this tx hash.",
                },
            ) from exc
        raise

    return {
        "status": "success",
        "requestedBy": admin_wallet,
        "replay": summary.to_dict(),
    }
