# pyright: reportMissingImports=false

from __future__ import annotations

import contextlib
from typing import Any

from src.domain.registry import ServiceTargetHealth, ServiceTargetHealthHistory
from src.storage.postgres.repositories.service_registry_repository import (
    ServiceRegistryRepository,
)


class FakeCursor:
    def __init__(self) -> None:
        self.executed: list[tuple[str, Any]] = []
        self.rowcount = 1

    def execute(self, sql: str, params: Any = None) -> None:
        self.executed.append((sql, params))
        self.rowcount = 1


class FakeDB:
    def __init__(self) -> None:
        self.tx_cursors: list[FakeCursor] = []

    @contextlib.contextmanager
    def tx_cursor(self):
        cur = FakeCursor()
        self.tx_cursors.append(cur)
        yield cur


def test_service_health_history_write_appends_typed_events_only() -> None:
    db = FakeDB()
    repo = ServiceRegistryRepository(db)

    repo.write_service_target_health_history_rows(
        [
            ServiceTargetHealthHistory(
                serviceId="svc-b",
                ownerAddress="0xDEF",
                targetUrl="https://b",
                checkedAt=3,
            ),
            ServiceTargetHealthHistory(
                serviceId="svc-a",
                ownerAddress="0xABC",
                targetUrl="https://a",
                checkedAt=4,
            ),
        ]
    )

    all_sql = "\n".join(sql for sql, _ in db.tx_cursors[-1].executed)
    assert "INSERT INTO synapse_service_health_events" in all_sql
    assert "synapse_runtime_state" not in all_sql
    assert "DELETE FROM" not in all_sql


def test_service_health_runtime_upsert_refreshes_probe_metrics_and_timestamp() -> None:
    db = FakeDB()
    repo = ServiceRegistryRepository(db)

    repo.write_service_target_health_rows(
        [
            ServiceTargetHealth(
                serviceId="svc-runtime",
                ownerAddress="0xABC",
                targetUrl="https://runtime.test/invoke",
                status="healthy",
                overallStatus="healthy",
                latencyMs=17,
                consecutiveSuccesses=9,
                consecutiveFailures=0,
                lastCheckedAt=1773982500000,
                lastHealthyAt=1773982500000,
            )
        ]
    )

    all_sql = "\n".join(sql for sql, _ in db.tx_cursors[-1].executed)
    assert "ON CONFLICT (service_id, target_url)" in all_sql
    assert "last_checked_at = EXCLUDED.last_checked_at" in all_sql
    assert "latency_ms = EXCLUDED.latency_ms" in all_sql
    assert "consecutive_failures = EXCLUDED.consecutive_failures" in all_sql
    assert "updated_at = NOW()" in all_sql


def test_service_health_events_prune_uses_ttl_table_only() -> None:
    db = FakeDB()
    repo = ServiceRegistryRepository(db)

    removed = repo.prune_service_target_health_events(7)

    assert removed == 1
    all_sql = "\n".join(sql for sql, _ in db.tx_cursors[-1].executed)
    assert "DELETE FROM synapse_service_health_events" in all_sql
    assert "synapse_runtime_state" not in all_sql
