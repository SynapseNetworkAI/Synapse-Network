from __future__ import annotations

import asyncio
from contextlib import contextmanager
from types import SimpleNamespace

from fastapi.testclient import TestClient

from src import app as gateway_app
from src.services.platform import credential_service


async def _background_loop_until_stopped(stop_event, storage) -> None:
    _ = storage
    await stop_event.wait()


@contextmanager
def _http_client():
    fake_storage = SimpleNamespace()

    gateway_app.app.dependency_overrides = {}
    gateway_app.create_storage = lambda settings: fake_storage
    gateway_app.run_v2_deposit_indexer = _background_loop_until_stopped
    gateway_app.run_service_health_monitor = _background_loop_until_stopped
    gateway_app.run_provider_withdraw_expiry_reaper = _background_loop_until_stopped
    gateway_app.settings.service_health_monitor_enabled = False
    gateway_app.settings.provider_withdraw_expiry_reaper_enabled = False

    with TestClient(gateway_app.create_app(), base_url="https://gateway.test") as client:
        yield client, fake_storage


def test_agent_delete_routes_support_delete_and_legacy_post(monkeypatch) -> None:
    calls: list[tuple[object, str, str]] = []

    monkeypatch.setattr(
        credential_service,
        "require_owner_wallet",
        lambda authorization, x_user_address: x_user_address or "",
    )

    async def _stub_delete(storage, owner_wallet, credential_id):
        await asyncio.sleep(0)
        calls.append((storage, owner_wallet, credential_id))
        return {"status": "success", "credential": {"id": credential_id}}

    monkeypatch.setattr(
        credential_service,
        "delete_credential_for_owner",
        _stub_delete,
    )

    with _http_client() as (client, fake_storage):
        delete_response = client.delete(
            "/api/v1/credentials/agent/agent-123",
            headers={"X-User-Address": "0xowner"},
        )
        post_response = client.post(
            "/api/v1/credentials/agent/agent-456/delete",
            headers={"X-User-Address": "0xowner"},
        )

    assert delete_response.status_code == 200
    assert delete_response.json() == {
        "status": "success",
        "credential": {"id": "agent-123"},
    }
    assert post_response.status_code == 200
    assert post_response.json() == {
        "status": "success",
        "credential": {"id": "agent-456"},
    }
    assert calls == [
        (fake_storage, "0xowner", "agent-123"),
        (fake_storage, "0xowner", "agent-456"),
    ]
