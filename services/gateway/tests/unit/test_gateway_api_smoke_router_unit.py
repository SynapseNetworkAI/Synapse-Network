from __future__ import annotations

import asyncio
from contextlib import contextmanager
from types import SimpleNamespace

from fastapi import HTTPException
from fastapi.testclient import TestClient

from src import app as gateway_app
from src.api import deps as api_deps
from src.api.schemas.pydantic_models import InferenceRequest
from src.services.owner import forwarding_service


class StubRegistryService:
    def __init__(self, response: list[dict[str, object]] | None = None) -> None:
        self.response = list(response or [])
        self.calls: list[dict[str, object]] = []

    async def discover_services(
        self,
        intent: str | None,
        *,
        public_gateway_url: str,
        sort_by: str,
        sort_order: str,
    ) -> list[dict[str, object]]:
        await asyncio.sleep(0)
        self.calls.append(
            {
                "intent": intent,
                "public_gateway_url": public_gateway_url,
                "sort_by": sort_by,
                "sort_order": sort_order,
            }
        )
        return list(self.response)


async def _background_loop_until_stopped(stop_event, storage) -> None:
    _ = storage
    await stop_event.wait()


@contextmanager
def _http_client(monkeypatch, *, registry_service: StubRegistryService | None = None):
    fake_storage = SimpleNamespace()

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

    app = gateway_app.create_app()
    app.dependency_overrides = {}
    if registry_service is not None:
        app.dependency_overrides[api_deps.get_registry_service] = lambda: registry_service

    with TestClient(app, base_url="https://gateway.test") as client:
        yield client


def test_services_discover_router_builds_public_gateway_url(monkeypatch) -> None:
    registry_service = StubRegistryService(
        response=[{"serviceId": "svc_web3_sentiment_index", "serviceName": "Web3 Sentiment Index"}]
    )

    with _http_client(monkeypatch, registry_service=registry_service) as client:
        response = client.get(
            "/api/v1/services/discover",
            params={"intent": "sentiment", "sortBy": "best_match", "sortOrder": "desc"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "status": "success",
        "services": [
            {
                "serviceId": "svc_web3_sentiment_index",
                "serviceName": "Web3 Sentiment Index",
            }
        ],
        "count": 1,
    }
    assert registry_service.calls == [
        {
            "intent": "sentiment",
            "public_gateway_url": "https://gateway.test/api/v1/gateway/generate",
            "sort_by": "best_match",
            "sort_order": "desc",
        }
    ]


def test_gateway_generate_router_forwards_headers_and_structured_payload(monkeypatch) -> None:
    calls: list[dict[str, object]] = []

    async def _stub_generate(storage, request, x_service_id, x_credential, x_request_id):
        await asyncio.sleep(0)
        calls.append(
            {
                "storage": storage,
                "request": request,
                "x_service_id": x_service_id,
                "x_credential": x_credential,
                "x_request_id": x_request_id,
            }
        )
        return {
            "success": True,
            "requestId": x_request_id,
            "serviceId": x_service_id,
            "data": {"result": {"symbol": request.payload["symbol"]}},
        }

    monkeypatch.setattr(forwarding_service, "generate_response_v2", _stub_generate)

    with _http_client(monkeypatch) as client:
        response = client.post(
            "/api/v1/gateway/generate",
            json={
                "serviceId": "svc_web3_sentiment_index",
                "payload": {
                    "symbol": "ETH",
                    "chain": "ethereum",
                    "lookback_hours": 24,
                },
            },
            headers={
                "X-Service-Id": "svc_web3_sentiment_index",
                "X-Credential": "agt_1234567890abcdef12345678",
                "X-Request-Id": "req-gateway-generate-001",
            },
        )

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "requestId": "req-gateway-generate-001",
        "serviceId": "svc_web3_sentiment_index",
        "data": {"result": {"symbol": "ETH"}},
    }
    assert len(calls) == 1
    forwarded = calls[0]
    assert isinstance(forwarded["request"], InferenceRequest)
    assert forwarded["request"].serviceId == "svc_web3_sentiment_index"
    assert forwarded["request"].payload == {
        "symbol": "ETH",
        "chain": "ethereum",
        "lookback_hours": 24,
    }
    assert forwarded["x_service_id"] == "svc_web3_sentiment_index"
    assert forwarded["x_credential"] == "agt_1234567890abcdef12345678"
    assert forwarded["x_request_id"] == "req-gateway-generate-001"


def test_gateway_generate_router_accepts_body_service_id_without_header(
    monkeypatch,
) -> None:
    calls: list[dict[str, object]] = []

    async def _stub_generate(storage, request, x_service_id, x_credential, x_request_id):
        await asyncio.sleep(0)
        calls.append(
            {
                "storage": storage,
                "request": request,
                "x_service_id": x_service_id,
                "x_credential": x_credential,
                "x_request_id": x_request_id,
            }
        )
        return {"success": True, "serviceId": request.serviceId}

    monkeypatch.setattr(forwarding_service, "generate_response_v2", _stub_generate)

    with _http_client(monkeypatch) as client:
        response = client.post(
            "/api/v1/gateway/generate",
            json={
                "serviceId": "svc_web3_sentiment_index",
                "payload": {"symbol": "BTC"},
            },
            headers={"X-Credential": "agt_1234567890abcdef12345678"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "serviceId": "svc_web3_sentiment_index",
    }
    assert len(calls) == 1
    assert calls[0]["x_service_id"] is None
    assert calls[0]["request"].serviceId == "svc_web3_sentiment_index"


def test_gateway_generate_router_preserves_required_field_error_shape(
    monkeypatch,
) -> None:
    async def _stub_generate(storage, request, x_service_id, x_credential, x_request_id):
        await asyncio.sleep(0)
        raise HTTPException(
            status_code=422,
            detail={
                "code": "REQUEST_REQUIRED_FIELDS_MISSING",
                "message": "service svc_web3_sentiment_index requires fields: symbol",
                "serviceId": "svc_web3_sentiment_index",
                "missingFields": ["symbol"],
            },
        )

    monkeypatch.setattr(forwarding_service, "generate_response_v2", _stub_generate)

    with _http_client(monkeypatch) as client:
        response = client.post(
            "/api/v1/gateway/generate",
            json={"serviceId": "svc_web3_sentiment_index", "payload": {}},
            headers={
                "X-Service-Id": "svc_web3_sentiment_index",
                "X-Credential": "agt_1234567890abcdef12345678",
                "X-Request-Id": "req-gateway-generate-missing-001",
            },
        )

    assert response.status_code == 422
    assert response.json() == {
        "detail": {
            "code": "REQUEST_REQUIRED_FIELDS_MISSING",
            "message": "service svc_web3_sentiment_index requires fields: symbol",
            "serviceId": "svc_web3_sentiment_index",
            "missingFields": ["symbol"],
        }
    }
