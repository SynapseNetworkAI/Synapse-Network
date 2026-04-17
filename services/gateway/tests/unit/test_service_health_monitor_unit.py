from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import cast

import pytest

from src.core.scheduling import compute_stable_offset_ms, is_due_with_stable_jitter
from src.domain.service_contract import (
    ServiceHealthTargetRecord,
    ServiceRuntimeHealthRecord,
)
from src.services.platform import service_health_service, service_health_probe
from src.storage.base import BaseStorage
from tests.unit.registry_test_helper import service_definition


class InMemoryRegistryRepo:
    def __init__(self, services):
        self._services = list(services)
        self.persisted_health_rows = []

    def read_service_registry_rows(self):
        return list(self._services)

    def write_service_registry_rows(self, rows):
        raise AssertionError("health refresh must not rewrite service manifests")

    def read_service_target_health_rows(self):
        return []

    def write_service_target_health_rows(self, rows):
        self.persisted_health_rows = list(rows)


class FakeStorage:
    def __init__(self, services):
        self.registry = InMemoryRegistryRepo(services)
        self.data_manager = SimpleNamespace(
            system=SimpleNamespace(
                registry=self.registry,
            )
        )

    def get_data_manager(self):
        return self.data_manager


@pytest.mark.asyncio
async def test_refresh_all_service_health_updates_snapshots_without_rewriting_manifests(
    monkeypatch,
) -> None:
    storage = FakeStorage(
        [
            service_definition(
                "famous_quotes_top3",
                service_name="Famous Quotes Top 3",
                target_url="http://127.0.0.1:8100/api/v1/quotes/famous/top3",
            )
        ]
    )

    async def _healthy_probe(service, client=None):
        await asyncio.sleep(0)
        return service.model_copy(
            update={
                "runtime_health": ServiceRuntimeHealthRecord(
                    overallStatus="healthy",
                    healthyTargets=1,
                    totalTargets=1,
                    lastCheckedAt=1773982497000,
                    targets=[
                        ServiceHealthTargetRecord(
                            targetUrl="http://127.0.0.1:8100/api/v1/quotes/famous/top3",
                            status="healthy",
                            weight=100,
                            lastCheckedAt=1773982497000,
                        )
                    ],
                )
            }
        )

    monkeypatch.setattr(service_health_probe, "probe_service_health", _healthy_probe)
    monkeypatch.setattr(service_health_probe, "_should_prune_history", lambda now_ms: False)
    monkeypatch.setattr(service_health_service.settings, "service_health_history_enabled", False)
    monkeypatch.setattr(service_health_service.settings, "service_health_jitter_enabled", False)

    result = await service_health_service.refresh_all_service_health(
        cast(BaseStorage, storage)
    )

    assert result["checked"] == 1
    assert result["updated"] == 1
    assert result["syncedRows"] == 1
    assert len(storage.registry.persisted_health_rows) == 1
    assert storage.registry.persisted_health_rows[0].service_id == "famous_quotes_top3"
    assert storage.registry.persisted_health_rows[0].status == "healthy"


@pytest.mark.asyncio
async def test_refresh_all_service_health_keeps_active_unhealthy_services_probeable(
    monkeypatch,
) -> None:
    storage = FakeStorage(
        [
            service_definition(
                "unhealthy_active",
                status="active",
                is_active=True,
                runtime_health=ServiceRuntimeHealthRecord(
                    overallStatus="unhealthy",
                    healthyTargets=0,
                    totalTargets=1,
                    lastCheckedAt=1773982497000,
                ),
            )
        ]
    )

    async def _still_unhealthy(service, client=None):
        await asyncio.sleep(0)
        return service.model_copy(
            update={
                "runtime_health": ServiceRuntimeHealthRecord(
                    overallStatus="unhealthy",
                    healthyTargets=0,
                    totalTargets=1,
                    lastCheckedAt=1773982500000,
                    targets=[
                        ServiceHealthTargetRecord(
                            targetUrl="https://unhealthy_active.test/invoke",
                            status="unhealthy",
                            weight=100,
                            lastCheckedAt=1773982500000,
                        )
                    ],
                )
            }
        )

    monkeypatch.setattr(service_health_probe, "probe_service_health", _still_unhealthy)
    monkeypatch.setattr(service_health_probe, "_should_prune_history", lambda now_ms: False)
    monkeypatch.setattr(service_health_service.settings, "service_health_history_enabled", False)
    monkeypatch.setattr(service_health_service.settings, "service_health_jitter_enabled", False)

    result = await service_health_service.refresh_all_service_health(
        cast(BaseStorage, storage)
    )

    assert result["checked"] == 1
    assert storage.registry.read_service_registry_rows()[0].status == "active"
    assert storage.registry.persisted_health_rows[0].status == "unhealthy"


@pytest.mark.asyncio
async def test_refresh_all_service_health_skips_inactive_but_probes_suspended(
    monkeypatch,
) -> None:
    storage = FakeStorage(
        [
            service_definition("inactive_service", status="inactive", is_active=False),
            service_definition("suspended_service", status="suspended", is_active=False),
            service_definition("deleted_service", status="deleted", is_active=False),
        ]
    )
    probed: list[str] = []

    async def _probe(service, client=None):
        await asyncio.sleep(0)
        probed.append(service.service_id)
        return service.model_copy(
            update={
                "runtime_health": ServiceRuntimeHealthRecord(
                    overallStatus="healthy",
                    healthyTargets=1,
                    totalTargets=1,
                    lastCheckedAt=1773982500000,
                    targets=[
                        ServiceHealthTargetRecord(
                            targetUrl=f"https://{service.service_id}.test/invoke",
                            status="healthy",
                            weight=100,
                            lastCheckedAt=1773982500000,
                        )
                    ],
                )
            }
        )

    monkeypatch.setattr(service_health_probe, "probe_service_health", _probe)
    monkeypatch.setattr(service_health_probe, "_should_prune_history", lambda now_ms: False)
    monkeypatch.setattr(service_health_service.settings, "service_health_history_enabled", False)
    monkeypatch.setattr(service_health_service.settings, "service_health_jitter_enabled", False)

    result = await service_health_service.refresh_all_service_health(
        cast(BaseStorage, storage)
    )

    assert result["checked"] == 1
    assert probed == ["suspended_service"]
    assert all(
        row.service_id != "deleted_service"
        for row in storage.registry.persisted_health_rows
    )
    suspended_row = next(
        row
        for row in storage.registry.persisted_health_rows
        if row.service_id == "suspended_service"
    )
    assert suspended_row.status == "healthy"


@pytest.mark.asyncio
async def test_refresh_all_service_health_slow_lane_skips_until_interval_is_due(
    monkeypatch,
) -> None:
    last_checked_at = 1773982500000
    storage = FakeStorage(
        [
            service_definition(
                "slow_lane_service",
                status="active",
                is_active=True,
                runtime_health=ServiceRuntimeHealthRecord(
                    overallStatus="unhealthy",
                    healthyTargets=0,
                    totalTargets=1,
                    lastCheckedAt=last_checked_at,
                    targets=[
                        ServiceHealthTargetRecord(
                            targetUrl="https://slow_lane_service.test/invoke",
                            status="unhealthy",
                            weight=100,
                            lastCheckedAt=last_checked_at,
                            consecutiveFailures=200,
                        )
                    ],
                ),
            )
        ]
    )
    probed: list[str] = []

    async def _probe(service, client=None):
        probed.append(service.service_id)
        return service

    monkeypatch.setattr(service_health_probe, "probe_service_health", _probe)
    monkeypatch.setattr(service_health_probe, "_now_ms", lambda: last_checked_at + 120_000)
    monkeypatch.setattr(service_health_probe, "_should_prune_history", lambda now_ms: False)
    monkeypatch.setattr(service_health_service.settings, "service_health_history_enabled", False)
    monkeypatch.setattr(service_health_service.settings, "service_health_probe_interval_sec", 15)
    monkeypatch.setattr(service_health_service.settings, "service_health_slow_lane_after_sec", 1800)
    monkeypatch.setattr(service_health_service.settings, "service_health_slow_lane_interval_sec", 300)
    monkeypatch.setattr(service_health_service.settings, "service_health_jitter_enabled", False)

    result = await service_health_service.refresh_all_service_health(
        cast(BaseStorage, storage)
    )

    assert result["checked"] == 0
    assert result["slowLaneSkipped"] == 1
    assert probed == []
    assert service_health_service.service_probe_tier(
        storage.registry.read_service_registry_rows()[0],
        now_ms=last_checked_at + 120_000,
    ) == "slow_lane"


@pytest.mark.asyncio
async def test_refresh_all_service_health_slow_lane_probes_after_interval_is_due(
    monkeypatch,
) -> None:
    last_checked_at = 1773982500000
    storage = FakeStorage(
        [
            service_definition(
                "slow_lane_due",
                status="active",
                is_active=True,
                runtime_health=ServiceRuntimeHealthRecord(
                    overallStatus="unhealthy",
                    healthyTargets=0,
                    totalTargets=1,
                    lastCheckedAt=last_checked_at,
                    targets=[
                        ServiceHealthTargetRecord(
                            targetUrl="https://slow_lane_due.test/invoke",
                            status="unhealthy",
                            weight=100,
                            lastCheckedAt=last_checked_at,
                            lastHealthyAt=last_checked_at - 3_600_000,
                            consecutiveFailures=200,
                        )
                    ],
                ),
            )
        ]
    )
    probed: list[str] = []

    async def _healthy_probe(service, client=None):
        probed.append(service.service_id)
        return service.model_copy(
            update={
                "runtime_health": ServiceRuntimeHealthRecord(
                    overallStatus="healthy",
                    healthyTargets=1,
                    totalTargets=1,
                    lastCheckedAt=last_checked_at + 301_000,
                    targets=[
                        ServiceHealthTargetRecord(
                            targetUrl="https://slow_lane_due.test/invoke",
                            status="healthy",
                            weight=100,
                            lastCheckedAt=last_checked_at + 301_000,
                            lastHealthyAt=last_checked_at + 301_000,
                            consecutiveSuccesses=2,
                        )
                    ],
                )
            }
        )

    monkeypatch.setattr(service_health_probe, "probe_service_health", _healthy_probe)
    monkeypatch.setattr(service_health_probe, "_now_ms", lambda: last_checked_at + 301_000)
    monkeypatch.setattr(service_health_probe, "_should_prune_history", lambda now_ms: False)
    monkeypatch.setattr(service_health_service.settings, "service_health_history_enabled", False)
    monkeypatch.setattr(service_health_service.settings, "service_health_slow_lane_after_sec", 1800)
    monkeypatch.setattr(service_health_service.settings, "service_health_slow_lane_interval_sec", 300)
    monkeypatch.setattr(service_health_service.settings, "service_health_jitter_enabled", False)

    result = await service_health_service.refresh_all_service_health(
        cast(BaseStorage, storage)
    )

    assert result["checked"] == 1
    assert result["slowLaneSkipped"] == 0
    assert probed == ["slow_lane_due"]
    assert storage.registry.persisted_health_rows[0].status == "healthy"


@pytest.mark.asyncio
async def test_refresh_all_service_health_suspended_uses_slow_lane_interval(
    monkeypatch,
) -> None:
    last_checked_at = 1773982500000
    storage = FakeStorage(
        [
            service_definition(
                "suspended_slow_lane",
                status="suspended",
                is_active=False,
                runtime_health=ServiceRuntimeHealthRecord(
                    overallStatus="unhealthy",
                    healthyTargets=0,
                    totalTargets=1,
                    lastCheckedAt=last_checked_at,
                    targets=[
                        ServiceHealthTargetRecord(
                            targetUrl="https://suspended_slow_lane.test/invoke",
                            status="unhealthy",
                            weight=100,
                            lastCheckedAt=last_checked_at,
                            consecutiveFailures=200,
                        )
                    ],
                ),
            )
        ]
    )
    probed: list[str] = []

    async def _probe(service, client=None):
        probed.append(service.service_id)
        return service

    monkeypatch.setattr(service_health_probe, "probe_service_health", _probe)
    monkeypatch.setattr(service_health_probe, "_now_ms", lambda: last_checked_at + 120_000)
    monkeypatch.setattr(service_health_probe, "_should_prune_history", lambda now_ms: False)
    monkeypatch.setattr(service_health_service.settings, "service_health_history_enabled", False)
    monkeypatch.setattr(service_health_service.settings, "service_health_jitter_enabled", False)
    monkeypatch.setattr(
        service_health_service.settings,
        "service_health_slow_lane_suspended_interval_sec",
        300,
    )

    result = await service_health_service.refresh_all_service_health(
        cast(BaseStorage, storage)
    )

    assert result["checked"] == 0
    assert result["slowLaneSkipped"] == 1
    assert probed == []
    assert not service_health_service.is_service_discoverable(
        storage.registry.read_service_registry_rows()[0]
    )


def test_stable_jitter_offset_is_deterministic_and_keyed() -> None:
    interval_ms = 15_000

    first = compute_stable_offset_ms("svc-a|normal|https://a.test", interval_ms)
    second = compute_stable_offset_ms("svc-a|normal|https://a.test", interval_ms)
    offsets = {
        compute_stable_offset_ms(f"svc-{index}|normal|https://{index}.test", interval_ms)
        for index in range(8)
    }

    assert first == second
    assert 0 <= first < interval_ms
    assert all(0 <= offset < interval_ms for offset in offsets)
    assert len(offsets) > 1


def test_stable_jitter_due_uses_bucket_offset() -> None:
    interval_ms = 10_000
    key = "svc-jitter|normal|https://jitter.test"
    offset = compute_stable_offset_ms(key, interval_ms)
    bucket_start = 1_000_000

    if offset > 0:
        assert not is_due_with_stable_jitter(
            now_ms=bucket_start + offset - 1,
            last_checked_at=bucket_start - 1,
            interval_ms=interval_ms,
            key=key,
        )
    assert is_due_with_stable_jitter(
        now_ms=bucket_start + offset,
        last_checked_at=bucket_start - 1,
        interval_ms=interval_ms,
        key=key,
    )


@pytest.mark.asyncio
async def test_refresh_all_service_health_respects_global_probe_concurrency(
    monkeypatch,
) -> None:
    services = [
        service_definition(f"due_service_{index}", status="active", is_active=True)
        for index in range(5)
    ]
    storage = FakeStorage(services)
    active = 0
    max_active = 0

    async def _slow_probe(service, client=None):
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.01)
        active -= 1
        return service.model_copy(
            update={
                "runtime_health": ServiceRuntimeHealthRecord(
                    overallStatus="healthy",
                    healthyTargets=1,
                    totalTargets=1,
                    lastCheckedAt=1773982500000,
                    targets=[
                        ServiceHealthTargetRecord(
                            targetUrl=f"https://{service.service_id}.test/invoke",
                            status="healthy",
                            weight=100,
                            lastCheckedAt=1773982500000,
                        )
                    ],
                )
            }
        )

    monkeypatch.setattr(service_health_probe, "probe_service_health", _slow_probe)
    monkeypatch.setattr(service_health_probe, "_should_prune_history", lambda now_ms: False)
    monkeypatch.setattr(service_health_service.settings, "service_health_history_enabled", False)
    monkeypatch.setattr(service_health_service.settings, "service_health_jitter_enabled", False)
    monkeypatch.setattr(service_health_service.settings, "service_health_max_concurrency", 2)

    result = await service_health_service.refresh_all_service_health(
        cast(BaseStorage, storage)
    )

    assert result["scheduled"] == 5
    assert result["checked"] == 5
    assert result["maxConcurrency"] == 2
    assert max_active <= 2
    assert len(storage.registry.persisted_health_rows) == 5


@pytest.mark.asyncio
async def test_refresh_all_service_health_skips_fresh_rows_before_probe_queue(
    monkeypatch,
) -> None:
    now_ms = 1773982500000
    storage = FakeStorage(
        [
            service_definition(
                "fresh_service",
                runtime_health=ServiceRuntimeHealthRecord(
                    overallStatus="healthy",
                    healthyTargets=1,
                    totalTargets=1,
                    lastCheckedAt=now_ms - 1_000,
                    targets=[
                        ServiceHealthTargetRecord(
                            targetUrl="https://fresh_service.test/invoke",
                            status="healthy",
                            weight=100,
                            lastCheckedAt=now_ms - 1_000,
                            lastHealthyAt=now_ms - 1_000,
                        )
                    ],
                ),
            ),
            service_definition("due_service"),
        ]
    )
    probed: list[str] = []

    async def _probe(service, client=None):
        probed.append(service.service_id)
        return service.model_copy(
            update={
                "runtime_health": ServiceRuntimeHealthRecord(
                    overallStatus="healthy",
                    healthyTargets=1,
                    totalTargets=1,
                    lastCheckedAt=now_ms,
                    targets=[
                        ServiceHealthTargetRecord(
                            targetUrl=f"https://{service.service_id}.test/invoke",
                            status="healthy",
                            weight=100,
                            lastCheckedAt=now_ms,
                            lastHealthyAt=now_ms,
                        )
                    ],
                )
            }
        )

    monkeypatch.setattr(service_health_probe, "probe_service_health", _probe)
    monkeypatch.setattr(service_health_probe, "_now_ms", lambda: now_ms)
    monkeypatch.setattr(service_health_probe, "_should_prune_history", lambda now_ms: False)
    monkeypatch.setattr(service_health_service.settings, "service_health_history_enabled", False)
    monkeypatch.setattr(service_health_service.settings, "service_health_jitter_enabled", False)
    monkeypatch.setattr(service_health_service.settings, "service_health_probe_interval_sec", 15)

    result = await service_health_service.refresh_all_service_health(
        cast(BaseStorage, storage)
    )

    assert result["scheduled"] == 1
    assert result["jitterSkipped"] == 1
    assert probed == ["due_service"]


@pytest.mark.asyncio
async def test_force_probe_uses_global_probe_concurrency(
    monkeypatch,
) -> None:
    active = 0
    max_active = 0
    services = [
        service_definition(f"force_service_{index}", status="active", is_active=True)
        for index in range(3)
    ]

    async def _slow_probe(service, client=None):
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.01)
        active -= 1
        return service

    monkeypatch.setattr(service_health_probe, "probe_service_health", _slow_probe)
    monkeypatch.setattr(service_health_service.settings, "service_health_max_concurrency", 1)

    await asyncio.gather(
        *[
            service_health_service.force_probe_service_health(service)
            for service in services
        ]
    )

    assert max_active == 1
