"""Deposit, refund, and consumer withdrawal balance routes."""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request

from src.api.deps import get_balance_service
from src.api.routers.balance_helpers import (
    BalanceService,
    DepositIntentRequest,
    DepositAttemptRequest,
    DepositConfirmRequest,
    RefundIntentRequest,
    RefundCompleteRequest,
    RefundFailRequest,
    AdminRefundCompleteRequest,
    AdminRefundReviewRequest,
    InternalServicePrincipal,
    normalize_wallet,
    require_internal_scope,
    get_owner_wallet,
    _extract_request_meta,
    _normalize_tx_hash_or_400,
    _ensure_fee_policy_admin,
)
from src.api.schemas.pydantic_models import ConsumerWithdrawRequest
from src.domain.finance import RefundIntentRow
from src.services.notifications.in_app import (
    build_consumer_withdrawal_created_intent,
    build_refund_completed_intent,
    schedule_in_app_notification,
)
from src.services.notifications.transactional import build_public_app_url, schedule_transaction_notifications
from src.services.owner.consumer_withdraw_logging import (
    log_consumer_withdraw_completed,
)
from src.services.owner.finance_constants import CONSUMER_WITHDRAW_TYPE
from src.services.owner.finance_fee_policy import consumer_withdraw_fee_usdc
from src.services.platform.tasks.deposit_indexer import post_deposit_indexer_trigger
from src.storage import BaseStorage, get_storage
from src.utils.money import parse_usdc

router = APIRouter()
logger = logging.getLogger(__name__)


def _read_consumer_withdraw_row(
    storage: BaseStorage,
    *,
    owner_wallet: str,
    refund_id: str,
) -> RefundIntentRow | None:
    if not hasattr(storage, "get_data_manager"):
        return None
    rows = storage.get_data_manager().system.gateway_state.read_consumer_refund_rows(
        owner_wallet=owner_wallet
    )
    for row in rows:
        if str(row.id or "") == refund_id:
            return row
    return None


def _emit_consumer_withdraw_client_complete_log(
    storage: BaseStorage,
    *,
    owner_wallet: str,
    refund_id: str,
    tx_hash: str,
) -> None:
    try:
        row = _read_consumer_withdraw_row(
            storage,
            owner_wallet=owner_wallet,
            refund_id=refund_id,
        )
    except Exception:
        logger.exception(
            "consumer withdrawal completion log skipped refund_id=%s",
            refund_id,
        )
        return
    if row is None or str(row.refund_type or "").upper() != CONSUMER_WITHDRAW_TYPE:
        return
    amount_usdc = parse_usdc(row.amount_usdc)
    fee_usdc = consumer_withdraw_fee_usdc()
    net_usdc = parse_usdc(amount_usdc - fee_usdc)
    log_consumer_withdraw_completed(
        withdrawal_id=refund_id,
        owner=owner_wallet,
        amount_usdc=amount_usdc,
        fee_usdc=fee_usdc,
        net_usdc=net_usdc,
        tx_hash=tx_hash,
        completion_source="client_complete",
    )


@router.get("/v1/balance", responses={500: {"description": "Database IO blocked"}})
async def get_balance(
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    """[极速路由] 获取当前会话 owner 的余额摘要。"""
    try:
        balance_data = await service.get_balance(owner_wallet)
    except Exception as exc:
        logger.exception("Balance summary query failed", extra={"owner_wallet": owner_wallet})
        raise HTTPException(
            status_code=500,
            detail={
                "code": "BALANCE_QUERY_FAILED",
                "message": "Unable to load balance right now.",
            },
        ) from exc
    else:
        return {"status": "success", "balance": balance_data}


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
    await post_deposit_indexer_trigger(
        source="deposit_intent_registered",
        triggered_by="api.v1.balance.deposit.intent",
        tx_hash=str(stored_intent.get("txHash") or ""),
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
    storage: Annotated[BaseStorage, Depends(get_storage)],
):
    _ = deposit_intent_id, payload, request, owner_wallet, service, storage
    raise HTTPException(
        status_code=410,
        detail={
            "code": "DEPOSIT_CONFIRM_INDEXER_ONLY",
            "message": (
                "Deposit confirmation is owned by the chain indexer. "
                "Wait for sync status or ask an operator to replay the transaction."
            ),
        },
    )


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
    storage: Annotated[BaseStorage, Depends(get_storage)],
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
    if not result.get("idempotentReplay"):
        _emit_consumer_withdraw_client_complete_log(
            storage,
            owner_wallet=owner_wallet,
            refund_id=refund_id,
            tx_hash=str(result.get("txHash") or payload.txHash),
        )
        schedule_in_app_notification(
            storage,
            build_refund_completed_intent(owner_wallet, {"refundId": refund_id, **result}),
        )
        schedule_transaction_notifications(
            storage,
            owner_wallet=owner_wallet,
            template_key="refund_completed",
            event_type="refund.completed",
            payload={
                "refundId": refund_id,
                "amount": result.get("amount") or result.get("amountUsdc"),
                "status": "COMPLETED",
                "txHash": result.get("txHash"),
                "ownerAddress": owner_wallet,
                "actionUrl": build_public_app_url("/dashboard/billing"),
            },
        )
    return {"status": "success", "ownerAddress": owner_wallet, **result}


@router.post("/v1/refunds/{refund_id}/fail")
async def fail_refund(
    refund_id: str,
    payload: RefundFailRequest,
    request: Request,
    owner_wallet: Annotated[str, Depends(get_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    result = await service.fail_refund_intent(
        owner_wallet=owner_wallet,
        refund_id=refund_id,
        reason_code=str(payload.reasonCode or "").strip().upper(),
        message=str(payload.message or "").strip(),
        tx_hash=payload.txHash,
        request_meta=_extract_request_meta(request),
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
    storage: Annotated[BaseStorage, Depends(get_storage)],
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
    if not result.get("idempotentReplay"):
        schedule_transaction_notifications(
            storage,
            owner_wallet=target_owner,
            template_key="refund_completed",
            event_type="refund.completed",
            payload={
                "refundId": refund_id,
                "amount": result.get("amount") or result.get("amountUsdc"),
                "status": "COMPLETED",
                "txHash": payload.txHash,
                "ownerAddress": target_owner,
                "actionUrl": build_public_app_url("/dashboard/billing"),
            },
        )
    return {
        "status": "success",
        "requestedBy": admin_wallet,
        "ownerAddress": target_owner,
        "refundId": result.get("refundId"),
        "refundStatus": result.get("status"),
        "txHash": result.get("txHash"),
    }


@router.post(
    "/v1/admin/refunds/{refund_id}/review",
    responses={403: {"description": "Forbidden or fee admin not configured"}},
)
async def review_refund_as_admin(
    refund_id: str,
    payload: AdminRefundReviewRequest,
    request: Request,
    principal: Annotated[InternalServicePrincipal, Depends(require_internal_scope("refund.review"))],
    service: Annotated[BalanceService, Depends(get_balance_service)],
    storage: Annotated[BaseStorage, Depends(get_storage)],
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
        "resourceId": refund_id,
        "actorAdminId": principal.actor_admin_id,
        "actorRole": principal.actor_role,
        "serviceSubject": principal.service_subject,
    }
    result = await service.review_consumer_withdrawal(
        owner_wallet=target_owner,
        refund_id=refund_id,
        request_meta=request_meta,
    )
    result_status = str(result.get("status") or result.get("withdrawalStatus") or "").upper()
    if result.get("ticket") or result_status in {"SIGNED", "APPROVED_AUTO"}:
        schedule_transaction_notifications(
            storage,
            owner_wallet=target_owner,
            template_key="consumer_withdrawal_ticket_ready",
            event_type="consumer_withdrawal.ticket_ready",
            payload={
                "withdrawalId": result.get("withdrawalId") or refund_id,
                "amount": result.get("amount") or result.get("amountUsdc"),
                "status": result_status or "SIGNED",
                "ownerAddress": target_owner,
                "actionUrl": build_public_app_url("/dashboard/billing/credits"),
            },
        )
    return {
        "status": "success",
        "requestedBy": admin_wallet,
        "ownerAddress": target_owner,
        **result,
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
    storage: Annotated[BaseStorage, Depends(get_storage)],
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
    schedule_in_app_notification(
        storage,
        build_consumer_withdrawal_created_intent(owner_wallet, result),
    )
    result_status = str(result.get("status") or result.get("withdrawalStatus") or "").upper()
    if result.get("ticket") or result_status in {"SIGNED", "APPROVED_AUTO"}:
        schedule_transaction_notifications(
            storage,
            owner_wallet=owner_wallet,
            template_key="consumer_withdrawal_ticket_ready",
            event_type="consumer_withdrawal.ticket_ready",
            payload={
                "withdrawalId": result.get("withdrawalId"),
                "amount": result.get("amount") or result.get("amountUsdc"),
                "status": result_status or "SIGNED",
                "ownerAddress": owner_wallet,
                "actionUrl": build_public_app_url("/dashboard/billing/credits"),
            },
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
