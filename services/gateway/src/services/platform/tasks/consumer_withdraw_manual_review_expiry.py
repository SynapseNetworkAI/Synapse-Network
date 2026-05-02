from __future__ import annotations

import logging
import time
from typing import Any
from uuid import uuid4

from src.core.config import settings
from src.domain.audit import AuditLogEntry
from src.services.notifications.in_app import build_consumer_withdrawal_failed_expired_intent
from src.services.notifications.transactional import enqueue_transaction_email
from src.services.owner.finance_constants import CONSUMER_WITHDRAW_TYPE
from src.storage.base import BaseStorage
from src.utils.datetime_utils import now_dt_str, to_epoch_seconds
from src.utils.money import parse_usdc

logger = logging.getLogger(__name__)

MANUAL_REVIEW_EXPIRED_CONSUMER_MESSAGE = (
    "Your withdrawal request timed out during manual review and was "
    "automatically cancelled. Frozen funds were safely returned to your "
    "available balance. Please create a new withdrawal if you still want to "
    "cash out."
)


def collect_expired_manual_review_consumer_withdrawals(storage: BaseStorage) -> list:
    try:
        dm = storage.get_data_manager()
        rows = dm.system.gateway_state.read_consumer_refund_rows()
        now = int(time.time())
        batch_size = int(getattr(settings, "withdrawal_reaper_batch_size", 100) or 100)
        candidates = [
            r for r in rows if is_expired_manual_review_consumer_withdrawal(r, now)
        ]
        candidates.sort(
            key=lambda r: to_epoch_seconds(getattr(r, "created_at", None), default=0)
        )
        return candidates[: max(1, min(1000, batch_size))]
    except Exception as exc:
        logger.warning("consumer_withdraw_processor: failed to read manual review rows: %s", exc)
        return []


def expire_manual_review_consumer_withdrawal(storage: BaseStorage, row: Any) -> bool:
    owner = str(getattr(row, "owner_address", "") or getattr(row, "ownerAddress", "") or "")
    amount_usdc = parse_usdc(getattr(row, "amount_usdc", None) or getattr(row, "amountUsdc", 0))
    dm = storage.get_data_manager()
    rows = dm.system.gateway_state.read_consumer_refund_rows()
    target = next(
        (
            candidate for candidate in rows
            if str(getattr(candidate, "id", "") or "") == str(getattr(row, "id", "") or "")
        ),
        None,
    )
    if target is None or str(getattr(target, "status", "") or "").upper() != "PENDING_MANUAL_REVIEW":
        return False
    if not is_expired_manual_review_consumer_withdrawal(target, int(time.time())):
        return False

    now = int(time.time())
    updated_at = now_dt_str()
    target.status = "FAILED_EXPIRED"
    target.completed_at = now
    target.updated_at = updated_at
    target.message = MANUAL_REVIEW_EXPIRED_CONSUMER_MESSAGE
    detail = _manual_expiry_audit_detail(target, amount_usdc)
    atomic_expire = getattr(
        dm.system.gateway_state,
        "expire_consumer_withdrawal_manual_review_atomic",
        None,
    )
    if callable(atomic_expire):
        atomic_expire(
            owner=owner,
            row=target,
            amount_usdc=amount_usdc,
            detail=detail,
            updated_at=updated_at,
        )
    else:
        _fallback_expire_consumer_manual_review(dm, rows, owner, amount_usdc, detail, now, updated_at)
    emit_consumer_manual_review_expiry_notifications(storage, owner, target, amount_usdc)
    logger.info(
        "consumer_withdraw_processor: FAILED_EXPIRED id=%s reason=manual_review_expired",
        getattr(target, "id", "?"),
    )
    return True


def is_expired_manual_review_consumer_withdrawal(row: Any, now: int) -> bool:
    if str(getattr(row, "refund_type", "") or "") != CONSUMER_WITHDRAW_TYPE:
        return False
    if str(getattr(row, "status", "") or "").upper() != "PENDING_MANUAL_REVIEW":
        return False
    created_at = to_epoch_seconds(getattr(row, "created_at", None), default=0)
    if created_at <= 0:
        return False
    expiry_sec = int(getattr(settings, "withdrawal_manual_review_expiry_sec", 86400) or 86400)
    expiry_min = int(getattr(settings, "withdrawal_manual_review_expiry_min_sec", 60) or 60)
    return now - created_at >= max(expiry_min, expiry_sec)


def emit_consumer_manual_review_expiry_notifications(
    storage: BaseStorage,
    owner: str,
    row: Any,
    amount_usdc,
) -> None:
    payload = {
        "withdrawalId": str(getattr(row, "id", "") or ""),
        "amount": str(amount_usdc),
        "status": "FAILED_EXPIRED",
        "message": MANUAL_REVIEW_EXPIRED_CONSUMER_MESSAGE,
        "ownerAddress": owner,
    }
    try:
        storage.enqueue_in_app_notification(
            build_consumer_withdrawal_failed_expired_intent(owner, payload)
        )
    except Exception:
        logger.warning("consumer_withdraw_processor: in-app expiry notification failed")
    enqueue_transaction_email(
        storage,
        owner_wallet=owner,
        template_key="consumer_withdrawal_failed_expired",
        event_type="consumer_withdrawal.failed_expired",
        payload=payload,
    )


def _manual_expiry_audit_detail(target: Any, amount_usdc) -> dict:
    return {
        "refundId": str(getattr(target, "id", "") or ""),
        "amountUsdc": str(amount_usdc),
        "releasedAmountUsdc": str(amount_usdc),
        "reason": "MANUAL_REVIEW_EXPIRED",
        "expirySeconds": int(getattr(settings, "withdrawal_manual_review_expiry_sec", 86400) or 86400),
    }


def _fallback_expire_consumer_manual_review(
    dm,
    rows: list,
    owner: str,
    amount_usdc,
    detail: dict,
    now: int,
    updated_at: str,
) -> None:
    dm.finance.balance.release_consumer_frozen_to_available(
        owner=owner,
        amount_usdc=amount_usdc,
        updated_at=updated_at,
    )
    dm.system.gateway_state.write_consumer_refund_rows(rows, now)
    dm.audit.logs.append_audit_row(
        AuditLogEntry(
            id=str(uuid4()),
            timestamp=now,
            action="CONSUMER_WITHDRAW_MANUAL_REVIEW_EXPIRED",
            owner_address=owner,
            details=detail,
        )
    )
