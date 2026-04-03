from __future__ import annotations

import asyncio
from contextlib import contextmanager
from types import SimpleNamespace

from fastapi.testclient import TestClient

from src import app as gateway_app
from src.api.routers import auth as auth_router
from src.domain.identity import OwnerProfileRecord
from src.services.platform import credential_service


class FakeCredentialAuthRepo:
    def __init__(self) -> None:
        self.profile = OwnerProfileRecord(
            ownerId="owner:0xabc",
            ownerWallet="0xabc",
            displayName="Synapse Ops",
            email="ops@synapse.test",
            emailVerified=False,
            notifyMarketing=True,
            notifyAlerts=True,
            createdAt="2026-04-03 10:00:00",
            updatedAt="2026-04-03 10:00:00",
        )
        self.update_calls: list[dict[str, object]] = []
        self.read_calls: list[tuple[str, bool]] = []
        self.raise_email_conflict = False

    def read_owner_profile(
        self, wallet: str, *, ensure_exists: bool = True
    ) -> OwnerProfileRecord:
        self.read_calls.append((wallet, ensure_exists))
        return self.profile

    def update_owner_profile(
        self,
        wallet: str,
        *,
        display_name: str | None,
        email: str | None,
        notify_marketing: bool,
        notify_alerts: bool,
    ) -> OwnerProfileRecord:
        if self.raise_email_conflict:
            raise ValueError("EMAIL_ALREADY_IN_USE")
        self.update_calls.append(
            {
                "wallet": wallet,
                "display_name": display_name,
                "email": email,
                "notify_marketing": notify_marketing,
                "notify_alerts": notify_alerts,
            }
        )
        self.profile = OwnerProfileRecord(
            ownerId="owner:0xabc",
            ownerWallet="0xabc",
            displayName=display_name,
            email=email,
            emailVerified=False,
            notifyMarketing=notify_marketing,
            notifyAlerts=notify_alerts,
            createdAt="2026-04-03 10:00:00",
            updatedAt="2026-04-03 10:05:00",
        )
        return self.profile


class FakeAuditRepo:
    def __init__(self) -> None:
        self.rows: list[object] = []

    def append_audit_row(self, row) -> None:
        self.rows.append(row)


class FakeStorage:
    def __init__(self) -> None:
        self.credential_auth = FakeCredentialAuthRepo()
        self.audit = FakeAuditRepo()
        self.data_manager = SimpleNamespace(
            system=SimpleNamespace(credential_auth=self.credential_auth),
            audit=SimpleNamespace(logs=self.audit),
        )

    def get_data_manager(self):
        return self.data_manager


async def _background_loop_until_stopped(stop_event, storage) -> None:
    _ = storage
    await stop_event.wait()


@contextmanager
def _http_client(monkeypatch):
    fake_storage = FakeStorage()
    original_require_owner_wallet = credential_service.require_owner_wallet
    original_create_profile_challenge = auth_router.create_owner_profile_update_challenge
    original_verify_profile_signature = auth_router.verify_owner_profile_update_signature

    monkeypatch.setattr(gateway_app, "create_storage", lambda settings: fake_storage)
    monkeypatch.setattr(
        gateway_app, "run_v2_deposit_indexer", _background_loop_until_stopped
    )
    monkeypatch.setattr(
        gateway_app, "run_service_health_monitor", _background_loop_until_stopped
    )
    monkeypatch.setattr(
        gateway_app,
        "run_provider_withdraw_expiry_reaper",
        _background_loop_until_stopped,
    )
    monkeypatch.setattr(
        gateway_app.settings, "service_health_monitor_enabled", False, raising=False
    )
    monkeypatch.setattr(
        gateway_app.settings,
        "provider_withdraw_expiry_reaper_enabled",
        False,
        raising=False,
    )
    monkeypatch.setattr(
        credential_service,
        "require_owner_wallet",
        lambda authorization, x_user_address: (x_user_address or "").lower(),
    )
    monkeypatch.setattr(
        auth_router,
        "create_owner_profile_update_challenge",
        lambda wallet, payload: (
            f"Update Synapse account profile\nWallet: {wallet}\nPayload Hash: fake"
        ),
    )
    monkeypatch.setattr(
        auth_router,
        "verify_owner_profile_update_signature",
        lambda wallet, payload, signature, message: bool(signature and message),
    )

    try:
        with TestClient(gateway_app.create_app(), base_url="https://gateway.test") as client:
            yield client, fake_storage
    finally:
        credential_service.require_owner_wallet = original_require_owner_wallet
        auth_router.create_owner_profile_update_challenge = original_create_profile_challenge
        auth_router.verify_owner_profile_update_signature = original_verify_profile_signature


def test_get_me_returns_owner_profile(monkeypatch) -> None:
    with _http_client(monkeypatch) as (client, storage):
        response = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": "Bearer test", "X-User-Address": "0xAbC"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["profile"]["ownerAddress"] == "0xabc"
    assert body["profile"]["displayName"] == "Synapse Ops"
    assert storage.credential_auth.read_calls == [("0xabc", True)]


def test_profile_challenge_uses_owner_scoped_payload(monkeypatch) -> None:
    with _http_client(monkeypatch) as (client, _storage):
        response = client.post(
            "/api/v1/auth/me/profile/challenge",
            json={
                "displayName": "Infra Desk",
                "email": "ops@synapse.test",
                "notifyMarketing": False,
                "notifyAlerts": True,
            },
            headers={"Authorization": "Bearer test", "X-User-Address": "0xabc"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert "Update Synapse account profile" in body["challenge"]
    assert body["expiresInSec"] > 0


def test_update_profile_persists_and_audits(monkeypatch) -> None:
    with _http_client(monkeypatch) as (client, storage):
        response = client.put(
            "/api/v1/auth/me/profile",
            json={
                "displayName": "Infra Desk",
                "email": "infra@synapse.test",
                "notifyMarketing": False,
                "notifyAlerts": True,
                "message": "Update Synapse account profile\nWallet: 0xabc\nPayload Hash: fake",
                "signature": "0xsigned",
            },
            headers={"Authorization": "Bearer test", "X-User-Address": "0xabc"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["profile"]["displayName"] == "Infra Desk"
    assert body["profile"]["email"] == "infra@synapse.test"
    assert storage.credential_auth.update_calls == [
        {
            "wallet": "0xabc",
            "display_name": "Infra Desk",
            "email": "infra@synapse.test",
            "notify_marketing": False,
            "notify_alerts": True,
        }
    ]
    assert len(storage.audit.rows) == 1
    audit_detail = storage.audit.rows[0].details
    assert audit_detail["emailMasked"] == "i***@synapse.test"
    assert audit_detail["notifyMarketing"] is False


def test_update_profile_maps_email_conflict(monkeypatch) -> None:
    with _http_client(monkeypatch) as (client, storage):
        storage.credential_auth.raise_email_conflict = True
        response = client.put(
            "/api/v1/auth/me/profile",
            json={
                "displayName": "Infra Desk",
                "email": "infra@synapse.test",
                "notifyMarketing": False,
                "notifyAlerts": True,
                "message": "Update Synapse account profile\nWallet: 0xabc\nPayload Hash: fake",
                "signature": "0xsigned",
            },
            headers={"Authorization": "Bearer test", "X-User-Address": "0xabc"},
        )

    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "EMAIL_ALREADY_IN_USE",
        "message": "Email address is already linked to another wallet.",
    }
