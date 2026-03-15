# pyright: reportMissingImports=false

from __future__ import annotations

import contextlib

from src.storage.postgres_impl import PostgresStorage


class _FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    def execute(self, sql: str, params=None) -> None:
        _ = sql
        _ = params

    def fetchall(self):
        return self._rows


class _FakeDB:
    def __init__(self, rows):
        self._rows = rows

    @contextlib.contextmanager
    def readonly_cursor(self):
        yield _FakeCursor(self._rows)


def test_validate_schema_contract_accepts_latest_synapse_balances_columns() -> None:
    storage = object.__new__(PostgresStorage)
    storage._db = _FakeDB(
        [
            ("owner_address",),
            ("account_type",),
            ("available_balance",),
            ("pending_balance",),
            ("frozen_balance",),
            ("updated_at",),
        ]
    )  # type: ignore[attr-defined]

    storage._validate_schema_contract()


def test_validate_schema_contract_rejects_missing_account_type() -> None:
    storage = object.__new__(PostgresStorage)
    storage._db = _FakeDB(
        [
            ("owner_address",),
            ("available_balance",),
            ("pending_balance",),
            ("frozen_balance",),
            ("updated_at",),
        ]
    )  # type: ignore[attr-defined]

    try:
        storage._validate_schema_contract()
        assert False, "expected RuntimeError"
    except RuntimeError as exc:
        assert "account_type" in str(exc)
