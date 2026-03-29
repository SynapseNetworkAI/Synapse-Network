from __future__ import annotations

import asyncio
import hashlib
import json
import time
from contextlib import contextmanager
from types import SimpleNamespace

import jwt
from fastapi.testclient import TestClient

from src import app as gateway_app
from src.api import deps as api_deps
from src.services.platform import internal_auth
from src.storage import get_storage


TEST_INTERNAL_SECRET = "test-internal-secret-32-bytes-min"


class FakeStorage:
    def __init__(self) -> None:
        self.data_manager = SimpleNamespace(
            finance=SimpleNamespace(
                fee_policy=SimpleNamespace(
                    get_platform_fee_policy=lambda: SimpleNamespace(
                        default_rate=0.1,
                        owner_rates={},
                        updated_at=1710000000,
                        updated_by="seed",
                    )
                )
            )
        )

    def get_data_manager(self):
        return self.data_manager


class StubBalanceService:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def review_provider_withdrawal(self, owner_wallet: str, withdrawal_id: str, request_meta=None):
        await asyncio.sleep(0)
        self.calls.append(
            {
                "owner_wallet": owner_wallet,
                "withdrawal_id": withdrawal_id,
                "request_meta": request_meta or {},
            }
        )
        return {"withdrawalId": withdrawal_id, "status": "APPROVED_AUTO"}


async def _background_loop_until_stopped(stop_event, storage) -> None:
    _ = storage
    await stop_event.wait()


def _digest(payload: dict) -> str:
    encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _issue_internal_token(*, payload: dict, request_id: str, token_id: str = "jti-1") -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "iss": "gateway-admin",
            "aud": "gateway-internal",
            "sub": "service:gateway-admin",
            "adminWallet": "0x1111111111111111111111111111111111111111",
            "scope": "provider_withdraw.review",
            "requestId": request_id,
            "bodySha256": _digest(payload),
            "actorAdminId": "adm_finance_reviewer",
            "actorRole": "finance_reviewer",
            "iat": now,
            "exp": now + 120,
            "jti": token_id,
        },
        TEST_INTERNAL_SECRET,
        algorithm="HS256",
    )


@contextmanager
def _client(balance_service: StubBalanceService):
    fake_storage = FakeStorage()
    gateway_app.create_storage = lambda settings: fake_storage
    gateway_app.run_v2_deposit_indexer = _background_loop_until_stopped
    gateway_app.run_service_health_monitor = _background_loop_until_stopped
    gateway_app.settings.service_health_monitor_enabled = False
    gateway_app.run_provider_withdraw_expiry_reaper = _background_loop_until_stopped
    original_get_redis_client = internal_auth.get_redis_client
    original_internal_secret = gateway_app.settings.gateway_internal_jwt_secret
    original_internal_issuer = gateway_app.settings.gateway_internal_token_issuer
    original_internal_audience = gateway_app.settings.gateway_internal_token_audience
    original_internal_subjects = set(gateway_app.settings.gateway_internal_service_subjects)
    original_admin_wallets = set(gateway_app.settings.platform_fee_admin_wallets)
    original_withdraw_reaper_enabled = gateway_app.settings.provider_withdraw_expiry_reaper_enabled
    gateway_app.settings.gateway_internal_jwt_secret = TEST_INTERNAL_SECRET
    gateway_app.settings.gateway_internal_token_issuer = "gateway-admin"
    gateway_app.settings.gateway_internal_token_audience = "gateway-internal"
    gateway_app.settings.gateway_internal_service_subjects = {"service:gateway-admin"}
    gateway_app.settings.platform_fee_admin_wallets = {"0x1111111111111111111111111111111111111111"}
    gateway_app.settings.provider_withdraw_expiry_reaper_enabled = False
    internal_auth.get_redis_client = _no_redis_client
    try:
        app = gateway_app.create_app()
        app.dependency_overrides = {
            api_deps.get_balance_service: lambda: balance_service,
            get_storage: lambda: fake_storage,
        }
        with TestClient(app, base_url="https://gateway.test") as client:
            yield client
    finally:
        internal_auth.get_redis_client = original_get_redis_client
        gateway_app.settings.gateway_internal_jwt_secret = original_internal_secret
        gateway_app.settings.gateway_internal_token_issuer = original_internal_issuer
        gateway_app.settings.gateway_internal_token_audience = original_internal_audience
        gateway_app.settings.gateway_internal_service_subjects = original_internal_subjects
        gateway_app.settings.platform_fee_admin_wallets = original_admin_wallets
        gateway_app.settings.provider_withdraw_expiry_reaper_enabled = original_withdraw_reaper_enabled


async def _no_redis_client():
    return None


def test_internal_admin_review_requires_valid_internal_token() -> None:
    balance_service = StubBalanceService()
    payload = {
        "ownerAddress": "0x2222222222222222222222222222222222222222",
        "reviewDecision": "APPROVE",
        "reviewerAddress": "0x1111111111111111111111111111111111111111",
        "reviewerNote": "Reviewed via internal service auth.",
    }
    token = _issue_internal_token(payload=payload, request_id="req-internal-review")

    with _client(balance_service) as client:
        response = client.post(
            "/api/v1/admin/providers/withdrawals/wd-secure-review/review",
            json=payload,
            headers={"Authorization": f"Bearer {token}", "X-Request-Id": "req-internal-review"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["requestedBy"] == "0x1111111111111111111111111111111111111111"
    assert balance_service.calls[0]["owner_wallet"] == "0x2222222222222222222222222222222222222222"
    assert balance_service.calls[0]["request_meta"]["adminExecution"]["actorAdminId"] == "adm_finance_reviewer"
    assert balance_service.calls[0]["request_meta"]["review"]["actorRole"] == "finance_reviewer"


def test_internal_admin_review_rejects_legacy_owner_token() -> None:
    balance_service = StubBalanceService()
    payload = {
        "ownerAddress": "0x2222222222222222222222222222222222222222",
        "reviewDecision": "APPROVE",
        "reviewerAddress": "0x1111111111111111111111111111111111111111",
        "reviewerNote": "legacy token should fail",
    }

    with _client(balance_service) as client:
        legacy_token = jwt.encode(
            {
                "sub": "0x1111111111111111111111111111111111111111",
                "iat": int(time.time()),
                "exp": int(time.time()) + 120,
            },
            gateway_app.settings.jwt_secret,
            algorithm="HS256",
        )
        response = client.post(
            "/api/v1/admin/providers/withdrawals/wd-legacy/review",
            json=payload,
            headers={
                "Authorization": f"Bearer {legacy_token}",
                "X-User-Address": "0x1111111111111111111111111111111111111111",
            },
        )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "INTERNAL_TOKEN_INVALID"


def test_internal_admin_review_rejects_replayed_token_id() -> None:
    balance_service = StubBalanceService()
    payload = {
        "ownerAddress": "0x2222222222222222222222222222222222222222",
        "reviewDecision": "APPROVE",
        "reviewerAddress": "0x1111111111111111111111111111111111111111",
        "reviewerNote": "duplicate token id should fail",
    }
    token = _issue_internal_token(payload=payload, request_id="req-replay", token_id="replay-jti")

    with _client(balance_service) as client:
        first = client.post(
            "/api/v1/admin/providers/withdrawals/wd-replay/review",
            json=payload,
            headers={"Authorization": f"Bearer {token}", "X-Request-Id": "req-replay"},
        )
        second = client.post(
            "/api/v1/admin/providers/withdrawals/wd-replay/review",
            json=payload,
            headers={"Authorization": f"Bearer {token}", "X-Request-Id": "req-replay"},
        )

    assert first.status_code == 200
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "INTERNAL_TOKEN_REPLAYED"
