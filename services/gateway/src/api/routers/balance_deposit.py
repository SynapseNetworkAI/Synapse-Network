"""Deposit, refund, and consumer withdrawal balance routes."""
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request

from src.api.deps import get_balance_service
from src.api.routers.balance_helpers import (
    BalanceService,
    DepositIntentRequest,
    DepositAttemptRequest,
    DepositConfirmRequest,
    RefundIntentRequest,
    RefundCompleteRequest,
    AdminRefundCompleteRequest,
    InternalServicePrincipal,
    normalize_wallet,
    require_internal_scope,
    get_owner_wallet,
    _extract_request_meta,
    _normalize_tx_hash_or_400,
    _ensure_fee_policy_admin,
)
from src.api.schemas.pydantic_models import ConsumerWithdrawRequest
from src.storage import get_storage

router = APIRouter()


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
        from fastapi import HTTPException
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


# ── Consumer Balance Withdrawal ─────────────────────────────────────────────────


@router.post(
    "/v1/balance/consumer/withdraw",
    summary="Withdraw unused consumer balance back to wallet",
)
async def create_consumer_withdraw(
    body: ConsumerWithdrawRequest,
    request: Request,
    idempotency_key: Annotated[
        str, Header(alias="X-Idempotency-Key", min_length=16, max_length=128)
    ],
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    """
    Withdraw UNUSED consumer balance (unspent deposits) back to the owner wallet.

    - Amount must be ≤ consumer available balance.
    - Amounts ≥ $500 or > 3 daily requests trigger PENDING_MANUAL_REVIEW.
    - Idempotent: same X-Idempotency-Key returns the same response.
    """
    result = await service.create_consumer_withdraw_intent(
        payload=body.model_dump(),
        owner_wallet=owner_wallet,
        idempotency_key=idempotency_key,
        request_meta=_extract_request_meta(request),
    )
    return {"status": "success", "ownerAddress": owner_wallet, **result}


@router.get(
    "/v1/balance/consumer/withdrawals",
    summary="List consumer withdrawal intents for this wallet",
)
async def list_consumer_withdrawals(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    rows = await service.list_consumer_withdrawals(owner_wallet)
    return {"status": "success", "ownerAddress": owner_wallet, "withdrawals": rows[:limit]}

