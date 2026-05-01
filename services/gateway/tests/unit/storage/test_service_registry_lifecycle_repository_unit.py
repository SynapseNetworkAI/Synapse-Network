# pyright: reportMissingImports=false

from __future__ import annotations

from src.storage.postgres.repositories.service_registry_repository import (
    ServiceRegistryRepository,
)
from tests.unit.storage.test_postgres_repositories_unit import FakeDB


def test_mark_service_offline_uses_race_safe_conditions() -> None:
    db = FakeDB()
    repo = ServiceRegistryRepository(db)

    updated = repo.mark_service_offline_if_still_failed(
        "svc-dead",
        probe_started_at_ms=1773982500000,
        failure_threshold=5,
        last_healthy_cutoff_ms=1773978900000,
        probe_interval_ms=60_000,
        reason="health_probe_unhealthy_threshold",
    )

    assert updated is True
    tx_ops = db.tx_cursors[-1].executed
    offline_sql, offline_params = tx_ops[0]
    assert "SET status = 'offline'" in offline_sql
    assert "sm.status = 'active'" in offline_sql
    assert "sm.updated_at <= %s::timestamptz" in offline_sql
    assert "consecutiveFailures" in offline_sql
    assert "lastCheckedAt" in offline_sql
    assert offline_params[1] == "svc-dead"
    meta_sql, meta_params = tx_ops[1]
    assert "UPDATE synapse_runtime_state" in meta_sql
    assert meta_params[2] == "service_meta::svc-dead"


def test_mark_service_offline_late_probe_noops_when_rowcount_zero() -> None:
    db = FakeDB()
    db.tx_plan.append({"rowcount_overrides": [("UPDATE synapse_service_manifests", 0)]})
    repo = ServiceRegistryRepository(db)

    updated = repo.mark_service_offline_if_still_failed(
        "svc-race",
        probe_started_at_ms=1773982500000,
        failure_threshold=5,
        last_healthy_cutoff_ms=1773978900000,
        probe_interval_ms=60_000,
        reason="health_probe_unhealthy_threshold",
    )

    assert updated is False
    assert len(db.tx_cursors[-1].executed) == 1
