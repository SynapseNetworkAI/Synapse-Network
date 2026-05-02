from __future__ import annotations

import asyncio
import logging
from typing import Any
from uuid import uuid4

from src.core.common import normalize_wallet
from src.services.notifications.models import InAppNotificationIntent, InAppNotificationRow
from src.storage.base import BaseStorage

logger = logging.getLogger("synapse.notifications.in_app")


IN_APP_NOTIFICATION_EVENT_CATALOG: dict[str, dict[str, str]] = {
    "deposit.confirmed": {"category": "deposit", "severity": "success", "priority": "transactional"},
    "deposit.delayed": {"category": "deposit", "severity": "warning", "priority": "transactional"},
    "invoke.insufficient_balance": {"category": "finance", "severity": "warning", "priority": "transactional_high"},
    "budget.cap_triggered": {"category": "finance", "severity": "warning", "priority": "transactional_high"},
    "consumer_withdrawal.created": {"category": "withdrawal", "severity": "info", "priority": "transactional_high"},
    "consumer_withdrawal.manual_review": {"category": "withdrawal", "severity": "warning", "priority": "transactional_high"},
    "consumer_withdrawal.ticket_ready": {"category": "withdrawal", "severity": "success", "priority": "transactional_high"},
    "consumer_withdrawal.completed": {"category": "withdrawal", "severity": "success", "priority": "transactional_high"},
    "consumer_withdrawal.failed_expired": {"category": "withdrawal", "severity": "warning", "priority": "transactional_high"},
    "consumer_withdrawal.soft_revoke_wait_expiry": {"category": "withdrawal", "severity": "warning", "priority": "transactional_high"},
    "refund.completed": {"category": "refund", "severity": "success", "priority": "transactional"},
    "refund.rejected": {"category": "refund", "severity": "warning", "priority": "transactional"},
    "refund.failed": {"category": "refund", "severity": "critical", "priority": "transactional_high"},
    "security.new_device_login": {"category": "security", "severity": "warning", "priority": "security"},
    "security.mfa_changed": {"category": "security", "severity": "warning", "priority": "security"},
    "security.wallet_binding_changed": {"category": "security", "severity": "warning", "priority": "security"},
    "security.email_changed": {"category": "security", "severity": "warning", "priority": "security"},
    "provider_service.approved": {"category": "service", "severity": "success", "priority": "transactional"},
    "provider_service.rejected": {"category": "service", "severity": "warning", "priority": "transactional"},
    "provider_health.degraded": {"category": "service", "severity": "warning", "priority": "transactional"},
    "provider_health.outage": {"category": "service", "severity": "critical", "priority": "transactional_high"},
    "provider_health.recovered": {"category": "service", "severity": "success", "priority": "transactional"},
    "provider_withdrawal.created": {"category": "withdrawal", "severity": "info", "priority": "transactional_high"},
    "provider_withdrawal.manual_review": {"category": "withdrawal", "severity": "warning", "priority": "transactional_high"},
    "provider_withdrawal.ticket_ready": {"category": "withdrawal", "severity": "success", "priority": "transactional_high"},
    "provider_withdrawal.rejected": {"category": "withdrawal", "severity": "warning", "priority": "transactional_high"},
    "provider_withdrawal.completed": {"category": "withdrawal", "severity": "success", "priority": "transactional_high"},
    "provider_withdrawal.failed_expired": {"category": "withdrawal", "severity": "warning", "priority": "transactional_high"},
    "provider_withdrawal.soft_revoke_wait_expiry": {"category": "withdrawal", "severity": "warning", "priority": "transactional_high"},
}

SUPPRESSED_REALTIME_IN_APP_EVENTS = frozenset({"provider_income.credited"})


def _payload_value(payload: Any, *keys: str, fallback: str = "") -> str:
    if hasattr(payload, "model_dump"):
        try:
            payload = payload.model_dump(by_alias=True, mode="json")
        except Exception:
            payload = {}
    if not isinstance(payload, dict):
        return fallback
    for key in keys:
        value = payload.get(key)
        if value not in (None, ""):
            return str(value)
    return fallback


def _amount_label(payload: Any) -> str:
    amount = _payload_value(payload, "amount", "amountUsdc", "amount_usdc", fallback="")
    if not amount:
        return ""
    return f"{amount} USDC" if "USDC" not in amount.upper() else amount


def _amount_value(payload: Any) -> str:
    return _payload_value(payload, "amount", "amountUsdc", "amount_usdc", fallback="")


def _notification_id(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex}"


def _intent(
    *,
    owner_wallet: str,
    event_type: str,
    category: str,
    severity: str,
    priority: str,
    title: str,
    body: str,
    resource_type: str,
    resource_id: str,
    action_url: str,
    payload: dict[str, Any],
) -> InAppNotificationIntent:
    owner = normalize_wallet(owner_wallet)
    dedupe_key = f"{event_type}:{owner}:{resource_type}:{resource_id}"
    return InAppNotificationIntent(
        notification_id=_notification_id("inapp"),
        dedupe_key=dedupe_key,
        recipient_type="owner",
        recipient_owner_id=owner,
        event_type=event_type,
        category=category,
        severity=severity,
        priority=priority,
        title=title,
        body=body,
        action_url=action_url,
        resource_type=resource_type,
        resource_id=resource_id,
        payload=payload,
    )


def build_deposit_confirmed_intent(owner_wallet: str, deposit: Any) -> InAppNotificationIntent:
    deposit_id = _payload_value(deposit, "depositId", "deposit_id", "id", fallback="unknown")
    amount = _amount_label(deposit)
    return _intent(
        owner_wallet=owner_wallet,
        event_type="deposit.confirmed",
        category="deposit",
        severity="success",
        priority="transactional",
        title="Deposit confirmed",
        body=f"Your deposit {deposit_id} has been credited{f' for {amount}' if amount else ''}.",
        action_url="/dashboard/billing/credits",
        resource_type="deposit",
        resource_id=deposit_id,
        payload={"depositId": deposit_id, "amount": _amount_value(deposit), "currency": "USDC", "status": "CONFIRMED"},
    )


def build_consumer_withdrawal_created_intent(owner_wallet: str, withdrawal: Any) -> InAppNotificationIntent:
    withdrawal_id = _payload_value(withdrawal, "withdrawalId", "withdrawal_id", fallback="unknown")
    status = _payload_value(withdrawal, "status", "withdrawalStatus", fallback="REQUESTED")
    amount = _amount_label(withdrawal)
    severity = "warning" if status == "PENDING_MANUAL_REVIEW" else "info"
    return _intent(
        owner_wallet=owner_wallet,
        event_type="consumer_withdrawal.created",
        category="withdrawal",
        severity=severity,
        priority="transactional_high",
        title="Consumer withdrawal created",
        body=(
            f"Withdrawal {withdrawal_id} is {status}"
            f"{f' for {amount}' if amount else ''}."
        ),
        action_url="/dashboard/billing/credits",
        resource_type="consumer_withdrawal",
        resource_id=withdrawal_id,
        payload={"withdrawalId": withdrawal_id, "amount": _amount_value(withdrawal), "currency": "USDC", "status": status},
    )


def build_provider_withdrawal_created_intent(owner_wallet: str, withdrawal: Any) -> InAppNotificationIntent:
    withdrawal_id = _payload_value(withdrawal, "withdrawalId", "withdrawal_id", fallback="unknown")
    status = _payload_value(withdrawal, "status", "withdrawalStatus", fallback="REQUESTED")
    amount = _amount_label(withdrawal)
    severity = "warning" if status == "PENDING_MANUAL_REVIEW" else "info"
    return _intent(
        owner_wallet=owner_wallet,
        event_type="provider_withdrawal.created",
        category="withdrawal",
        severity=severity,
        priority="transactional_high",
        title="Provider withdrawal created",
        body=(
            f"Provider withdrawal {withdrawal_id} is {status}"
            f"{f' for {amount}' if amount else ''}."
        ),
        action_url="/provider/withdraw",
        resource_type="provider_withdrawal",
        resource_id=withdrawal_id,
        payload={"withdrawalId": withdrawal_id, "amount": _amount_value(withdrawal), "currency": "USDC", "status": status},
    )


def build_consumer_withdrawal_failed_expired_intent(owner_wallet: str, withdrawal: Any) -> InAppNotificationIntent:
    withdrawal_id = _payload_value(withdrawal, "withdrawalId", "withdrawal_id", "id", fallback="unknown")
    amount = _amount_label(withdrawal)
    body = (
        f"Withdrawal {withdrawal_id} timed out and was automatically cancelled"
        f"{f' for {amount}' if amount else ''}. Frozen funds were safely returned to your available balance. "
        "Please create a new withdrawal if you still want to cash out."
    )
    return _intent(
        owner_wallet=owner_wallet,
        event_type="consumer_withdrawal.failed_expired",
        category="withdrawal",
        severity="warning",
        priority="transactional_high",
        title="Withdrawal timed out; funds returned",
        body=body,
        action_url="/dashboard/billing/credits",
        resource_type="consumer_withdrawal",
        resource_id=withdrawal_id,
        payload={
            "withdrawalId": withdrawal_id,
            "amount": _amount_value(withdrawal),
            "currency": "USDC",
            "status": "FAILED_EXPIRED",
            "message": body,
        },
    )


def build_provider_withdrawal_failed_expired_intent(owner_wallet: str, withdrawal: Any) -> InAppNotificationIntent:
    withdrawal_id = _payload_value(withdrawal, "withdrawalId", "withdrawal_id", "id", fallback="unknown")
    amount = _amount_label(withdrawal)
    body = (
        f"Provider withdrawal {withdrawal_id} timed out and was automatically cancelled"
        f"{f' for {amount}' if amount else ''}. Frozen earnings were safely returned to your withdrawable balance. "
        "Please create a new provider withdrawal if needed."
    )
    return _intent(
        owner_wallet=owner_wallet,
        event_type="provider_withdrawal.failed_expired",
        category="withdrawal",
        severity="warning",
        priority="transactional_high",
        title="Provider withdrawal timed out; funds returned",
        body=body,
        action_url="/provider/withdraw",
        resource_type="provider_withdrawal",
        resource_id=withdrawal_id,
        payload={
            "withdrawalId": withdrawal_id,
            "amount": _amount_value(withdrawal),
            "currency": "USDC",
            "status": "FAILED_EXPIRED",
            "message": body,
        },
    )


def build_refund_completed_intent(owner_wallet: str, refund: Any) -> InAppNotificationIntent:
    refund_id = _payload_value(refund, "refundId", "refund_id", fallback="unknown")
    amount = _amount_label(refund)
    return _intent(
        owner_wallet=owner_wallet,
        event_type="refund.completed",
        category="refund",
        severity="success",
        priority="transactional",
        title="Refund completed",
        body=f"Refund {refund_id} has been completed{f' for {amount}' if amount else ''}.",
        action_url="/dashboard/billing",
        resource_type="refund",
        resource_id=refund_id,
        payload={"refundId": refund_id, "amount": _amount_value(refund), "currency": "USDC", "status": "COMPLETED"},
    )


def schedule_in_app_notification(storage: BaseStorage, intent: InAppNotificationIntent) -> None:
    """Write inbox side effects after the business mutation already committed.

    This is deliberately best-effort: notification failures must never rollback
    money movement or settlement state.
    """

    async def _write() -> None:
        try:
            await asyncio.to_thread(storage.enqueue_in_app_notification, intent)
        except Exception:
            logger.exception(
                "IN_APP_NOTIFICATION_WRITE_FAILED",
                extra={"event_type": intent.event_type, "dedupe_key": intent.dedupe_key},
            )

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        try:
            storage.enqueue_in_app_notification(intent)
        except Exception:
            logger.exception(
                "IN_APP_NOTIFICATION_WRITE_FAILED",
                extra={"event_type": intent.event_type, "dedupe_key": intent.dedupe_key},
            )
        return
    loop.create_task(_write())


async def list_owner_notifications(
    storage: BaseStorage,
    *,
    owner_wallet: str,
    limit: int,
    cursor: str | None,
    unread_only: bool,
) -> list[InAppNotificationRow]:
    return await asyncio.to_thread(
        storage.list_in_app_notifications,
        owner_wallet=owner_wallet,
        limit=limit,
        cursor=cursor,
        unread_only=unread_only,
    )


async def unread_count(storage: BaseStorage, *, owner_wallet: str) -> int:
    return await asyncio.to_thread(
        storage.read_in_app_notification_unread_count,
        owner_wallet=owner_wallet,
    )


async def mark_read(storage: BaseStorage, *, owner_wallet: str, notification_id: str) -> bool:
    return await asyncio.to_thread(
        storage.mark_in_app_notification_read,
        owner_wallet=owner_wallet,
        notification_id=notification_id,
    )


async def mark_all_read(storage: BaseStorage, *, owner_wallet: str) -> int:
    return await asyncio.to_thread(
        storage.mark_all_in_app_notifications_read,
        owner_wallet=owner_wallet,
    )


async def archive(storage: BaseStorage, *, owner_wallet: str, notification_id: str) -> bool:
    return await asyncio.to_thread(
        storage.archive_in_app_notification,
        owner_wallet=owner_wallet,
        notification_id=notification_id,
    )


async def cleanup_in_app_notifications_once(
    storage: BaseStorage,
    *,
    retention_days: int,
    security_retention_days: int,
    batch_size: int,
) -> int:
    return await asyncio.to_thread(
        storage.cleanup_in_app_notifications,
        retention_days=retention_days,
        security_retention_days=security_retention_days,
        batch_size=batch_size,
    )
