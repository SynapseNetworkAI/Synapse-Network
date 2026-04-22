from __future__ import annotations

import argparse
import smtplib
import inspect
from types import SimpleNamespace

import pytest

from src.core.config import settings
from src.services.notifications.models import (
    EmailFromMissing,
    EmailSendResult,
    GmailCredentialsMissing,
    InAppNotificationIntent,
    InvalidNotificationIntent,
    InvalidInAppNotificationIntent,
    NotificationIntent,
    NotificationOutboxRow,
    NotificationStorageUnsupported,
    RenderedEmail,
    UnknownNotificationTemplate,
)
from src.services.notifications.outbox_worker import (
    drain_notification_outbox_once,
    run_notification_outbox_worker,
)
from src.services.notifications.sanitizer import mask_email, redact_payload, redact_text
from src.services.notifications.sender import GmailSmtpSender
from src.services.notifications.templates import render_notification_email
from src.services.notifications.in_app import (
    IN_APP_NOTIFICATION_EVENT_CATALOG,
    SUPPRESSED_REALTIME_IN_APP_EVENTS,
    build_deposit_confirmed_intent,
    schedule_in_app_notification,
)
from src.storage.postgres_impl import PostgresStorage
from src.storage.postgres.repositories.in_app_notification_repository import (
    InAppNotificationRepository,
)
from src.storage.postgres.repositories.notification_outbox_repository import (
    NotificationOutboxRepository,
)
from src import worker as gateway_worker


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


class FakeCursor:
    def __init__(self, *, fetchall_rows=None, fetchone_row=None) -> None:
        self.statements: list[tuple[str, tuple | None]] = []
        self._fetchall_rows = fetchall_rows or []
        self._fetchone_row = fetchone_row
        self.rowcount = 1

    def execute(self, sql: str, params: tuple | None = None) -> None:
        self.statements.append((sql, params))

    def fetchall(self):
        return list(self._fetchall_rows)

    def fetchone(self):
        return self._fetchone_row


class FakeCursorContext:
    def __init__(self, cursor: FakeCursor) -> None:
        self.cursor = cursor

    def __enter__(self) -> FakeCursor:
        return self.cursor

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class FakeDatabaseManager:
    def __init__(self, *, tx_cursor: FakeCursor | None = None, readonly_cursor: FakeCursor | None = None) -> None:
        self.tx = tx_cursor or FakeCursor()
        self.readonly = readonly_cursor or FakeCursor()

    def tx_cursor(self):
        return FakeCursorContext(self.tx)

    def readonly_cursor(self):
        return FakeCursorContext(self.readonly)


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


def _intent(**overrides) -> NotificationIntent:
    values = {
        "notification_id": "notif-1",
        "dedupe_key": "owner:withdrawal:completed:1",
        "event_type": "consumer_withdrawal.completed",
        "recipient_email": "Owner@Synapse.Test",
        "recipient_owner_id": "owner-1",
        "priority": "transactional",
        "template_key": "consumer_withdrawal_completed",
        "template_version": "v1",
        "payload": {"status": "COMPLETED", "amount": "2.000000 USDC"},
    }
    values.update(overrides)
    return NotificationIntent(**values)


def _in_app_intent(**overrides) -> InAppNotificationIntent:
    values = {
        "notification_id": "inapp-1",
        "dedupe_key": "deposit.confirmed:0xabc:dep-1",
        "recipient_type": "owner",
        "recipient_owner_id": "0xABC",
        "event_type": "deposit.confirmed",
        "category": "deposit",
        "severity": "success",
        "priority": "transactional",
        "title": "Deposit confirmed",
        "body": "Deposit dep-1 has been credited.",
        "action_url": "/dashboard/billing/credits",
        "resource_type": "deposit",
        "resource_id": "dep-1",
        "payload": {"amount": "2.000000", "currency": "USDC", "signature": "0x" + "a" * 130},
    }
    values.update(overrides)
    return InAppNotificationIntent(**values)


def test_notification_outbox_claim_query_uses_skip_locked() -> None:
    source = inspect.getsource(NotificationOutboxRepository.claim_batch)

    assert "FOR UPDATE SKIP LOCKED" in source
    assert "status IN ('pending', 'retry')" in source
    assert "status = 'leased'" in source


def test_in_app_notification_repository_inserts_sanitized_deduped_rows() -> None:
    tx_cursor = FakeCursor()
    repo = InAppNotificationRepository(FakeDatabaseManager(tx_cursor=tx_cursor))

    repo.enqueue(_in_app_intent())

    sql, params = tx_cursor.statements[0]
    assert "INSERT INTO synapse_in_app_notifications" in sql
    assert "ON CONFLICT (dedupe_key) DO NOTHING" in sql
    assert params[3] == "0xabc"
    assert params[14]
    assert "0x" + "a" * 64 not in str(params[14])


def test_in_app_notification_repository_rejects_missing_owner_recipient() -> None:
    repo = InAppNotificationRepository(FakeDatabaseManager())

    with pytest.raises(InvalidInAppNotificationIntent):
        repo.enqueue(_in_app_intent(recipient_owner_id=""))


def test_in_app_notification_repository_lists_and_marks_owner_rows() -> None:
    row = (
        "inapp-1",
        "deposit.confirmed",
        "deposit",
        "success",
        "transactional",
        "Deposit confirmed",
        "Deposit dep-1 credited.",
        "/dashboard/billing/credits",
        "deposit",
        "dep-1",
        {"amount": "2.000000", "currency": "USDC"},
        None,
        None,
        None,
        "2026-04-22T10:00:00.000Z",
    )
    db = FakeDatabaseManager(
        readonly_cursor=FakeCursor(fetchall_rows=[row], fetchone_row=(2,)),
        tx_cursor=FakeCursor(),
    )
    repo = InAppNotificationRepository(db)

    rows = repo.list_for_owner(owner_wallet="0xABC", limit=20, cursor=None, unread_only=True)
    assert rows[0].notification_id == "inapp-1"
    assert rows[0].payload == {"amount": "2.000000", "currency": "USDC"}
    assert repo.unread_count_for_owner(owner_wallet="0xABC") == 2
    assert repo.mark_read_for_owner(owner_wallet="0xABC", notification_id="inapp-1") is True
    assert repo.archive_for_owner(owner_wallet="0xABC", notification_id="inapp-1") is True

    readonly_sql, readonly_params = db.readonly.statements[0]
    assert "recipient_owner_id = %s" in readonly_sql
    assert "read_at IS NULL" in readonly_sql
    assert readonly_params[0] == "0xabc"


def test_in_app_notification_catalog_is_metadata_only_and_complete() -> None:
    expected_events = {
        "deposit.confirmed",
        "deposit.delayed",
        "invoke.insufficient_balance",
        "budget.cap_triggered",
        "consumer_withdrawal.created",
        "consumer_withdrawal.manual_review",
        "consumer_withdrawal.ticket_ready",
        "consumer_withdrawal.completed",
        "consumer_withdrawal.failed_expired",
        "consumer_withdrawal.soft_revoke_wait_expiry",
        "refund.completed",
        "refund.rejected",
        "refund.failed",
        "security.new_device_login",
        "security.mfa_changed",
        "security.wallet_binding_changed",
        "security.email_changed",
        "provider_service.approved",
        "provider_service.rejected",
        "provider_health.degraded",
        "provider_health.outage",
        "provider_health.recovered",
        "provider_withdrawal.created",
        "provider_withdrawal.manual_review",
        "provider_withdrawal.ticket_ready",
        "provider_withdrawal.rejected",
        "provider_withdrawal.completed",
        "provider_withdrawal.failed_expired",
        "provider_withdrawal.soft_revoke_wait_expiry",
    }
    assert set(IN_APP_NOTIFICATION_EVENT_CATALOG) == expected_events
    assert "provider_income.credited" in SUPPRESSED_REALTIME_IN_APP_EVENTS

    allowed_categories = {"finance", "withdrawal", "deposit", "refund", "security", "service", "approval", "system"}
    allowed_severities = {"info", "success", "warning", "critical"}
    allowed_priorities = {"security", "transactional_high", "transactional", "ops", "digest"}
    for metadata in IN_APP_NOTIFICATION_EVENT_CATALOG.values():
        assert metadata["category"] in allowed_categories
        assert metadata["severity"] in allowed_severities
        assert metadata["priority"] in allowed_priorities


def test_in_app_notification_builders_store_structured_payload_not_localized_sentences() -> None:
    intents = [
        build_deposit_confirmed_intent("0xABC", {"depositId": "dep-1", "amount": "2.000000"}),
        build_deposit_confirmed_intent("0xABC", {"depositId": "dep-2", "amountUsdc": "10.500000"}),
    ]
    forbidden_words = ("your ", " has ", "您的", "提现", "充值", "完成")
    for intent in intents:
        assert intent.payload
        assert intent.payload["currency"] == "USDC"
        assert str(intent.payload["amount"]).count(".") <= 1
        assert not any(
            isinstance(value, str) and any(word in value.lower() for word in forbidden_words)
            for value in intent.payload.values()
        )


def test_in_app_notification_cleanup_deletes_in_batches() -> None:
    tx_cursor = FakeCursor()
    repo = InAppNotificationRepository(FakeDatabaseManager(tx_cursor=tx_cursor))

    deleted = repo.cleanup_expired(retention_days=90, security_retention_days=180, batch_size=25)

    assert deleted == 1
    sql, params = tx_cursor.statements[0]
    assert "DELETE FROM synapse_in_app_notifications" in sql
    assert params == (90, 180, 25)


def test_in_app_notification_schedule_is_best_effort(monkeypatch, caplog) -> None:
    class BrokenStorage:
        def enqueue_in_app_notification(self, intent) -> None:
            _ = intent
            raise RuntimeError("db unavailable")

    intent = build_deposit_confirmed_intent("0xABC", {"depositId": "dep-1", "amount": "2.000000"})

    schedule_in_app_notification(BrokenStorage(), intent)

    assert "IN_APP_NOTIFICATION_WRITE_FAILED" in caplog.text


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


def test_render_notification_email_includes_action_url_and_rejects_unknown_template() -> None:
    rendered = render_notification_email(
        "deposit_confirmed",
        {
            "status": "CONFIRMED",
            "depositId": "dep-123",
            "actionUrl": "https://app.synapse.test/deposits/dep-123",
        },
    )

    assert "Open Synapse: https://app.synapse.test/deposits/dep-123" in rendered.text_body
    with pytest.raises(UnknownNotificationTemplate):
        render_notification_email("unknown_template", {})


def test_notification_sanitizer_masks_email_and_payload_values() -> None:
    payload = {
        "authorization": "Bearer abc",
        "items": ["signature=raw-ticket", "safe"],
        "nested": {"txHash": "0x" + "a" * 64},
        "count": 1,
    }

    assert mask_email("owner@synapse.test") == "o***@synapse.test"
    assert mask_email("not-an-email") == "[invalid-email]"
    assert redact_text("token=abc " + ("x" * 20), max_chars=10).endswith("... [Truncated]")
    redacted = redact_payload(payload)
    assert redacted["authorization"] == "[REDACTED]"
    assert redacted["items"][0] == "signature=[REDACTED]"
    assert redacted["nested"]["txHash"] == "[REDACTED_HEX]"
    assert redacted["count"] == 1


def test_gmail_sender_builds_message_and_rejects_missing_config(monkeypatch) -> None:
    rendered = RenderedEmail(subject="Synapse test", text_body="hello", html_body="<p>hello</p>")
    sender = GmailSmtpSender(
        username="smtp-user",
        app_password="smtp-pass",
        from_address="notifications@synapse.test",
        reply_to="support@synapse.test",
    )

    message = sender._build_message(recipient_email="owner@synapse.test", rendered=rendered)
    assert message["Subject"] == "Synapse test"
    assert message["From"] == "notifications@synapse.test"
    assert message["To"] == "owner@synapse.test"
    assert message["Reply-To"] == "support@synapse.test"

    with pytest.raises(EmailFromMissing):
        GmailSmtpSender(
            username="smtp-user",
            app_password="smtp-pass",
            from_address="",
        )._build_message(recipient_email="owner@synapse.test", rendered=rendered)

    with pytest.raises(GmailCredentialsMissing):
        GmailSmtpSender(
            username="",
            app_password="",
            from_address="notifications@synapse.test",
        ).send(recipient_email="owner@synapse.test", rendered=rendered)

    class FakeSmtp:
        sent_messages = []

        def __init__(self, host: str, port: int, *, timeout: float) -> None:
            self.host = host
            self.port = port
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> bool:
            return False

        def starttls(self) -> None:
            self.started = True

        def login(self, username: str, password: str) -> None:
            self.login_args = (username, password)

        def send_message(self, message):
            self.sent_messages.append(message)
            return {"blocked@synapse.test": (550, b"rejected")}

    monkeypatch.setattr(smtplib, "SMTP", FakeSmtp)
    result = sender.send(recipient_email="owner@synapse.test", rendered=rendered)
    assert result.provider_response == {
        "transport": "gmail_smtp",
        "accepted": False,
        "rejectedRecipients": ["blocked@synapse.test"],
    }
    assert FakeSmtp.sent_messages[0]["To"] == "owner@synapse.test"


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


@pytest.mark.asyncio
async def test_notification_worker_rejects_storage_without_outbox_api() -> None:
    with pytest.raises(NotificationStorageUnsupported):
        await drain_notification_outbox_once(object(), sender=FakeEmailSender())


@pytest.mark.asyncio
async def test_notification_worker_loop_drains_until_stop(monkeypatch) -> None:
    calls = {"count": 0}
    stop_event = None

    async def fake_drain(storage):
        _ = storage
        calls["count"] += 1
        stop_event.set()
        return {"claimed": 1, "sent": 1, "failed": 0, "quotaDeferred": 0}

    event = stop_event = __import__("asyncio").Event()
    monkeypatch.setattr(
        "src.services.notifications.outbox_worker.drain_notification_outbox_once",
        fake_drain,
    )

    await run_notification_outbox_worker(event, object(), poll_interval_sec=0.1)
    assert calls["count"] == 1


def test_notification_outbox_repository_executes_hot_queue_lifecycle() -> None:
    claimed_row = (
        7,
        "notif-7",
        "dedupe-7",
        "consumer_withdrawal.completed",
        "owner@synapse.test",
        "owner-1",
        "transactional",
        "consumer_withdrawal_completed",
        "v1",
        {"status": "COMPLETED"},
        2,
    )
    tx = FakeCursor(fetchall_rows=[claimed_row])
    readonly = FakeCursor(fetchone_row=(3, 2, 1, 99))
    repo = NotificationOutboxRepository(FakeDatabaseManager(tx_cursor=tx, readonly_cursor=readonly))

    repo.enqueue(_intent())
    lease_id, rows = repo.claim_batch(0)
    assert lease_id.startswith("email-lease-")
    assert rows[0] == NotificationOutboxRow(
        row_id=7,
        notification_id="notif-7",
        dedupe_key="dedupe-7",
        event_type="consumer_withdrawal.completed",
        recipient_email="owner@synapse.test",
        recipient_owner_id="owner-1",
        priority="transactional",
        template_key="consumer_withdrawal_completed",
        template_version="v1",
        payload={"status": "COMPLETED"},
        attempt_count=2,
    )
    repo.record_sent_and_delete(
        lease_id,
        rows[0],
        message_id="gmail-message-id",
        provider_response={"transport": "gmail_smtp"},
    )
    repo.mark_retry(lease_id, rows[0], error="temporary SMTP failure", max_attempts=5, retry_base_sec=2)
    assert repo.delivery_count_today() == 3
    stats = repo.stats()
    assert stats["pendingCount"] == 3
    assert stats["leasedCount"] == 2
    assert stats["deadLetterCount"] == 1
    assert stats["oldestPendingAgeSec"] == 99
    assert len(tx.statements) >= 5


def test_notification_outbox_repository_validates_required_intent_fields() -> None:
    repo = NotificationOutboxRepository(FakeDatabaseManager())

    for field in ("notification_id", "dedupe_key", "recipient_email"):
        with pytest.raises(InvalidNotificationIntent):
            repo.enqueue(_intent(**{field: "   "}))


def test_postgres_storage_notification_methods_delegate_to_repository() -> None:
    storage = object.__new__(PostgresStorage)
    repo = SimpleNamespace(
        enqueue=lambda intent: ("enqueue", intent),
        claim_batch=lambda batch_size: ("lease", batch_size),
        record_sent_and_delete=lambda lease_id, row, **kwargs: ("sent", lease_id, row, kwargs),
        mark_retry=lambda lease_id, row, **kwargs: ("retry", lease_id, row, kwargs),
        delivery_count_today=lambda: 12,
        stats=lambda: {"pendingCount": 1},
    )
    storage.notification_outbox = repo

    assert storage.enqueue_notification_outbox(_intent()) is None
    assert storage.claim_notification_outbox_batch(5) == ("lease", 5)
    assert (
        storage.record_sent_notification_and_delete(
            "lease",
            _row(1),
            message_id="msg",
            provider_response={"ok": True},
        )
        is None
    )
    assert (
        storage.mark_notification_outbox_retry(
            "lease",
            _row(1),
            error="fail",
            max_attempts=3,
            retry_base_sec=2,
        )
        is None
    )
    assert storage.read_notification_delivery_count_today() == 12
    assert storage.read_notification_outbox_stats() == {"pendingCount": 1}


@pytest.mark.asyncio
async def test_worker_cli_notification_once_and_unknown_command(monkeypatch) -> None:
    async def fake_drain(storage):
        assert storage == "fake-storage"
        return {"claimed": 0, "sent": 0, "failed": 0, "quotaDeferred": 0}

    monkeypatch.setattr(gateway_worker, "create_storage", lambda settings: "fake-storage")
    monkeypatch.setattr(gateway_worker, "drain_notification_outbox_once", fake_drain)

    exit_code = await gateway_worker._run(
        argparse.Namespace(command="notification-outbox", once=True, poll_interval_sec=1.0)
    )
    assert exit_code == 0

    with pytest.raises(ValueError):
        await gateway_worker._run(
            argparse.Namespace(command="unknown", once=False, poll_interval_sec=1.0)
        )
