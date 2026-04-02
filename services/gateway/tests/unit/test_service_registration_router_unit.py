from __future__ import annotations

import asyncio
from contextlib import contextmanager
from types import SimpleNamespace

from fastapi.testclient import TestClient

from src import app as gateway_app
from src.api import deps as api_deps
from src.services.platform import credential_service


class StubRegistryService:
    def __init__(self, response: dict[str, object] | None = None, error: Exception | None = None) -> None:
        self.response = response or {}
        self.error = error
        self.calls: list[dict[str, object]] = []

    async def register_service(
        self, payload: dict[str, object], owner_wallet: str
    ) -> dict[str, object]:
        await asyncio.sleep(0)
        self.calls.append({"payload": dict(payload), "owner_wallet": owner_wallet})
        if self.error is not None:
            raise self.error
        return dict(self.response)


async def _background_loop_until_stopped(stop_event, storage) -> None:
    _ = storage
    await stop_event.wait()


@contextmanager
def _http_client(monkeypatch, *, registry_service: StubRegistryService | None = None):
    fake_storage = SimpleNamespace()
    original_require_owner_wallet = credential_service.require_owner_wallet

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
        lambda authorization, x_user_address: x_user_address or "",
    )

    app = gateway_app.create_app()
    app.dependency_overrides = {}
    if registry_service is not None:
        app.dependency_overrides[api_deps.get_registry_service] = lambda: registry_service

    try:
        with TestClient(app, base_url="https://gateway.test") as client:
            yield client
    finally:
        credential_service.require_owner_wallet = original_require_owner_wallet


def _provider_registration_payload() -> dict[str, object]:
    return {
        "agentToolName": "svc_web3_sentiment_index",
        "serviceName": "Web3 Sentiment Index",
        "pricing": "0.01",
        "summary": "Return a structured crypto market sentiment score.",
        "status": "active",
        "isActive": True,
        "auth": {"type": "gateway_signed"},
        "providerProfile": {"displayName": "Sentiment Desk"},
        "payoutAccount": {
            "payoutAddress": "0x1234567890abcdef1234567890abcdef12345678",
            "chainId": 8453,
            "settlementCurrency": "USDC",
        },
        "governance": {"termsAccepted": True, "riskAcknowledged": True},
        "healthCheck": {
            "path": "/health",
            "method": "GET",
            "timeoutMs": 3000,
            "successCodes": [200],
            "healthyThreshold": 2,
            "unhealthyThreshold": 3,
        },
        "constraints": {
            "timeoutMs": 8000,
            "maxResponseBytes": 131072,
            "maxRequestBytes": 131072,
            "maxQps": 20,
        },
        "invoke": {
            "method": "POST",
            "targets": [
                {
                    "url": "https://provider.test/provider-services/web3-sentiment-index/invoke",
                    "weight": 100,
                }
            ],
            "timeoutMs": 8000,
            "request": {
                "contentType": "application/json",
                "schema": {"body": {"type": "object", "required": ["symbol"]}},
            },
            "response": {
                "contentType": "application/json",
                "schema": {"body": {"type": "object"}},
            },
        },
    }


def test_registration_guide_returns_provider_onboarding_fields(monkeypatch) -> None:
    with _http_client(monkeypatch) as client:
        response = client.get(
            "/api/v1/services/registration-guide",
            headers={"X-User-Address": "0xabc"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert "progressive disclosure" in body["designStyle"]
    field_keys = {field["key"] for field in body["fields"]}
    assert {"serviceName", "agentToolName", "invoke.targets", "healthCheck.path"} <= field_keys


def test_register_service_router_binds_agent_tool_name_for_provider_registration(
    monkeypatch,
) -> None:
    payload = _provider_registration_payload()
    registry_service = StubRegistryService(
        response={
            "serviceId": "svc_web3_sentiment_index",
            "serviceName": "Web3 Sentiment Index",
            "auth": {"type": "gateway_signed"},
            "providerProfile": {"displayName": "Sentiment Desk"},
        }
    )

    with _http_client(monkeypatch, registry_service=registry_service) as client:
        response = client.post(
            "/api/v1/services",
            json=payload,
            headers={"X-User-Address": "0xabc"},
        )

    assert response.status_code == 200
    assert response.json()["serviceId"] == "svc_web3_sentiment_index"
    assert len(registry_service.calls) == 1
    recorded_call = registry_service.calls[0]
    recorded_payload = recorded_call["payload"]
    assert recorded_call["owner_wallet"] == "0xabc"
    assert recorded_payload["serviceId"] == "svc_web3_sentiment_index"
    assert recorded_payload["auth"] == {"type": "gateway_signed"}
    assert recorded_payload["providerProfile"]["displayName"] == "Sentiment Desk"
    assert recorded_payload["payoutAccount"]["chainId"] == 8453
    assert recorded_payload["governance"]["termsAccepted"] is True
    assert recorded_payload["invoke"]["targets"][0]["url"].endswith(
        "/provider-services/web3-sentiment-index/invoke"
    )
    assert recorded_payload["forwarding"]["requestIdHeader"] == "X-Synapse-Request-Id"
    assert recorded_payload["metering"]["requestIdRequired"] is True


def test_register_service_router_maps_registry_validation_errors(monkeypatch) -> None:
    registry_service = StubRegistryService(
        error=ValueError(
            "auth.type must be gateway_signed for /provider-services targets"
        )
    )

    with _http_client(monkeypatch, registry_service=registry_service) as client:
        response = client.post(
            "/api/v1/services",
            json=_provider_registration_payload(),
            headers={"X-User-Address": "0xabc"},
        )

    assert response.status_code == 422
    assert response.json() == {
        "detail": {
            "code": "SERVICE_REGISTRATION_INVALID",
            "message": "auth.type must be gateway_signed for /provider-services targets",
        }
    }


def test_register_service_router_rejects_mismatched_service_id_and_agent_tool_name(
    monkeypatch,
) -> None:
    payload = _provider_registration_payload()
    payload["serviceId"] = "svc_mismatch"

    with _http_client(monkeypatch) as client:
        response = client.post(
            "/api/v1/services",
            json=payload,
            headers={"X-User-Address": "0xabc"},
        )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert any(
        entry["msg"].endswith(
            "serviceId must match agentToolName when both are provided"
        )
        for entry in detail
    )
