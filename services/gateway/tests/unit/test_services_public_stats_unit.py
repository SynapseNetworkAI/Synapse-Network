from __future__ import annotations

import asyncio
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from src import app as gateway_app
from src.domain.finance import UsageLogRow
from src.domain.registry import ServiceTargetHealth
from src.domain.service_contract import ServiceDefinitionRecord, ServiceRuntimeHealthRecord
from src.services.platform import credential_service
from src.services.platform import service_health_service
from src.services.platform import service_health_utils


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
            target_health_by_url = {
                str(target.target_url): target
                for target in (service.runtime_health.targets if service.runtime_health else [])
                if str(target.target_url or "").strip()
            }
            for target in service.invoke.targets:
                target_health = target_health_by_url.get(str(target.url))
                rows.append(
                    ServiceTargetHealth(
                        serviceId=service.service_id,
                        ownerAddress=service.owner_address,
                        targetUrl=target.url,
                        weight=target.weight,
                        region=target.region,
                        status=str(getattr(target_health, "status", None) or "healthy"),
                        overallStatus=str(service.runtime_health.overall_status if service.runtime_health else "healthy"),
                        httpStatus=getattr(target_health, "http_status", 200),
                        latencyMs=getattr(target_health, "latency_ms", 32),
                        consecutiveSuccesses=int(getattr(target_health, "consecutive_successes", 4) or 0),
                        consecutiveFailures=int(getattr(target_health, "consecutive_failures", 0) or 0),
                        probeUrl=getattr(target_health, "probe_url", f"{target.url}/health"),
                        lastCheckedAt=getattr(target_health, "last_checked_at", now_ms),
                        lastHealthyAt=getattr(target_health, "last_healthy_at", now_ms),
                        error=getattr(target_health, "error", None),
                    )
                )
        return rows

    def write_service_target_health_rows(self, rows):
        for service in self._rows:
            matched_targets = [
                row
                for row in rows
                if row.service_id == service.service_id
            ]
            if not matched_targets:
                continue
            service.runtime_health = ServiceRuntimeHealthRecord(
                overallStatus="stale",
                healthyTargets=0,
                totalTargets=len(matched_targets),
                targets=[
                    {
                        "targetUrl": row.target_url,
                        "status": row.status,
                        "weight": row.weight,
                        "lastCheckedAt": row.last_checked_at,
                        "lastHealthyAt": row.last_healthy_at,
                    }
                    for row in matched_targets
                ],
            )


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


def _service_definition(
    service_id: str,
    owner_address: str,
    target_url: str,
    *,
    status: str = "active",
    is_active: bool = True,
    runtime_health: dict | None = None,
) -> ServiceDefinitionRecord:
    return ServiceDefinitionRecord(
        serviceId=service_id,
        ownerAddress=owner_address,
        serviceName=f"{service_id} name",
        summary="Public service for network stats.",
        status=status,
        isActive=is_active,
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
        serviceHealth=runtime_health,
    )


@contextmanager
def _http_runtime_client(storage: FakeStorage):
    gateway_app.app.dependency_overrides = {}
    gateway_app.create_storage = lambda settings: storage
    gateway_app.run_v2_deposit_indexer = _background_loop_until_stopped
    gateway_app.run_service_health_monitor = _background_loop_until_stopped
    gateway_app.run_provider_withdraw_expiry_reaper = _background_loop_until_stopped
    gateway_app.settings.service_health_monitor_enabled = False
    gateway_app.settings.provider_withdraw_expiry_reaper_enabled = False
    with TestClient(gateway_app.create_app(), base_url="https://gateway.test") as client:
        yield client


def test_public_network_stats_returns_layered_public_aggregate_counts(monkeypatch) -> None:
    monkeypatch.setattr(service_health_utils, "_now_ms", lambda: 500_000)
    services = [
        _service_definition(
            "svc.alpha",
            "0xprovider-a",
            "https://a.test/invoke",
            runtime_health={
                "overallStatus": "healthy",
                "healthyTargets": 1,
                "totalTargets": 1,
                "lastCheckedAt": 450_000,
                "targets": [
                    {
                        "targetUrl": "https://a.test/invoke",
                        "status": "healthy",
                        "weight": 100,
                        "lastCheckedAt": 450_000,
                    }
                ],
            },
        ),
        _service_definition(
            "svc.beta",
            "0xprovider-b",
            "https://b.test/invoke",
            runtime_health={
                "overallStatus": "healthy",
                "healthyTargets": 1,
                "totalTargets": 1,
                "lastCheckedAt": 100_000,
                "targets": [
                    {
                        "targetUrl": "https://b.test/invoke",
                        "status": "healthy",
                        "weight": 100,
                        "lastCheckedAt": 100_000,
                    }
                ],
            },
        ),
        _service_definition(
            "svc.gamma",
            "0xprovider-c",
            "https://c.test/invoke",
            status="draft",
            is_active=False,
        ),
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
    assert payload["discoverableServices"] == 0
    assert payload["staleServices"] == 2
    assert payload["unavailableServices"] == 0
    assert payload["runtimeReadyServices"] == 0
    assert payload["totalCalls"] == 2
    assert payload["connectedAgents"] == 2
    assert payload["statusBreakdown"] == {
        "accepted": 1,
        "succeeded": 2,
        "failed": 1,
    }
