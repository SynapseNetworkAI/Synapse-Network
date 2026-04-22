from __future__ import annotations

import inspect

import pytest

from src.core.config import settings
from src.services.notifications.models import EmailSendResult, NotificationOutboxRow
from src.services.notifications.outbox_worker import drain_notification_outbox_once
from src.services.notifications.templates import render_notification_email
from src.storage.postgres.repositories.notification_outbox_repository import (
    NotificationOutboxRepository,
)


class FakeNotificationStorage:
    def __init__(self, rows: list[NotificationOutboxRow], *, daily_count: int = 0) -> None:
        self.rows = rows
        self.daily_count = daily_count
        self.sent: list[int] = []
        self.retried: list[tuple[int, str]] = []

    def claim_notification_outbox_batch(self, batch_size: int):
        return "email-lease-unit", list(self.rows[:batch_size])

    def record_sent_notification_and_delete(
        self,
        lease_id: str,
        row: NotificationOutboxRow,
        *,
        message_id: str | None,
        provider_response: dict,
    ) -> None:
        assert lease_id == "email-lease-unit"
        assert provider_response["transport"] == "fake"
        assert message_id == "fake-message-id"
        self.sent.append(row.row_id)

    def mark_notification_outbox_retry(
        self,
        lease_id: str,
        row: NotificationOutboxRow,
        *,
        error: str,
        max_attempts: int,
        retry_base_sec: int,
    ) -> None:
        _ = (max_attempts, retry_base_sec)
        assert lease_id == "email-lease-unit"
        self.retried.append((row.row_id, error))

    def read_notification_delivery_count_today(self) -> int:
        return self.daily_count


class FakeEmailSender:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.recipients: list[str] = []

    def send(self, *, recipient_email: str, rendered):
        if self.fail:
            raise RuntimeError("SMTP 421 quota exceeded")
        self.recipients.append(recipient_email)
        return EmailSendResult(
            message_id="fake-message-id",
            provider_response={"transport": "fake"},
        )


def _row(row_id: int, *, priority: str = "transactional") -> NotificationOutboxRow:
    return NotificationOutboxRow(
        row_id=row_id,
        notification_id=f"notif-{row_id}",
        dedupe_key=f"dedupe-{row_id}",
        event_type="consumer_withdrawal.completed",
        recipient_email="owner@synapse.test",
        recipient_owner_id="owner-1",
        priority=priority,
        template_key="consumer_withdrawal_completed",
        template_version="v1",
        payload={
            "status": "COMPLETED",
            "amount": "2.000000 USDC",
            "withdrawalId": "wd-123",
            "signature": "0x" + "a" * 130,
        },
        attempt_count=0,
    )


def test_notification_outbox_claim_query_uses_skip_locked() -> None:
    source = inspect.getsource(NotificationOutboxRepository.claim_batch)

    assert "FOR UPDATE SKIP LOCKED" in source
    assert "status IN ('pending', 'retry')" in source
    assert "status = 'leased'" in source


def test_render_notification_email_redacts_sensitive_payload() -> None:
    rendered = render_notification_email(
        "consumer_withdrawal_completed",
        {
            "status": "COMPLETED",
            "withdrawalId": "wd-123",
            "signature": "0x" + "b" * 130,
            "private_key": "0x" + "c" * 64,
        },
    )

    body = f"{rendered.subject}\n{rendered.text_body}\n{rendered.html_body}"
    assert "COMPLETED" in body
    assert "wd-123" in body
    assert "0x" + "b" * 64 not in body
    assert "0x" + "c" * 64 not in body


@pytest.mark.asyncio
async def test_notification_worker_records_sent_and_deletes_hot_outbox() -> None:
    storage = FakeNotificationStorage([_row(1)])
    sender = FakeEmailSender()

    result = await drain_notification_outbox_once(
        storage,
        sender=sender,
        batch_size=1,
        max_attempts=3,
        retry_base_sec=1,
    )

    assert result == {"claimed": 1, "sent": 1, "failed": 0, "quotaDeferred": 0}
    assert sender.recipients == ["owner@synapse.test"]
    assert storage.sent == [1]
    assert storage.retried == []


@pytest.mark.asyncio
async def test_notification_worker_retries_quota_error_without_gateway_failure() -> None:
    storage = FakeNotificationStorage([_row(1)])
    sender = FakeEmailSender(fail=True)

    result = await drain_notification_outbox_once(
        storage,
        sender=sender,
        batch_size=1,
        max_attempts=3,
        retry_base_sec=1,
    )

    assert result == {"claimed": 1, "sent": 0, "failed": 1, "quotaDeferred": 1}
    assert storage.sent == []
    assert storage.retried[0][0] == 1
    assert "quota" in storage.retried[0][1].lower()


@pytest.mark.asyncio
async def test_notification_worker_defers_low_priority_after_daily_hard_limit(monkeypatch) -> None:
    monkeypatch.setattr(settings, "email_gmail_daily_hard_limit", 1)
    storage = FakeNotificationStorage([_row(1, priority="digest")], daily_count=1)
    sender = FakeEmailSender()

    result = await drain_notification_outbox_once(
        storage,
        sender=sender,
        batch_size=1,
        max_attempts=3,
        retry_base_sec=1,
    )

    assert result == {"claimed": 1, "sent": 0, "failed": 1, "quotaDeferred": 1}
    assert sender.recipients == []
    assert storage.retried[0][0] == 1


@pytest.mark.asyncio
async def test_notification_worker_allows_security_after_daily_hard_limit(monkeypatch) -> None:
    monkeypatch.setattr(settings, "email_gmail_daily_hard_limit", 1)
    storage = FakeNotificationStorage([_row(1, priority="security")], daily_count=1)
    sender = FakeEmailSender()

    result = await drain_notification_outbox_once(
        storage,
        sender=sender,
        batch_size=1,
        max_attempts=3,
        retry_base_sec=1,
    )

    assert result == {"claimed": 1, "sent": 1, "failed": 0, "quotaDeferred": 0}
    assert sender.recipients == ["owner@synapse.test"]
