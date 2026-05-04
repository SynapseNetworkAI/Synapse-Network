from __future__ import annotations

import asyncio
from contextlib import contextmanager
from types import SimpleNamespace

from fastapi.testclient import TestClient

from src import app as gateway_app
from src.api import deps as api_deps


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
            "public_gateway_url": "https://gateway.test/api/v1/agent/invoke",
            "sort_by": "best_match",
            "sort_order": "desc",
        }
    ]


def test_staging_http_500_drill_is_disabled_by_default(monkeypatch) -> None:
    monkeypatch.setattr(gateway_app.settings, "environment", "staging", raising=False)
    monkeypatch.setattr(
        gateway_app.settings, "staging_alert_drill_enabled", False, raising=False
    )

    with _http_client(monkeypatch) as client:
        response = client.get(
            "/api/v1/ops/drills/http-500",
            headers={"X-Synapse-Drill-Token": "drill-token"},
        )

    assert response.status_code == 404


def test_staging_http_500_drill_returns_controlled_500(monkeypatch) -> None:
    monkeypatch.setattr(gateway_app.settings, "environment", "staging", raising=False)
    monkeypatch.setattr(
        gateway_app.settings, "staging_alert_drill_enabled", True, raising=False
    )
    monkeypatch.setattr(
        gateway_app.settings, "staging_alert_drill_token", "drill-token", raising=False
    )

    with _http_client(monkeypatch) as client:
        response = client.get(
            "/api/v1/ops/drills/http-500",
            headers={"X-Synapse-Drill-Token": "drill-token"},
        )

    assert response.status_code == 500
    assert "Controlled staging alert drill" in response.text


def test_staging_http_500_drill_refuses_prod_even_when_enabled(monkeypatch) -> None:
    monkeypatch.setattr(gateway_app.settings, "environment", "prod", raising=False)
    monkeypatch.setattr(
        gateway_app.settings, "staging_alert_drill_enabled", True, raising=False
    )
    monkeypatch.setattr(
        gateway_app.settings, "staging_alert_drill_token", "drill-token", raising=False
    )

    with _http_client(monkeypatch) as client:
        response = client.get(
            "/api/v1/ops/drills/http-500",
            headers={"X-Synapse-Drill-Token": "drill-token"},
        )

    assert response.status_code == 404


def test_legacy_gateway_generate_route_is_removed(monkeypatch) -> None:
    with _http_client(monkeypatch) as client:
        response = client.post(
            f"/api/v1/{'gateway'}/{'generate'}",
            json={"serviceId": "svc_web3_sentiment_index"},
            headers={"X-Credential": "agt_1234567890abcdef12345678"},
        )

    assert response.status_code == 404
