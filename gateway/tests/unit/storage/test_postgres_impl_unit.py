# pyright: reportMissingImports=false

from __future__ import annotations

import contextlib

from src.storage.postgres_impl import PostgresStorage
from src.storage.postgres.schema_contracts import POSTGRES_TABLE_SCHEMA_CONTRACTS


class _FakeCursor:
    def __init__(self, rows):
        self._rows = rows
        self.executed = []

    def execute(self, sql: str, params=None) -> None:
        self.executed.append((sql, params))

    def fetchall(self):
        return self._rows


class _FakeDB:
    def __init__(self, rows):
        self._rows = rows
        self._readonly_index = 0
        self.tx_cursors = []
        self.readonly_cursors = []

    @contextlib.contextmanager
    def readonly_cursor(self):
        if self._rows and isinstance(self._rows[0], list):
            index = min(self._readonly_index, len(self._rows) - 1)
            rows = self._rows[index]
            self._readonly_index += 1
        else:
            rows = self._rows
        cur = _FakeCursor(rows)
        self.readonly_cursors.append(cur)
        yield cur

    @contextlib.contextmanager
    def tx_cursor(self):
        cur = _FakeCursor([])
        self.tx_cursors.append(cur)
        yield cur


def _constraint_rows(contract) -> list[tuple[str]]:
    return [
        (" ".join(constraint.required_fragments),)
        for constraint in contract.required_constraints
    ]


def _maybe_filtered_rows(
    values: list[str],
    *,
    missing_item: tuple[str, str] | None,
    table_name: str,
) -> list[tuple[str]]:
    if missing_item is not None and missing_item[0] == table_name:
        values = [value for value in values if value != missing_item[1]]
    return [(value,) for value in values]


def _maybe_filtered_constraint_rows(
    contract,
    *,
    missing_constraint: tuple[str, str] | None,
) -> list[tuple[str]]:
    constraints = list(_constraint_rows(contract))
    if missing_constraint is not None and missing_constraint[0] == contract.table_name:
        constraints = [
            value for value in constraints if missing_constraint[1] not in value[0]
        ]
    return constraints


def _schema_rows(
    *,
    missing_column: tuple[str, str] | None = None,
    missing_index: tuple[str, str] | None = None,
    missing_constraint: tuple[str, str] | None = None,
):
    rows = []
    for contract in POSTGRES_TABLE_SCHEMA_CONTRACTS:
        rows.append(
            _maybe_filtered_rows(
                sorted(contract.required_columns),
                missing_item=missing_column,
                table_name=contract.table_name,
            )
        )

        if contract.required_indexes:
            rows.append(
                _maybe_filtered_rows(
                    sorted(contract.required_indexes),
                    missing_item=missing_index,
                    table_name=contract.table_name,
                )
            )

        if contract.required_constraints:
            rows.append(
                _maybe_filtered_constraint_rows(
                    contract,
                    missing_constraint=missing_constraint,
                )
            )
    return rows


def test_validate_schema_contract_accepts_latest_synapse_balances_columns() -> None:
    storage = object.__new__(PostgresStorage)
    storage._db = _FakeDB(_schema_rows())  # type: ignore[attr-defined]

    storage._validate_schema_contract()


def test_validate_schema_contract_rejects_missing_account_type() -> None:
    storage = object.__new__(PostgresStorage)
    storage._db = _FakeDB(
        _schema_rows(missing_column=("synapse_balances", "account_type"))
    )  # type: ignore[attr-defined]

    try:
        storage._validate_schema_contract()
        assert False, "expected RuntimeError"
    except RuntimeError as exc:
        assert "account_type" in str(exc)


def test_validate_schema_contract_rejects_missing_trace_id() -> None:
    storage = object.__new__(PostgresStorage)
    storage._db = _FakeDB(
        _schema_rows(missing_column=("synapse_audit_log", "trace_id"))
    )  # type: ignore[attr-defined]

    try:
        storage._validate_schema_contract()
        assert False, "expected RuntimeError"
    except RuntimeError as exc:
        assert "synapse_audit_log" in str(exc)
        assert "trace_id" in str(exc)


def test_validate_schema_contract_rejects_missing_invoke_config() -> None:
    storage = object.__new__(PostgresStorage)
    storage._db = _FakeDB(
        _schema_rows(missing_column=("synapse_service_registry", "invoke_config"))
    )  # type: ignore[attr-defined]

    try:
        storage._validate_schema_contract()
        assert False, "expected RuntimeError"
    except RuntimeError as exc:
        assert "synapse_service_registry" in str(exc)
        assert "invoke_config" in str(exc)


def test_validate_schema_contract_rejects_missing_audit_index() -> None:
    storage = object.__new__(PostgresStorage)
    storage._db = _FakeDB(
        _schema_rows(
            missing_index=("synapse_audit_log", "idx_synapse_audit_log_request_id")
        )
    )  # type: ignore[attr-defined]

    try:
        storage._validate_schema_contract()
        assert False, "expected RuntimeError"
    except RuntimeError as exc:
        assert "synapse_audit_log" in str(exc)
        assert "idx_synapse_audit_log_request_id" in str(exc)


def test_validate_schema_contract_rejects_missing_deposit_attempt_unique_constraint() -> None:
    storage = object.__new__(PostgresStorage)
    storage._db = _FakeDB(
        _schema_rows(
            missing_constraint=(
                "synapse_deposit_attempts",
                "unique attempt_id stage",
            )
        )
    )  # type: ignore[attr-defined]

    try:
        storage._validate_schema_contract()
        assert False, "expected RuntimeError"
    except RuntimeError as exc:
        assert "synapse_deposit_attempts" in str(exc)
        assert "unique attempt stage per attempt_id" in str(exc)
