from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import cast

import pytest

from src.domain.service_contract import (
    ServiceDefinitionRecord,
    ServiceHealthTargetRecord,
    ServiceRuntimeHealthRecord,
)
from src.services.platform import service_health_probe, service_health_service
from src.storage.base import BaseStorage
from tests.unit.registry_test_helper import service_definition

pytestmark = pytest.mark.performance


class InMemoryRegistryRepo:
    def __init__(self, services: list[ServiceDefinitionRecord]):
        self._services = list(services)
        self.persisted_health_rows = []

    def read_service_registry_rows(self):
        return list(self._services)

    def write_service_registry_rows(self, rows):
        raise AssertionError("health monitor must not rewrite service manifests")

    def read_service_target_health_rows(self):
        return []

    def write_service_target_health_rows(self, rows):
        self.persisted_health_rows = list(rows)


class FakeStorage:
    def __init__(self, services: list[ServiceDefinitionRecord]):
        self.registry = InMemoryRegistryRepo(services)
        self.data_manager = SimpleNamespace(
            system=SimpleNamespace(registry=self.registry)
        )

    def get_data_manager(self):
        return self.data_manager


def _healthy_runtime(service_id: str, checked_at_ms: int) -> ServiceRuntimeHealthRecord:
    target_url = f"https://{service_id}.test/invoke"
    return ServiceRuntimeHealthRecord(
        overallStatus="healthy",
        healthyTargets=1,
        totalTargets=1,
        lastCheckedAt=checked_at_ms,
        targets=[
            ServiceHealthTargetRecord(
                targetUrl=target_url,
                status="healthy",
                weight=100,
                lastCheckedAt=checked_at_ms,
                lastHealthyAt=checked_at_ms,
            )
        ],
    )


def _unhealthy_runtime(
    service_id: str,
    *,
    last_checked_at_ms: int,
    last_healthy_at_ms: int,
) -> ServiceRuntimeHealthRecord:
    target_url = f"https://{service_id}.test/invoke"
    return ServiceRuntimeHealthRecord(
        overallStatus="unhealthy",
        healthyTargets=0,
        totalTargets=1,
        lastCheckedAt=last_checked_at_ms,
        targets=[
            ServiceHealthTargetRecord(
                targetUrl=target_url,
                status="unhealthy",
                weight=100,
                lastCheckedAt=last_checked_at_ms,
                lastHealthyAt=last_healthy_at_ms,
                consecutiveFailures=240,
            )
        ],
    )


@pytest.mark.asyncio
async def test_provider_health_probe_burst_respects_global_concurrency(
    monkeypatch,
) -> None:
    services = [
        service_definition(f"perf_due_service_{index}", status="active", is_active=True)
        for index in range(64)
    ]
    storage = FakeStorage(services)
    checked_at_ms = 1773982500000
    active = 0
    max_active = 0

    async def _bounded_probe(service, client=None):
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.001)
        active -= 1
        return service.model_copy(
            update={"runtime_health": _healthy_runtime(service.service_id, checked_at_ms)}
        )

    monkeypatch.setattr(service_health_probe, "probe_service_health", _bounded_probe)
    monkeypatch.setattr(service_health_probe, "_should_prune_history", lambda now_ms: False)
    monkeypatch.setattr(service_health_service.settings, "service_health_history_enabled", False)
    monkeypatch.setattr(service_health_service.settings, "service_health_jitter_enabled", False)
    monkeypatch.setattr(service_health_service.settings, "service_health_max_concurrency", 8)
    monkeypatch.setenv("SERVICE_HEALTH_MAX_CANDIDATES_PER_TICK", "0")

    result = await service_health_service.refresh_all_service_health(
        cast(BaseStorage, storage)
    )

    assert result["scheduled"] == 64
    assert result["checked"] == 64
    assert result["maxConcurrency"] == 8
    assert max_active <= 8
    assert len(storage.registry.persisted_health_rows) == 64


@pytest.mark.asyncio
async def test_long_unhealthy_services_enter_slow_lane_before_probe_queue(
    monkeypatch,
) -> None:
    last_checked_at_ms = 1773982500000
    now_ms = last_checked_at_ms + 120_000
    services = [
        service_definition(
            f"perf_slow_lane_{index}",
            status="active",
            is_active=True,
            runtime_health=_unhealthy_runtime(
                f"perf_slow_lane_{index}",
                last_checked_at_ms=last_checked_at_ms,
                last_healthy_at_ms=last_checked_at_ms - 3_600_000,
            ),
        )
        for index in range(50)
    ]
    storage = FakeStorage(services)
    probed: list[str] = []

    async def _unexpected_probe(service, client=None):
        probed.append(service.service_id)
        return service

    monkeypatch.setattr(service_health_probe, "probe_service_health", _unexpected_probe)
    monkeypatch.setattr(service_health_probe, "_now_ms", lambda: now_ms)
    monkeypatch.setattr(service_health_probe, "_should_prune_history", lambda now_ms: False)
    monkeypatch.setattr(service_health_service.settings, "service_health_history_enabled", False)
    monkeypatch.setattr(service_health_service.settings, "service_health_jitter_enabled", False)
    monkeypatch.setattr(service_health_service.settings, "service_health_slow_lane_after_sec", 1800)
    monkeypatch.setattr(service_health_service.settings, "service_health_slow_lane_interval_sec", 300)

    result = await service_health_service.refresh_all_service_health(
        cast(BaseStorage, storage)
    )

    assert result["scheduled"] == 0
    assert result["checked"] == 0
    assert result["slowLaneSkipped"] == 50
    assert probed == []
    assert len(storage.registry.persisted_health_rows) == 50
