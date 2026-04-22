from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

from src.core.config import settings

from .models import (
    EmailQuotaExceeded,
    HIGH_PRIORITY_CATEGORIES,
    NotificationOutboxRow,
    NotificationStorageUnsupported,
)
from .sender import EmailSender, GmailSmtpSender
from .templates import render_notification_email

logger = logging.getLogger("synapse.notifications.email")


_QUOTA_ERROR_MARKERS = (
    "421",
    "450",
    "550",
    "quota",
    "daily user sending limit exceeded",
    "rate limit",
)


def _is_quota_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return any(marker in message for marker in _QUOTA_ERROR_MARKERS)


def _priority_allowed(row: NotificationOutboxRow, daily_sent_count: int) -> None:
    hard_limit = int(settings.email_gmail_daily_hard_limit)
    if hard_limit > 0 and daily_sent_count >= hard_limit and row.priority not in HIGH_PRIORITY_CATEGORIES:
        raise EmailQuotaExceeded


async def drain_notification_outbox_once(
    storage: object,
    *,
    sender: EmailSender | None = None,
    batch_size: int | None = None,
    max_attempts: int | None = None,
    retry_base_sec: int | None = None,
) -> dict[str, int]:
    """Drain one Gmail notification outbox batch.

    Delivery is intentionally at-least-once. If SMTP accepts a message and the
    worker crashes before the DB delete/log transaction commits, the row may be
    retried and delivered again. Money state never depends on email delivery.
    """
    claim = getattr(storage, "claim_notification_outbox_batch", None)
    mark_retry = getattr(storage, "mark_notification_outbox_retry", None)
    record_sent = getattr(storage, "record_sent_notification_and_delete", None)
    daily_count = getattr(storage, "read_notification_delivery_count_today", None)
    if claim is None or mark_retry is None or record_sent is None or daily_count is None:
        raise NotificationStorageUnsupported

    active_sender = sender or GmailSmtpSender()
    lease_id, rows = await asyncio.to_thread(
        claim, batch_size or settings.email_worker_batch_size
    )
    sent = 0
    failed = 0
    quota_deferred = 0
    for row in rows:
        try:
            sent_today = await asyncio.to_thread(daily_count)
            _priority_allowed(row, int(sent_today or 0))
            rendered = render_notification_email(row.template_key, row.payload)
            result = await asyncio.to_thread(
                active_sender.send,
                recipient_email=row.recipient_email,
                rendered=rendered,
            )
            await asyncio.to_thread(
                record_sent,
                lease_id,
                row,
                message_id=result.message_id,
                provider_response=result.provider_response,
            )
            sent += 1
        except Exception as exc:
            if isinstance(exc, EmailQuotaExceeded) or _is_quota_error(exc):
                quota_deferred += 1
            failed += 1
            await asyncio.to_thread(
                mark_retry,
                lease_id,
                row,
                error=str(exc) or exc.__class__.__name__,
                max_attempts=max_attempts or settings.email_outbox_max_attempts,
                retry_base_sec=retry_base_sec or settings.email_outbox_retry_base_sec,
            )
    return {
        "claimed": len(rows),
        "sent": sent,
        "failed": failed,
        "quotaDeferred": quota_deferred,
    }


async def run_notification_outbox_worker(
    stop_event: asyncio.Event,
    storage: object,
    *,
    poll_interval_sec: float = 1.0,
) -> None:
    while not stop_event.is_set():
        try:
            stats = await drain_notification_outbox_once(storage)
            if stats["claimed"]:
                logger.info("notification_outbox.drain", extra=stats)
        except Exception:
            logger.exception("notification_outbox.drain_failed")
        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop_event.wait(), timeout=max(0.1, poll_interval_sec))
