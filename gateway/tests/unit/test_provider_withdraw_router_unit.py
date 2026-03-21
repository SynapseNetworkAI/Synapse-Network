from __future__ import annotations

import asyncio
from types import SimpleNamespace

from fastapi import HTTPException
from fastapi.testclient import TestClient

from src import app as gateway_app
from src.api import deps as api_deps
from src.services.platform import credential_service
from src.storage import get_storage


class StubBalanceService:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def create_provider_withdraw_intent(
        self,
        payload: dict[str, object],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: dict[str, object] | None = None,
    ) -> dict[str, object]:
        await asyncio.sleep(0)
        self.calls.append(
            {
                "payload": payload,
                "owner_wallet": owner_wallet,
                "idempotency_key": idempotency_key,
                "request_meta": request_meta or {},
            }
        )
        raise HTTPException(
            status_code=503,
            detail={
                "code": "WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE",
                "message": "Unable to verify vault liquidity right now. Retry after the gateway reconnects to chain RPC.",
            },
        )


async def _background_loop_until_stopped(stop_event, storage) -> None:
    _ = storage
    await stop_event.wait()


def test_provider_withdraw_intent_router_preserves_service_unavailable_error_shape(monkeypatch) -> None:
    balance_service = StubBalanceService()
    fake_storage = SimpleNamespace()

    monkeypatch.setattr(gateway_app, "create_storage", lambda settings: fake_storage)
    monkeypatch.setattr(gateway_app, "run_v2_deposit_indexer", _background_loop_until_stopped)
    monkeypatch.setattr(gateway_app, "run_service_health_monitor", _background_loop_until_stopped)
    monkeypatch.setattr(gateway_app, "run_provider_withdraw_expiry_reaper", _background_loop_until_stopped)
    monkeypatch.setattr(gateway_app.settings, "service_health_monitor_enabled", False, raising=False)
    monkeypatch.setattr(gateway_app.settings, "provider_withdraw_expiry_reaper_enabled", False, raising=False)
    monkeypatch.setattr(
        credential_service,
        "require_owner_wallet",
        lambda authorization, x_user_address: x_user_address or "",
    )

    app = gateway_app.create_app()
    app.dependency_overrides = {
        api_deps.get_balance_service: lambda: balance_service,
        get_storage: lambda: fake_storage,
    }

    with TestClient(app, base_url="https://gateway.test") as client:
        response = client.post(
            "/api/v1/providers/withdrawals/intent",
            json={"amountUsdc": 8.5},
            headers={
                "X-User-Address": "0xabc",
                "X-Idempotency-Key": "provider_withdraw_router_test_0001",
                "X-Request-Id": "req-provider-withdraw-503",
            },
        )

    assert response.status_code == 503
    assert response.json() == {
        "detail": {
            "code": "WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE",
            "message": "Unable to verify vault liquidity right now. Retry after the gateway reconnects to chain RPC.",
        }
    }
    assert balance_service.calls == [
        {
            "payload": {"amountUsdc": 8.5},
            "owner_wallet": "0xabc",
            "idempotency_key": "provider_withdraw_router_test_0001",
            "request_meta": {
                "requestId": "req-provider-withdraw-503",
                "clientIp": "testclient",
                "userAgent": "testclient",
            },
        }
    ]