from __future__ import annotations

import asyncio
from contextlib import contextmanager
from types import SimpleNamespace

from fastapi.testclient import TestClient

from src import app as gateway_app
from src.domain.finance import UsageLogRow
from src.domain.registry import ServiceTargetHealth
from src.domain.service_contract import ServiceDefinitionRecord
from src.services.platform import credential_service


class InMemoryGatewayStateRepo:
    def __init__(self, usage_rows: list[UsageLogRow]) -> None:
        self.usage_rows = list(usage_rows)

    def read_invocation_billing_rows(self):
        return list(self.usage_rows)


class InMemoryRegistryRepo:
    def __init__(self, services: list[ServiceDefinitionRecord]) -> None:
        self._rows = list(services)

    def read_service_registry_rows(self):
        return list(self._rows)

    def write_service_registry_rows(self, rows):
        self._rows = list(rows)

    def read_service_target_health_rows(self):
        rows: list[ServiceTargetHealth] = []
        now_ms = credential_service.now_ts() * 1000
        for service in self._rows:
            for target in service.invoke.targets:
                rows.append(
                    ServiceTargetHealth(
                        serviceId=service.service_id,
                        ownerAddress=service.owner_address,
                        targetUrl=target.url,
                        weight=target.weight,
                        region=target.region,
                        status="healthy",
                        overallStatus="healthy",
                        httpStatus=200,
                        latencyMs=32,
                        consecutiveSuccesses=4,
                        consecutiveFailures=0,
                        probeUrl=f"{target.url}/health",
                        lastCheckedAt=now_ms,
                        lastHealthyAt=now_ms,
                        error=None,
                    )
                )
        return rows


class FakeStorage:
    def __init__(self, services: list[ServiceDefinitionRecord], usage_rows: list[UsageLogRow]) -> None:
        self.data_manager = SimpleNamespace(
            system=SimpleNamespace(
                registry=InMemoryRegistryRepo(services),
                gateway_state=InMemoryGatewayStateRepo(usage_rows),
            )
        )

    def get_data_manager(self):
        return self.data_manager


async def _background_loop_until_stopped(stop_event, storage) -> None:
    _ = storage
    await stop_event.wait()


def _service_definition(service_id: str, owner_address: str, target_url: str) -> ServiceDefinitionRecord:
    return ServiceDefinitionRecord(
        serviceId=service_id,
        ownerAddress=owner_address,
        serviceName=f"{service_id} name",
        summary="Public service for network stats.",
        status="active",
        isActive=True,
        pricingAmount="0.01",
        pricingCurrency="USDC",
        constraints={
            "timeoutMs": 15000,
            "maxQps": 10,
            "maxRequestBytes": 4096,
            "maxResponseBytes": 4096,
        },
        forwarding={"requestIdHeader": "X-Synapse-Request-Id"},
        invoke={
            "method": "POST",
            "targets": [{"url": target_url, "weight": 100}],
            "request": {
                "contentType": "application/json",
                "schema": {"body": {"required": ["text"]}},
            },
            "response": {
                "contentType": "application/json",
                "schema": {"body": {}},
            },
        },
    )


@contextmanager
def _http_runtime_client(storage: FakeStorage):
    gateway_app.app.dependency_overrides = {}
    gateway_app.create_storage = lambda settings: storage
    gateway_app.run_v2_deposit_indexer = _background_loop_until_stopped
    gateway_app.run_service_health_monitor = _background_loop_until_stopped
    gateway_app.settings.service_health_monitor_enabled = False
    with TestClient(gateway_app.create_app(), base_url="https://gateway.test") as client:
        yield client


def test_public_network_stats_returns_public_aggregate_counts() -> None:
    services = [
        _service_definition("svc.alpha", "0xprovider-a", "https://a.test/invoke"),
        _service_definition("svc.beta", "0xprovider-b", "https://b.test/invoke"),
    ]
    usage_rows = [
        UsageLogRow(
            id="row-1",
            ts=1710000001,
            requestId="req-1",
            serviceId="svc.alpha",
            consumerAddress="0xagent-1",
            providerAddress="0xprovider-a",
            status="accepted",
            businessType="charge",
        ),
        UsageLogRow(
            id="row-2",
            ts=1710000002,
            requestId="req-1",
            serviceId="svc.alpha",
            consumerAddress="0xagent-1",
            providerAddress="0xprovider-a",
            status="succeeded",
            businessType="charge",
        ),
        UsageLogRow(
            id="row-3",
            ts=1710000003,
            requestId="req-2",
            serviceId="svc.beta",
            consumerAddress="0xagent-2",
            providerAddress="0xprovider-b",
            status="succeeded",
            businessType="charge",
        ),
        UsageLogRow(
            id="row-4",
            ts=1710000004,
            requestId="req-3",
            serviceId="svc.beta",
            consumerAddress="0xagent-3",
            providerAddress="0xprovider-b",
            status="failed",
            businessType="charge",
        ),
    ]
    storage = FakeStorage(services, usage_rows)

    with _http_runtime_client(storage) as client:
        response = client.get("/api/v1/services/network-stats")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "success"
    assert payload["registeredServices"] == 2
    assert payload["runtimeReadyServices"] == 2
    assert payload["totalCalls"] == 2
    assert payload["connectedAgents"] == 2
    assert payload["statusBreakdown"] == {
        "accepted": 1,
        "succeeded": 2,
        "failed": 1,
    }