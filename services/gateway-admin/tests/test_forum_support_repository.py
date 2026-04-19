from __future__ import annotations

import pytest

from src.storage.forum_support import postgres


class FakeCursor:
    def __init__(self, table_name: str | None) -> None:
        self.table_name = table_name
        self.queries: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, query: str, *_args, **_kwargs) -> None:
        self.queries.append(query)

    def fetchone(self):
        return {"table_name": self.table_name}


class FakeConnection:
    def __init__(self, cursor: FakeCursor) -> None:
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return self._cursor


def test_forum_support_schema_probe_does_not_run_ddl_when_table_exists(monkeypatch: pytest.MonkeyPatch) -> None:
    cursor = FakeCursor("synapse_forum_response_tasks")
    monkeypatch.setattr(postgres, "_connect", lambda _dsn: FakeConnection(cursor))

    postgres.PostgresForumSupportRepository("postgresql://example").ensure_schema()

    assert len(cursor.queries) == 1
    assert "to_regclass" in cursor.queries[0]


def test_forum_support_schema_probe_reports_missing_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    cursor = FakeCursor(None)
    monkeypatch.setattr(postgres, "_connect", lambda _dsn: FakeConnection(cursor))

    with pytest.raises(RuntimeError, match="Forum support schema is missing"):
        postgres.PostgresForumSupportRepository("postgresql://example").ensure_schema()
