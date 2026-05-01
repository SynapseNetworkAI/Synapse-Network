from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import cast

import pytest

from src.core.scheduling import compute_stable_offset_ms, is_due_with_stable_jitter
from src.domain.registry import ServiceTargetHealthHistory
from src.domain.service_contract import (
    ServiceHealthTargetRecord,
    ServiceRuntimeHealthRecord,
)
from src.services.platform import (
    service_health_service,
    service_health_probe,
    service_health_refresh_plan,
    service_health_tiers,
)
from src.storage.base import BaseStorage
from tests.unit.registry_test_helper import service_definition


class InMemoryRegistryRepo:
    def __init__(self, services, persisted_health_rows=None):
        self._services = list(services)
        self.persisted_health_rows = list(persisted_health_rows or [])
        self.offline_mark_attempts: list[dict[str, object]] = []
        self.health_history_rows: list[ServiceTargetHealthHistory] = []
        self.health_history_write_count = 0

    def read_service_registry_rows(self):
        return list(self._services)

    def write_service_registry_rows(self, rows):
        raise AssertionError("health refresh must not rewrite service manifests")

    def read_service_target_health_rows(self):
        return list(self.persisted_health_rows)

    def write_service_target_health_rows(self, rows):
        self.persisted_health_rows = list(rows)

    def read_service_target_health_history_rows(self):
        return list(self.health_history_rows)

    def write_service_target_health_history_rows(self, rows):
        self.health_history_write_count += 1
        self.health_history_rows = list(rows)

    def mark_service_offline_if_still_failed(
        self,
        service_id,
        *,
        probe_started_at_ms,
        failure_threshold,
        last_healthy_cutoff_ms,
        probe_interval_ms,
        reason,
    ):
        self.offline_mark_attempts.append(
            {
                "serviceId": service_id,
                "probeStartedAtMs": probe_started_at_ms,
                "failureThreshold": failure_threshold,
                "lastHealthyCutoffMs": last_healthy_cutoff_ms,
                "probeIntervalMs": probe_interval_ms,
                "reason": reason,
            }
        )
        for index, service in enumerate(self._services):
            if service.service_id != service_id:
                continue
            if str(service.status or "").lower() != "active":
                return False
            self._services[index] = service.model_copy(
                update={"status": "offline", "is_active": False}
            )
            return True
        return False


class FakeStorage:
    def __init__(self, services, persisted_health_rows=None):
        self.registry = InMemoryRegistryRepo(services, persisted_health_rows)
        self.data_manager = SimpleNamespace(
            system=SimpleNamespace(
                registry=self.registry,
            )
        )

    def get_data_manager(self):
        return self.data_manager


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
    monkeypatch.setattr(
        service_health_refresh_plan, "_now_ms", lambda: last_checked_at + 120_000
    )
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
    now_ms = last_checked_at + 301_000
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
                            lastHealthyAt=now_ms - 1_800_000,
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
                    lastCheckedAt=now_ms,
                    targets=[
                        ServiceHealthTargetRecord(
                            targetUrl="https://slow_lane_due.test/invoke",
                            status="healthy",
                            weight=100,
                            lastCheckedAt=now_ms,
                            lastHealthyAt=now_ms,
                            consecutiveSuccesses=2,
                        )
                    ],
                )
            }
        )

    monkeypatch.setattr(service_health_probe, "probe_service_health", _healthy_probe)
    monkeypatch.setattr(service_health_probe, "_now_ms", lambda: now_ms)
    monkeypatch.setattr(
        service_health_refresh_plan, "_now_ms", lambda: now_ms
    )
    monkeypatch.setattr(service_health_tiers, "_now_ms", lambda: now_ms)
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
    monkeypatch.setattr(
        service_health_refresh_plan, "_now_ms", lambda: last_checked_at + 120_000
    )
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
    monkeypatch.setattr(service_health_refresh_plan, "_now_ms", lambda: now_ms)
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
async def test_refresh_all_service_health_marks_long_failed_service_offline(
    monkeypatch,
) -> None:
    now_ms = 1773982500000
    last_healthy_at = now_ms - 3_700_000
    storage = FakeStorage(
        [
            service_definition(
                "dead_provider",
                runtime_health=ServiceRuntimeHealthRecord(
                    overallStatus="unhealthy",
                    healthyTargets=0,
                    totalTargets=1,
                    lastCheckedAt=now_ms - 120_000,
                    targets=[
                        ServiceHealthTargetRecord(
                            targetUrl="https://dead_provider.test/invoke",
                            status="unhealthy",
                            lastCheckedAt=now_ms - 120_000,
                            lastHealthyAt=last_healthy_at,
                            consecutiveFailures=4,
                        )
                    ],
                ),
            )
        ]
    )

    async def _failed_probe(service, client=None):
        return service.model_copy(
            update={
                "runtime_health": ServiceRuntimeHealthRecord(
                    overallStatus="unhealthy",
                    healthyTargets=0,
                    totalTargets=1,
                    lastCheckedAt=now_ms,
                    targets=[
                        ServiceHealthTargetRecord(
                            targetUrl="https://dead_provider.test/invoke",
                            status="unhealthy",
                            lastCheckedAt=now_ms,
                            lastHealthyAt=last_healthy_at,
                            consecutiveFailures=5,
                            error="timeout",
                        )
                    ],
                )
            }
        )

    monkeypatch.setattr(service_health_probe, "probe_service_health", _failed_probe)
    monkeypatch.setattr(service_health_probe, "_now_ms", lambda: now_ms)
    monkeypatch.setattr(service_health_refresh_plan, "_now_ms", lambda: now_ms)
    monkeypatch.setattr(service_health_probe, "_should_prune_history", lambda now_ms: False)
    monkeypatch.setattr(service_health_service.settings, "service_health_history_enabled", False)
    monkeypatch.setattr(service_health_service.settings, "service_health_jitter_enabled", False)
    monkeypatch.setattr(
        service_health_service.settings,
        "service_health_slow_lane_after_sec",
        7200,
    )
    monkeypatch.setattr(service_health_service.settings, "service_health_offline_failures", 5)
    monkeypatch.setattr(service_health_service.settings, "service_health_offline_after_sec", 3600)

    result = await service_health_service.refresh_all_service_health(
        cast(BaseStorage, storage)
    )

    assert result["checked"] == 1
    assert storage.registry.read_service_registry_rows()[0].status == "offline"
    assert storage.registry.offline_mark_attempts[0]["serviceId"] == "dead_provider"


@pytest.mark.asyncio
async def test_refresh_all_service_health_does_not_probe_offline_service(
    monkeypatch,
) -> None:
    now_ms = 1773982500000
    storage = FakeStorage([service_definition("offline_provider", status="offline")])
    probed: list[str] = []

    async def _probe(service, client=None):
        probed.append(str(service.service_id))
        return service

    monkeypatch.setattr(service_health_probe, "probe_service_health", _probe)
    monkeypatch.setattr(service_health_probe, "_now_ms", lambda: now_ms)
    monkeypatch.setattr(service_health_refresh_plan, "_now_ms", lambda: now_ms)
    monkeypatch.setattr(service_health_probe, "_should_prune_history", lambda now_ms: False)
    monkeypatch.setattr(service_health_service.settings, "service_health_history_enabled", False)

    result = await service_health_service.refresh_all_service_health(
        cast(BaseStorage, storage)
    )

    assert result["scheduled"] == 0
    assert service_health_service.service_probe_tier(
        storage.registry.read_service_registry_rows()[0],
        now_ms=now_ms,
    ) == "offline"
    assert probed == []


@pytest.mark.asyncio
async def test_refresh_all_service_health_spreads_startup_rehydrate_window(
    monkeypatch,
) -> None:
    now_ms = 1773982500000
    storage = FakeStorage([service_definition("rehydrate_service")])
    probed: list[str] = []

    async def _probe(service, client=None):
        probed.append(str(service.service_id))
        return service

    monkeypatch.setattr(service_health_probe, "probe_service_health", _probe)
    monkeypatch.setattr(service_health_probe, "_now_ms", lambda: now_ms)
    monkeypatch.setattr(service_health_refresh_plan, "_now_ms", lambda: now_ms)
    monkeypatch.setattr(
        service_health_refresh_plan,
        "compute_stable_offset_ms",
        lambda key, window_ms: 10_000,
    )
    monkeypatch.setattr(service_health_probe, "_should_prune_history", lambda now_ms: False)
    monkeypatch.setattr(service_health_service.settings, "service_health_history_enabled", False)
    monkeypatch.setattr(service_health_service.settings, "service_health_jitter_enabled", False)
    monkeypatch.setattr(service_health_service.settings, "service_health_rehydrate_window_sec", 120)

    result = await service_health_service.refresh_all_service_health(
        cast(BaseStorage, storage),
        startup_started_at_ms=now_ms,
    )

    assert result["scheduled"] == 0
    assert result["rehydrateSkipped"] == 1
    assert probed == []

    result = await service_health_service.refresh_all_service_health(
        cast(BaseStorage, storage),
        startup_started_at_ms=now_ms - 10_000,
    )

    assert result["scheduled"] == 1
    assert result["rehydrateSkipped"] == 0
    assert probed == ["rehydrate_service"]


@pytest.mark.asyncio
async def test_refresh_all_service_health_prioritizes_recent_missing_health_under_local_limit(
    monkeypatch,
) -> None:
    now_ms = 1773982500000
    old_health = ServiceRuntimeHealthRecord(
        overallStatus="unhealthy",
        healthyTargets=0,
        totalTargets=1,
        lastCheckedAt=now_ms - 120_000,
        targets=[
            ServiceHealthTargetRecord(
                targetUrl="https://old_dead_service.test/invoke",
                status="unhealthy",
                weight=100,
                lastCheckedAt=now_ms - 120_000,
                consecutiveFailures=1,
            )
        ],
    )
    storage = FakeStorage(
        [
            service_definition(
                "old_dead_service",
                updated_at="2026-01-01T00:00:00Z",
                runtime_health=old_health,
            ),
            service_definition(
                "fresh_provider_service",
                updated_at="2026-04-26T00:00:00Z",
            ),
        ]
    )
    probed: list[str] = []

    async def _probe(service, client=None):
        probed.append(str(service.service_id))
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

    monkeypatch.setenv("SERVICE_HEALTH_MAX_CANDIDATES_PER_TICK", "1")
    monkeypatch.setattr(service_health_probe, "probe_service_health", _probe)
    monkeypatch.setattr(service_health_probe, "_now_ms", lambda: now_ms)
    monkeypatch.setattr(service_health_refresh_plan, "_now_ms", lambda: now_ms)
    monkeypatch.setattr(service_health_probe, "_should_prune_history", lambda now_ms: False)
    monkeypatch.setattr(service_health_service.settings, "service_health_history_enabled", False)
    monkeypatch.setattr(service_health_service.settings, "service_health_jitter_enabled", False)

    result = await service_health_service.refresh_all_service_health(
        cast(BaseStorage, storage)
    )

    assert result["scheduledBeforeLimit"] == 2
    assert result["scheduled"] == 1
    assert result["maxCandidatesPerTick"] == 1
    assert probed == ["fresh_provider_service"]


@pytest.mark.asyncio
async def test_refresh_all_service_health_prioritizes_recent_provider_over_old_missing_health(
    monkeypatch,
) -> None:
    now_ms = 1773982500000
    recent_stale_health = ServiceRuntimeHealthRecord(
        overallStatus="stale",
        healthyTargets=0,
        totalTargets=1,
        lastCheckedAt=now_ms - 120_000,
        targets=[
            ServiceHealthTargetRecord(
                targetUrl="https://recent_provider.test/invoke",
                status="stale",
                weight=100,
                lastCheckedAt=now_ms - 120_000,
            )
        ],
    )
    storage = FakeStorage(
        [
            service_definition(
                "old_missing_health",
                updated_at="2026-01-01T00:00:00Z",
            ),
            service_definition(
                "recent_provider",
                updated_at="2026-04-26T00:00:00Z",
                runtime_health=recent_stale_health,
            ),
        ]
    )
    probed: list[str] = []

    async def _probe(service, client=None):
        probed.append(str(service.service_id))
        return service

    monkeypatch.setenv("SERVICE_HEALTH_MAX_CANDIDATES_PER_TICK", "1")
    monkeypatch.setattr(service_health_probe, "probe_service_health", _probe)
    monkeypatch.setattr(service_health_probe, "_now_ms", lambda: now_ms)
    monkeypatch.setattr(service_health_refresh_plan, "_now_ms", lambda: now_ms)
    monkeypatch.setattr(service_health_probe, "_should_prune_history", lambda now_ms: False)
    monkeypatch.setattr(service_health_service.settings, "service_health_history_enabled", False)
    monkeypatch.setattr(service_health_service.settings, "service_health_jitter_enabled", False)

    result = await service_health_service.refresh_all_service_health(
        cast(BaseStorage, storage)
    )

    assert result["scheduledBeforeLimit"] == 2
    assert result["scheduled"] == 1
    assert probed == ["recent_provider"]


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
