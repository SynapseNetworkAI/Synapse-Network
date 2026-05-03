from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import cast

import pytest

from src.domain.registry import ServiceTargetHealth, ServiceTargetHealthHistory
from src.domain.service_contract import (
    ServiceHealthTargetRecord,
    ServiceRuntimeHealthRecord,
)
from src.services.platform import (
    service_health_service,
    service_health_probe,
    service_health_tiers,
    service_health_utils,
)
from src.storage.base import BaseStorage
from tests.unit.registry_test_helper import service_definition


class InMemoryRegistryRepo:
    def __init__(self, services, persisted_health_rows=None):
        self._services = list(services)
        self.persisted_health_rows = list(persisted_health_rows or [])
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


def test_startup_keeps_fresh_persisted_health_discoverable(monkeypatch) -> None:
    now_ms = 1773982500000
    checked_at = now_ms - 3_000
    monkeypatch.setattr(service_health_utils, "_now_ms", lambda: now_ms)
    service = service_definition(
        "startup_fresh_service",
    )
    storage = FakeStorage(
        [service],
        persisted_health_rows=[
            ServiceTargetHealth(
                serviceId="startup_fresh_service",
                ownerAddress="0xprovider",
                targetUrl="https://startup_fresh_service.test/invoke",
                status="healthy",
                overallStatus="healthy",
                consecutiveSuccesses=2,
                lastCheckedAt=checked_at,
                lastHealthyAt=checked_at,
            )
        ],
    )

    seeded = service_health_service.seed_service_health_from_persisted_rows(
        cast(BaseStorage, storage),
        [service],
    )[0]

    assert service_health_service.effective_runtime_status(
        seeded,
        now_ms=now_ms,
    ) == "healthy"
    assert service_health_service.is_service_discoverable(seeded)


def test_seeded_startup_stale_snapshot_is_not_discoverable() -> None:
    service = service_definition("startup_stale_service")
    storage = FakeStorage(
        [service],
        persisted_health_rows=[
            ServiceTargetHealth(
                serviceId="startup_stale_service",
                ownerAddress="0xprovider",
                targetUrl="https://startup_stale_service.test/invoke",
                status="unknown",
                overallStatus="stale",
            )
        ],
    )

    seeded = service_health_service.seed_service_health_from_persisted_rows(
        cast(BaseStorage, storage),
        [service],
    )[0]

    assert service_health_service.effective_runtime_status(seeded) == "stale"
    assert not service_health_service.is_service_discoverable(seeded)


def test_offline_service_does_not_build_probe_health_row() -> None:
    service = service_definition("offline_probe_row", status="offline")
    target = service.invoke.targets[0]

    assert service_health_utils._service_health_row(service, target, {}) is None


def test_offline_service_does_not_build_startup_stale_row() -> None:
    service = service_definition("offline_startup_row", status="offline")
    target = service.invoke.targets[0]

    assert service_health_utils._startup_stale_health_row(service, target) is None


def test_startup_does_not_trust_expired_healthy_snapshot(monkeypatch) -> None:
    now_ms = 1773982500000
    monkeypatch.setattr(service_health_utils, "_now_ms", lambda: now_ms)
    monkeypatch.setattr(
        service_health_service.settings,
        "service_health_restart_trust_window_sec",
        90,
    )
    service = service_definition("startup_expired_healthy")
    storage = FakeStorage(
        [service],
        persisted_health_rows=[
            ServiceTargetHealth(
                serviceId="startup_expired_healthy",
                ownerAddress="0xprovider",
                targetUrl="https://startup_expired_healthy.test/invoke",
                status="healthy",
                overallStatus="healthy",
                consecutiveSuccesses=10,
                lastCheckedAt=now_ms - 120_000,
                lastHealthyAt=now_ms - 120_000,
            )
        ],
    )

    seeded = service_health_service.seed_service_health_from_persisted_rows(
        cast(BaseStorage, storage),
        [service],
    )[0]

    assert service_health_service.effective_runtime_status(
        seeded,
        now_ms=now_ms,
    ) == "stale"
    assert not service_health_service.is_service_discoverable(seeded)


def test_offline_quarantine_waits_one_hour_for_never_healthy_service(monkeypatch) -> None:
    now_ms = 1773982500000
    monkeypatch.setattr(
        service_health_service.settings,
        "service_health_offline_failures",
        5,
    )
    monkeypatch.setattr(
        service_health_service.settings,
        "service_health_offline_after_sec",
        3600,
    )
    monkeypatch.setattr(
        service_health_service.settings,
        "service_health_probe_interval_sec",
        60,
    )
    service = service_definition(
        "never_healthy_recent_failure",
        runtime_health=ServiceRuntimeHealthRecord(
            overallStatus="unhealthy",
            healthyTargets=0,
            totalTargets=1,
            lastCheckedAt=now_ms,
            targets=[
                ServiceHealthTargetRecord(
                    targetUrl="https://never-healthy.test/invoke",
                    status="unhealthy",
                    lastCheckedAt=now_ms,
                    lastHealthyAt=0,
                    consecutiveFailures=5,
                )
            ],
        ),
    )

    assert not service_health_service.should_quarantine_offline(
        service,
        now_ms=now_ms,
    )


def test_slow_lane_probe_interval_uses_exponential_backoff(monkeypatch) -> None:
    now_ms = 1773982500000
    target_url = "https://slow-lane.test/invoke"
    service = service_definition(
        "slow_lane_backoff",
        runtime_health=ServiceRuntimeHealthRecord(
            overallStatus="unhealthy",
            healthyTargets=0,
            totalTargets=1,
            lastCheckedAt=now_ms - 600_000,
            targets=[
                ServiceHealthTargetRecord(
                    targetUrl=target_url,
                    status="unhealthy",
                    lastCheckedAt=now_ms - 600_000,
                    lastHealthyAt=now_ms - 3_600_000,
                    consecutiveFailures=100,
                )
            ],
        ),
    )

    monkeypatch.setattr(service_health_tiers, "_now_ms", lambda: now_ms)
    monkeypatch.setattr(service_health_service.settings, "service_health_slow_lane_after_sec", 1800)
    monkeypatch.setattr(service_health_service.settings, "service_health_slow_lane_interval_sec", 300)
    monkeypatch.setattr(service_health_service.settings, "service_health_max_backoff_sec", 86_400)

    assert service_health_service.service_probe_tier(service, now_ms=now_ms) == "slow_lane"
    assert service_health_service.service_probe_interval_ms(service, "slow_lane") == 19_200_000


def test_slow_lane_probe_interval_caps_at_max_backoff(monkeypatch) -> None:
    now_ms = 1773982500000
    target_url = "https://slow-lane-cap.test/invoke"
    service = service_definition(
        "slow_lane_backoff_cap",
        runtime_health=ServiceRuntimeHealthRecord(
            overallStatus="unhealthy",
            healthyTargets=0,
            totalTargets=1,
            lastCheckedAt=now_ms - 86_400_000,
            targets=[
                ServiceHealthTargetRecord(
                    targetUrl=target_url,
                    status="unhealthy",
                    lastCheckedAt=now_ms - 86_400_000,
                    lastHealthyAt=now_ms - 172_800_000,
                    consecutiveFailures=1000,
                )
            ],
        ),
    )

    monkeypatch.setattr(service_health_tiers, "_now_ms", lambda: now_ms)
    monkeypatch.setattr(service_health_service.settings, "service_health_slow_lane_after_sec", 1800)
    monkeypatch.setattr(service_health_service.settings, "service_health_slow_lane_interval_sec", 300)
    monkeypatch.setattr(service_health_service.settings, "service_health_max_backoff_sec", 86_400)

    assert service_health_service.service_probe_interval_ms(service, "slow_lane") == 86_400_000


def test_probe_target_status_is_fail_closed_without_threshold_grace() -> None:
    target = SimpleNamespace(url="https://provider.test/invoke", weight=100, region=None)
    previous = ServiceHealthTargetRecord(
        targetUrl="https://provider.test/invoke",
        status="healthy",
        consecutiveSuccesses=10,
        consecutiveFailures=0,
        lastHealthyAt=1773982497000,
    )

    failed = service_health_probe._merge_target_health(
        previous,
        target,
        {"healthy": False, "httpStatus": 500, "latencyMs": 12, "error": None},
        1773982500000,
        2,
        3,
        "https://provider.test/health",
    )
    recovered = service_health_probe._merge_target_health(
        failed,
        target,
        {"healthy": True, "httpStatus": 200, "latencyMs": 8, "error": None},
        1773982510000,
        2,
        3,
        "https://provider.test/health",
    )

    assert failed.status == "unhealthy"
    assert failed.consecutive_failures == 1
    assert recovered.status == "healthy"
    assert recovered.consecutive_successes == 1


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
async def test_refresh_all_service_health_appends_history_once_per_tick(
    monkeypatch,
) -> None:
    storage = FakeStorage(
        [
            service_definition(
                "history_a",
                service_name="History A",
                target_url="http://127.0.0.1:8100/history-a/invoke",
            ),
            service_definition(
                "history_b",
                service_name="History B",
                target_url="http://127.0.0.1:8100/history-b/invoke",
            ),
        ]
    )

    async def _healthy_probe(service, client=None):
        await asyncio.sleep(0)
        target_url = service.invoke.targets[0].url
        return service.model_copy(
            update={
                "runtime_health": ServiceRuntimeHealthRecord(
                    overallStatus="healthy",
                    healthyTargets=1,
                    totalTargets=1,
                    lastCheckedAt=1773982497000,
                    targets=[
                        ServiceHealthTargetRecord(
                            targetUrl=target_url,
                            status="healthy",
                            weight=100,
                            lastCheckedAt=1773982497000,
                            lastHealthyAt=1773982497000,
                        )
                    ],
                )
            }
        )

    monkeypatch.setattr(service_health_probe, "probe_service_health", _healthy_probe)
    monkeypatch.setattr(service_health_probe, "_should_prune_history", lambda now_ms: False)
    monkeypatch.setattr(service_health_service.settings, "service_health_history_enabled", True)
    monkeypatch.setattr(service_health_service.settings, "service_health_jitter_enabled", False)

    result = await service_health_service.refresh_all_service_health(
        cast(BaseStorage, storage)
    )

    assert result["checked"] == 2
    assert result["historyAppended"] == 2
    assert storage.registry.health_history_write_count == 1
    assert [row.service_id for row in storage.registry.health_history_rows] == [
        "history_a",
        "history_b",
    ]


@pytest.mark.asyncio
async def test_refresh_all_service_health_skips_repeated_same_status_history(
    monkeypatch,
) -> None:
    now_ms = 1773982500000
    target_url = "http://127.0.0.1:8100/history-stable/invoke"
    service = service_definition(
        "history_stable_unhealthy",
        target_url=target_url,
        runtime_health=ServiceRuntimeHealthRecord(
            overallStatus="unhealthy",
            healthyTargets=0,
            totalTargets=1,
            lastCheckedAt=now_ms - 120_000,
            targets=[
                ServiceHealthTargetRecord(
                    targetUrl=target_url,
                    status="unhealthy",
                    weight=100,
                    lastCheckedAt=now_ms - 120_000,
                    consecutiveFailures=4,
                )
            ],
        ),
    )
    storage = FakeStorage([service])

    async def _unhealthy_probe(row, client=None):
        await asyncio.sleep(0)
        return row.model_copy(
            update={
                "runtime_health": ServiceRuntimeHealthRecord(
                    overallStatus="unhealthy",
                    healthyTargets=0,
                    totalTargets=1,
                    lastCheckedAt=now_ms,
                    targets=[
                        ServiceHealthTargetRecord(
                            targetUrl=target_url,
                            status="unhealthy",
                            weight=100,
                            lastCheckedAt=now_ms,
                            consecutiveFailures=5,
                        )
                    ],
                )
            }
        )

    monkeypatch.setattr(service_health_probe, "probe_service_health", _unhealthy_probe)
    monkeypatch.setattr(service_health_probe, "_should_prune_history", lambda now_ms: False)
    monkeypatch.setattr(service_health_service.settings, "service_health_history_enabled", True)
    monkeypatch.setattr(service_health_service.settings, "service_health_jitter_enabled", False)

    result = await service_health_service.refresh_all_service_health(
        cast(BaseStorage, storage)
    )

    assert result["checked"] == 1
    assert result["historyAppended"] == 0
    assert storage.registry.health_history_write_count == 0
    assert storage.registry.persisted_health_rows[0].status == "unhealthy"


@pytest.mark.asyncio
async def test_refresh_all_service_health_records_recovery_transition(
    monkeypatch,
) -> None:
    now_ms = 1773982500000
    target_url = "http://127.0.0.1:8100/history-recovery/invoke"
    service = service_definition(
        "history_recovery",
        target_url=target_url,
        runtime_health=ServiceRuntimeHealthRecord(
            overallStatus="unhealthy",
            healthyTargets=0,
            totalTargets=1,
            lastCheckedAt=now_ms - 120_000,
            targets=[
                ServiceHealthTargetRecord(
                    targetUrl=target_url,
                    status="unhealthy",
                    weight=100,
                    lastCheckedAt=now_ms - 120_000,
                    consecutiveFailures=4,
                )
            ],
        ),
    )
    storage = FakeStorage([service])

    async def _healthy_probe(row, client=None):
        await asyncio.sleep(0)
        return row.model_copy(
            update={
                "runtime_health": ServiceRuntimeHealthRecord(
                    overallStatus="healthy",
                    healthyTargets=1,
                    totalTargets=1,
                    lastCheckedAt=now_ms,
                    targets=[
                        ServiceHealthTargetRecord(
                            targetUrl=target_url,
                            status="healthy",
                            weight=100,
                            lastCheckedAt=now_ms,
                            lastHealthyAt=now_ms,
                            consecutiveSuccesses=1,
                        )
                    ],
                )
            }
        )

    monkeypatch.setattr(service_health_probe, "probe_service_health", _healthy_probe)
    monkeypatch.setattr(service_health_probe, "_should_prune_history", lambda now_ms: False)
    monkeypatch.setattr(service_health_service.settings, "service_health_history_enabled", True)
    monkeypatch.setattr(service_health_service.settings, "service_health_jitter_enabled", False)

    result = await service_health_service.refresh_all_service_health(
        cast(BaseStorage, storage)
    )

    assert result["checked"] == 1
    assert result["historyAppended"] == 1
    assert storage.registry.health_history_write_count == 1
    assert storage.registry.health_history_rows[0].status == "healthy"


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
async def test_refresh_all_service_health_skips_non_active_but_probes_suspended(
    monkeypatch,
) -> None:
    storage = FakeStorage(
        [
            service_definition("inactive_service", status="inactive", is_active=False),
            service_definition("paused_service", status="paused", is_active=False),
            service_definition("archived_service", status="archived", is_active=False),
            service_definition("offline_service", status="offline", is_active=False),
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
        row.service_id
        not in {
            "archived_service",
            "deleted_service",
            "offline_service",
            "paused_service",
        }
        for row in storage.registry.persisted_health_rows
    )
    suspended_row = next(
        row
        for row in storage.registry.persisted_health_rows
        if row.service_id == "suspended_service"
    )
    assert suspended_row.status == "healthy"
