from __future__ import annotations

import contextlib
from typing import Any

from src.storage.postgres.repositories.service_registry_repository import (
    ServiceRegistryRepository,
)


class FakeCursor:
    def __init__(self) -> None:
        self.executed: list[tuple[str, Any]] = []

    def execute(self, sql: str, params: Any = None) -> None:
        self.executed.append((sql, params))

    def fetchall(self) -> list[Any]:
        return []


class FakeDb:
    def __init__(self) -> None:
        self.readonly_cursors: list[FakeCursor] = []

    @contextlib.contextmanager
    def readonly_cursor(self):
        cursor = FakeCursor()
        self.readonly_cursors.append(cursor)
        yield cursor


def test_read_service_registry_prefers_active_primary_recent_endpoint() -> None:
    db = FakeDb()
    repo = ServiceRegistryRepository(db)

    assert repo.read_service_registry_rows() == []

    registry_sql = db.readonly_cursors[0].executed[0][0]
    assert "(status = 'active') DESC" in registry_sql
    assert "is_primary DESC" in registry_sql
    assert "updated_at DESC" in registry_sql
