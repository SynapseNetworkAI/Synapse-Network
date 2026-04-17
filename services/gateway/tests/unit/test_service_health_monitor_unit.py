from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import cast

import pytest

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
