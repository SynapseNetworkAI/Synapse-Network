# pyright: reportMissingImports=false

from __future__ import annotations

import contextlib

from src.storage.postgres_impl import PostgresStorage


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


def test_validate_schema_contract_accepts_latest_synapse_balances_columns() -> None:
    storage = object.__new__(PostgresStorage)
    storage._db = _FakeDB(
        [[
            ("owner_address",),
            ("account_type",),
            ("available_balance",),
            ("pending_balance",),
            ("frozen_balance",),
            ("updated_at",),
        ], [
            ("state_key",),
            ("payload",),
            ("updated_at",),
        ], [
            ("service_id",),
            ("record_id",),
            ("owner_address",),
            ("service_name",),
            ("service_role",),
            ("service_address",),
            ("summary",),
            ("endpoint",),
            ("status",),
            ("is_active",),
            ("pricing_amount",),
            ("tags_json",),
            ("auth_json",),
            ("health_check_json",),
            ("forwarding_json",),
            ("metering_json",),
            ("invoke_config",),
            ("pricing_currency",),
            ("schema_version",),
            ("timeout_ms",),
            ("max_qps",),
            ("max_request_bytes",),
            ("max_response_bytes",),
            ("created_at",),
            ("updated_at",),
        ], [
            ("action_type",),
            ("business_type",),
            ("risk_level",),
            ("owner_address",),
            ("actor",),
            ("request_id",),
            ("trace_id",),
            ("tx_hash",),
            ("counterparty_address",),
            ("direction",),
            ("status",),
            ("risk_reason_code",),
            ("ledger_id",),
            ("client_ip",),
            ("user_agent",),
            ("amount_delta",),
            ("before_balance",),
            ("after_balance",),
            ("result_status",),
            ("error_code",),
            ("message",),
            ("created_at",),
        ], [
            ("action_type",),
            ("owner_address",),
            ("actor",),
            ("request_id",),
            ("trace_id",),
            ("resource_type",),
            ("resource_id",),
            ("result_status",),
            ("error_code",),
            ("ip_address",),
            ("user_agent",),
            ("detail_json",),
            ("created_at",),
        ], [
            ("attempt_id",),
            ("owner_address",),
            ("client_request_id",),
            ("tx_hash",),
            ("amount_usdc",),
            ("stage",),
            ("failure_reason",),
            ("request_id",),
            ("client_ip",),
            ("user_agent",),
            ("created_at",),
            ("updated_at",),
        ]]
    )  # type: ignore[attr-defined]

    storage._validate_schema_contract()


def test_validate_schema_contract_rejects_missing_account_type() -> None:
    storage = object.__new__(PostgresStorage)
    storage._db = _FakeDB(
        [[
            ("owner_address",),
            ("available_balance",),
            ("pending_balance",),
            ("frozen_balance",),
            ("updated_at",),
        ]]
    )  # type: ignore[attr-defined]

    try:
        storage._validate_schema_contract()
        assert False, "expected RuntimeError"
    except RuntimeError as exc:
        assert "account_type" in str(exc)


def test_validate_schema_contract_rejects_missing_trace_id() -> None:
    storage = object.__new__(PostgresStorage)
    storage._db = _FakeDB(
        [[
            ("owner_address",),
            ("account_type",),
            ("available_balance",),
            ("pending_balance",),
            ("frozen_balance",),
            ("updated_at",),
        ], [
            ("state_key",),
            ("payload",),
            ("updated_at",),
        ], [
            ("service_id",),
            ("record_id",),
            ("owner_address",),
            ("service_name",),
            ("service_role",),
            ("service_address",),
            ("summary",),
            ("endpoint",),
            ("status",),
            ("is_active",),
            ("pricing_amount",),
            ("tags_json",),
            ("auth_json",),
            ("health_check_json",),
            ("forwarding_json",),
            ("metering_json",),
            ("invoke_config",),
            ("pricing_currency",),
            ("schema_version",),
            ("timeout_ms",),
            ("max_qps",),
            ("max_request_bytes",),
            ("max_response_bytes",),
            ("created_at",),
            ("updated_at",),
        ], [
            ("action_type",),
            ("business_type",),
            ("risk_level",),
            ("owner_address",),
            ("actor",),
            ("request_id",),
            ("tx_hash",),
            ("counterparty_address",),
            ("direction",),
            ("status",),
            ("risk_reason_code",),
            ("ledger_id",),
            ("client_ip",),
            ("user_agent",),
            ("amount_delta",),
            ("before_balance",),
            ("after_balance",),
            ("result_status",),
            ("error_code",),
            ("message",),
            ("created_at",),
        ], [
            ("attempt_id",),
            ("owner_address",),
            ("client_request_id",),
            ("tx_hash",),
            ("amount_usdc",),
            ("stage",),
            ("failure_reason",),
            ("request_id",),
            ("client_ip",),
            ("user_agent",),
            ("created_at",),
            ("updated_at",),
        ]]
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
        [[
            ("owner_address",),
            ("account_type",),
            ("available_balance",),
            ("pending_balance",),
            ("frozen_balance",),
            ("updated_at",),
        ], [
            ("state_key",),
            ("payload",),
            ("updated_at",),
        ], [
            ("service_id",),
            ("record_id",),
            ("owner_address",),
            ("service_name",),
            ("service_role",),
            ("service_address",),
            ("summary",),
            ("endpoint",),
            ("status",),
            ("is_active",),
            ("pricing_amount",),
            ("tags_json",),
            ("auth_json",),
            ("health_check_json",),
            ("forwarding_json",),
            ("metering_json",),
            ("pricing_currency",),
            ("schema_version",),
            ("timeout_ms",),
            ("max_qps",),
            ("max_request_bytes",),
            ("max_response_bytes",),
            ("created_at",),
            ("updated_at",),
        ], [
            ("attempt_id",),
            ("owner_address",),
            ("client_request_id",),
            ("tx_hash",),
            ("amount_usdc",),
            ("stage",),
            ("failure_reason",),
            ("request_id",),
            ("client_ip",),
            ("user_agent",),
            ("created_at",),
            ("updated_at",),
        ]]
    )  # type: ignore[attr-defined]

    try:
        storage._validate_schema_contract()
        assert False, "expected RuntimeError"
    except RuntimeError as exc:
        assert "synapse_service_registry" in str(exc)
        assert "invoke_config" in str(exc)
