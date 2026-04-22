from __future__ import annotations

import asyncio
from contextlib import contextmanager

from fastapi.testclient import TestClient

from src import app as gateway_app
from src.services.notifications.models import InAppNotificationRow
from src.services.platform import credential_service


class FakeStorage:
    def __init__(self) -> None:
        self.rows = [
            InAppNotificationRow(
                notification_id="inapp-1",
                event_type="deposit.confirmed",
                category="deposit",
                severity="success",
                priority="transactional",
                title="Deposit confirmed",
                body="Deposit dep-1 has been credited.",
                action_url="/dashboard/billing/credits",
                resource_type="deposit",
                resource_id="dep-1",
                payload={"amount": "2.000000", "currency": "USDC"},
                read_at=None,
                archived_at=None,
                expires_at=None,
                created_at="2026-04-22T10:00:00.000Z",
            )
        ]
        self.list_calls: list[dict[str, object]] = []
        self.marked: list[str] = []
        self.archived: list[str] = []

    def list_in_app_notifications(self, **kwargs):
        self.list_calls.append(kwargs)
        return list(self.rows)

    def read_in_app_notification_unread_count(self, *, owner_wallet: str) -> int:
        assert owner_wallet == "0xabc"
        return 1

    def mark_in_app_notification_read(self, *, owner_wallet: str, notification_id: str) -> bool:
        assert owner_wallet == "0xabc"
        self.marked.append(notification_id)
        return notification_id == "inapp-1"

    def mark_all_in_app_notifications_read(self, *, owner_wallet: str) -> int:
        assert owner_wallet == "0xabc"
        return 3

    def archive_in_app_notification(self, *, owner_wallet: str, notification_id: str) -> bool:
        assert owner_wallet == "0xabc"
        self.archived.append(notification_id)
        return notification_id == "inapp-1"


async def _background_loop_until_stopped(stop_event, storage) -> None:
    _ = storage
    await stop_event.wait()


@contextmanager
def _http_client(monkeypatch):
    fake_storage = FakeStorage()
    original_require_owner_wallet = credential_service.require_owner_wallet
    monkeypatch.setattr(gateway_app, "create_storage", lambda settings: fake_storage)
    monkeypatch.setattr(gateway_app, "run_v2_deposit_indexer", _background_loop_until_stopped)
    monkeypatch.setattr(gateway_app, "run_service_health_monitor", _background_loop_until_stopped)
    monkeypatch.setattr(gateway_app, "run_provider_withdraw_expiry_reaper", _background_loop_until_stopped)
    monkeypatch.setattr(gateway_app, "run_consumer_withdraw_processor", _background_loop_until_stopped)
    monkeypatch.setattr(gateway_app, "run_in_app_notification_cleanup", _background_loop_until_stopped)
    monkeypatch.setattr(gateway_app.settings, "service_health_monitor_enabled", False, raising=False)
    monkeypatch.setattr(gateway_app.settings, "provider_withdraw_expiry_reaper_enabled", False, raising=False)
    monkeypatch.setattr(gateway_app.settings, "consumer_withdraw_processor_enabled", False, raising=False)
    monkeypatch.setattr(gateway_app.settings, "in_app_notification_cleanup_enabled", False, raising=False)
    monkeypatch.setattr(
        credential_service,
        "require_owner_wallet",
        lambda authorization, x_user_address: (x_user_address or "").lower(),
    )
    try:
        with TestClient(gateway_app.create_app(), base_url="https://gateway.test") as client:
            yield client, fake_storage
    finally:
        credential_service.require_owner_wallet = original_require_owner_wallet


def test_notifications_list_and_unread_count_are_owner_scoped(monkeypatch) -> None:
    with _http_client(monkeypatch) as (client, storage):
        response = client.get(
            "/api/v1/notifications?unreadOnly=true",
            headers={"Authorization": "Bearer test", "X-User-Address": "0xAbC"},
        )
        count_response = client.get(
            "/api/v1/notifications/unread-count",
            headers={"Authorization": "Bearer test", "X-User-Address": "0xAbC"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["notifications"][0]["notificationId"] == "inapp-1"
    assert body["notifications"][0]["payload"] == {"amount": "2.000000", "currency": "USDC"}
    assert body["notifications"][0]["createdAt"].endswith("Z")
    assert body["notifications"][0]["expiresAt"] is None
    assert storage.list_calls[0]["owner_wallet"] == "0xabc"
    assert storage.list_calls[0]["unread_only"] is True
    assert count_response.json()["unreadCount"] == 1


def test_notifications_mark_read_archive_and_mark_all(monkeypatch) -> None:
    with _http_client(monkeypatch) as (client, storage):
        read_response = client.post(
            "/api/v1/notifications/inapp-1/read",
            headers={"Authorization": "Bearer test", "X-User-Address": "0xAbC"},
        )
        archive_response = client.post(
            "/api/v1/notifications/inapp-1/archive",
            headers={"Authorization": "Bearer test", "X-User-Address": "0xAbC"},
        )
        mark_all_response = client.post(
            "/api/v1/notifications/mark-all-read",
            headers={"Authorization": "Bearer test", "X-User-Address": "0xAbC"},
        )

    assert read_response.status_code == 200
    assert archive_response.status_code == 200
    assert mark_all_response.json()["updated"] == 3
    assert storage.marked == ["inapp-1"]
    assert storage.archived == ["inapp-1"]
