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
        self.raise_daily_limit = False

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
        old_email = self.profile.email
        if email is None:
            next_email = None
            pending_email = None
            email_verified = False
        elif email == old_email:
            next_email = old_email
            pending_email = None
            email_verified = self.profile.email_verified
        else:
            next_email = old_email
            pending_email = email
            email_verified = bool(old_email and self.profile.email_verified)
        self.profile = OwnerProfileRecord(
            ownerId="owner:0xabc",
            ownerWallet="0xabc",
            displayName=display_name,
            email=next_email,
            emailVerified=email_verified,
            pendingEmail=pending_email,
            notifyMarketing=notify_marketing,
            notifyAlerts=notify_alerts,
            createdAt="2026-04-03 10:00:00",
            updatedAt="2026-04-03 10:05:00",
        )
        return self.profile

    def prepare_owner_email_verification_code(
        self,
        wallet: str,
        email: str,
        *,
        code_hash: str,
        expires_at,
        daily_limit: int,
        send_date,
    ) -> OwnerProfileRecord:
        _ = code_hash, daily_limit, send_date
        if self.raise_daily_limit:
            raise ValueError("EMAIL_VERIFICATION_DAILY_LIMIT_REACHED")
        self.profile = self.profile.model_copy(
            update={
                "pending_email": email,
                "email_verification_expires_at": expires_at.strftime(
                    "%Y-%m-%d %H:%M:%S"
                ),
                "email_verification_attempts": 0,
            }
        )
        return self.profile

    def mark_owner_email_verification_sent(
        self,
        wallet: str,
        email: str,
        *,
        send_date,
    ) -> OwnerProfileRecord | None:
        _ = wallet, email
        self.profile = self.profile.model_copy(
            update={
                "email_verification_send_count": self.profile.email_verification_send_count + 1,
                "email_verification_send_count_date": str(send_date),
            }
        )
        return self.profile

    def verify_owner_email_code(
        self,
        wallet: str,
        email: str,
        *,
        code_hash: str,
        now,
    ) -> OwnerProfileRecord:
        _ = code_hash, now
        if wallet != self.profile.owner_wallet or email != self.profile.pending_email:
            raise ValueError("EMAIL_VERIFICATION_NOT_PENDING")
        self.profile = OwnerProfileRecord(
            ownerId=self.profile.owner_id,
            ownerWallet=self.profile.owner_wallet,
            displayName=self.profile.display_name,
            email=email,
            emailVerified=True,
            pendingEmail=None,
            notifyMarketing=self.profile.notify_marketing,
            notifyAlerts=self.profile.notify_alerts,
            createdAt=self.profile.created_at,
            updatedAt="2026-04-03 10:10:00",
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
        self.outbox: list[object] = []
        self.data_manager = SimpleNamespace(
            system=SimpleNamespace(credential_auth=self.credential_auth),
            audit=SimpleNamespace(logs=self.audit),
        )

    def get_data_manager(self):
        return self.data_manager

    def enqueue_notification_outbox(self, intent) -> None:
        self.outbox.append(intent)


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


def test_get_me_marks_pending_email_without_active_code_expired(monkeypatch) -> None:
    with _http_client(monkeypatch) as (client, storage):
        storage.credential_auth.profile = storage.credential_auth.profile.model_copy(
            update={
                "pending_email": "cliff@synapse-network.ai",
                "email_verification_expires_at": None,
                "email_verification_send_count": 0,
            }
        )
        response = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": "Bearer test", "X-User-Address": "0xAbC"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["profile"]["pendingEmail"] == "cliff@synapse-network.ai"
    assert body["profile"]["emailVerificationStatus"] == "expired"
    assert body["profile"]["emailVerificationSendsRemaining"] == 5


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


def test_update_profile_stages_new_email_and_sends_code(monkeypatch) -> None:
    monkeypatch.setattr(
        auth_router.settings,
        "auth_secret",
        "unit-test-auth-secret-with-enough-entropy",
        raising=False,
    )
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
    assert body["profile"]["email"] == "ops@synapse.test"
    assert body["profile"]["pendingEmail"] == "infra@synapse.test"
    assert body["profile"]["emailVerificationStatus"] == "pending"
    assert body["profile"]["emailVerificationSendsRemaining"] == 4
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
    assert len(storage.outbox) == 1
    assert storage.outbox[0].recipient_email == "infra@synapse.test"
    assert storage.outbox[0].template_key == "email_verification"
    audit_detail = storage.audit.rows[0].details
    assert audit_detail["emailMasked"] == "o***@synapse.test"
    assert audit_detail["pendingEmailMasked"] == "i***@synapse.test"
    assert audit_detail["notifyMarketing"] is False


def test_update_profile_removes_verified_email_and_clears_pending(monkeypatch) -> None:
    with _http_client(monkeypatch) as (client, storage):
        storage.credential_auth.profile = storage.credential_auth.profile.model_copy(
            update={
                "email": "ops@synapse.test",
                "email_verified": True,
                "pending_email": "infra@synapse.test",
            }
        )
        response = client.put(
            "/api/v1/auth/me/profile",
            json={
                "displayName": "Synapse Ops",
                "email": None,
                "notifyMarketing": True,
                "notifyAlerts": True,
                "message": "Update Synapse account profile\nWallet: 0xabc\nPayload Hash: fake",
                "signature": "0xsigned",
            },
            headers={"Authorization": "Bearer test", "X-User-Address": "0xabc"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["profile"]["email"] is None
    assert body["profile"]["emailVerified"] is False
    assert body["profile"]["pendingEmail"] is None
    assert storage.outbox[-1].template_key == "email_removed_notice"


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


def test_verify_email_code_marks_profile_verified_and_audits(monkeypatch) -> None:
    with _http_client(monkeypatch) as (client, storage):
        storage.credential_auth.profile = storage.credential_auth.profile.model_copy(
            update={"pending_email": "infra@synapse.test"}
        )
        response = client.post(
            "/api/v1/auth/email/verify-code",
            json={"email": "infra@synapse.test", "code": "123456"},
            headers={"Authorization": "Bearer test", "X-User-Address": "0xAbC"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["profile"]["email"] == "infra@synapse.test"
    assert body["profile"]["emailVerified"] is True
    assert body["profile"]["pendingEmail"] is None
    assert storage.credential_auth.profile.email_verified is True
    assert storage.audit.rows[-1].action == "OWNER_EMAIL_VERIFIED"


def test_verify_email_code_rejects_non_pending_email(monkeypatch) -> None:
    with _http_client(monkeypatch) as (client, _storage):
        response = client.post(
            "/api/v1/auth/email/verify-code",
            json={"email": "missing@synapse.test", "code": "123456"},
            headers={"Authorization": "Bearer test", "X-User-Address": "0xAbC"},
        )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "EMAIL_VERIFICATION_NOT_PENDING"


def test_update_profile_daily_email_limit_returns_429(monkeypatch) -> None:
    with _http_client(monkeypatch) as (client, storage):
        storage.credential_auth.raise_daily_limit = True
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

    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "EMAIL_VERIFICATION_DAILY_LIMIT_REACHED"
