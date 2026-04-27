"""Provider earnings and withdrawal routes."""
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request

from src.api.deps import get_balance_service, get_provider_analytics_service
from src.api.routers.balance_helpers import (
    BalanceService,
    ProviderAnalyticsService,
    AdminProviderWithdrawCompleteRequest,
    AdminProviderWithdrawReviewRequest,
    ProviderWithdrawIntentRequest,
    ProviderWithdrawCompleteRequest,
    InternalServicePrincipal,
    normalize_wallet,
    require_internal_scope,
    get_owner_wallet,
    _extract_request_meta,
    _ensure_fee_policy_admin,
)
from src.services.notifications.in_app import (
    build_provider_withdrawal_created_intent,
    schedule_in_app_notification,
)
from src.services.notifications.transactional import build_public_app_url, schedule_transaction_notifications
from src.storage import BaseStorage, get_storage

router = APIRouter()


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
    storage: Annotated[BaseStorage, Depends(get_storage)],
):
    result = await service.create_provider_withdraw_intent(
        payload.model_dump(),
        owner_wallet,
        idempotency_key,
        _extract_request_meta(request),
    )
    schedule_in_app_notification(
        storage,
        build_provider_withdrawal_created_intent(owner_wallet, result),
    )
    result_status = str(result.get("status") or result.get("withdrawalStatus") or "").upper()
    if result.get("ticket") or result_status in {"SIGNED", "APPROVED_AUTO"}:
        schedule_transaction_notifications(
            storage,
            owner_wallet=owner_wallet,
            template_key="provider_withdrawal_ticket_ready",
            event_type="provider_withdrawal.ticket_ready",
            payload={
                "withdrawalId": result.get("withdrawalId"),
                "amount": result.get("amount") or result.get("amountUsdc"),
                "status": result_status or "SIGNED",
                "ownerAddress": owner_wallet,
                "actionUrl": build_public_app_url("/provider/withdraw"),
            },
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
    storage: Annotated[BaseStorage, Depends(get_storage)],
):
    result = await service.complete_provider_withdrawal(
        owner_wallet=owner_wallet,
        withdrawal_id=withdrawal_id,
        tx_hash=payload.txHash,
        request_meta=_extract_request_meta(request),
    )
    schedule_transaction_notifications(
        storage,
        owner_wallet=owner_wallet,
        template_key="provider_withdrawal_completed",
        event_type="provider_withdrawal.completed",
        payload={
            "withdrawalId": withdrawal_id,
            "amount": result.get("amount") or result.get("amountUsdc"),
            "status": "COMPLETED",
            "txHash": payload.txHash,
            "ownerAddress": owner_wallet,
            "actionUrl": build_public_app_url("/provider/withdraw"),
        },
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
    storage: Annotated[BaseStorage, Depends(get_storage)],
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
    schedule_transaction_notifications(
        storage,
        owner_wallet=target_owner,
        template_key="provider_withdrawal_completed",
        event_type="provider_withdrawal.completed",
        payload={
            "withdrawalId": withdrawal_id,
            "amount": result.get("amount") or result.get("amountUsdc"),
            "status": "COMPLETED",
            "txHash": payload.txHash,
            "ownerAddress": target_owner,
            "actionUrl": build_public_app_url("/provider/withdraw"),
        },
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
    result_status = str(result.get("status") or result.get("withdrawalStatus") or "").upper()
    if result_status == "REJECTED":
        schedule_transaction_notifications(
            storage,
            owner_wallet=target_owner,
            template_key="provider_withdrawal_rejected",
            event_type="provider_withdrawal.rejected",
            payload={
                "withdrawalId": withdrawal_id,
                "amount": result.get("amount") or result.get("amountUsdc"),
                "status": "REJECTED",
                "ownerAddress": target_owner,
                "actionUrl": build_public_app_url("/provider/withdraw"),
            },
        )
    elif result.get("ticket") or result_status in {"SIGNED", "APPROVED_AUTO"}:
        schedule_transaction_notifications(
            storage,
            owner_wallet=target_owner,
            template_key="provider_withdrawal_ticket_ready",
            event_type="provider_withdrawal.ticket_ready",
            payload={
                "withdrawalId": withdrawal_id,
                "amount": result.get("amount") or result.get("amountUsdc"),
                "status": result_status or "SIGNED",
                "ownerAddress": target_owner,
                "actionUrl": build_public_app_url("/provider/withdraw"),
            },
        )
    return {
        "status": "success",
        "requestedBy": admin_wallet,
        "ownerAddress": target_owner,
        **result,
    }
