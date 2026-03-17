# pyright: reportMissingImports=false

from __future__ import annotations

import contextlib
from decimal import Decimal
from types import SimpleNamespace

from src.storage.postgres_impl import PostgresStorage
from src.storage.postgres.schema_contracts import POSTGRES_TABLE_SCHEMA_CONTRACTS
from src.domain.finance import (
    ChargeConsumerUsageCommand,
    CompleteWithdrawTxCommand,
    DepositIntentConfirmCommand,
    DepositIntentRegisterCommand,
    DepositIntentRow,
    ReserveProviderWithdrawCommand,
    UsageLogRow,
    WithdrawalAtomicRequestCommand,
)


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


def test_validate_schema_contract_accepts_latest_agent_runtime_schema() -> None:
    storage = object.__new__(PostgresStorage)
    storage._db = _FakeDB(_schema_rows())  # type: ignore[attr-defined]

    storage._validate_schema_contract()


def test_validate_schema_contract_rejects_missing_owner_wallet() -> None:
    storage = object.__new__(PostgresStorage)
    storage._db = _FakeDB(
        _schema_rows(missing_column=("synapse_owner_accounts", "owner_wallet"))
    )  # type: ignore[attr-defined]

    try:
        storage._validate_schema_contract()
        assert False, "expected RuntimeError"
    except RuntimeError as exc:
        assert "owner_wallet" in str(exc)


def test_validate_schema_contract_rejects_missing_detail_json() -> None:
    storage = object.__new__(PostgresStorage)
    storage._db = _FakeDB(
        _schema_rows(missing_column=("synapse_audit_events", "detail_json"))
    )  # type: ignore[attr-defined]

    try:
        storage._validate_schema_contract()
        assert False, "expected RuntimeError"
    except RuntimeError as exc:
        assert "synapse_audit_events" in str(exc)
        assert "detail_json" in str(exc)


def test_validate_schema_contract_rejects_missing_endpoint_url() -> None:
    storage = object.__new__(PostgresStorage)
    storage._db = _FakeDB(
        _schema_rows(missing_column=("synapse_service_endpoints", "endpoint_url"))
    )  # type: ignore[attr-defined]

    try:
        storage._validate_schema_contract()
        assert False, "expected RuntimeError"
    except RuntimeError as exc:
        assert "synapse_service_endpoints" in str(exc)
        assert "endpoint_url" in str(exc)


def test_validate_schema_contract_rejects_missing_audit_index() -> None:
    storage = object.__new__(PostgresStorage)
    storage._db = _FakeDB(
        _schema_rows(
            missing_index=("synapse_audit_events", "idx_synapse_audit_events_owner_created")
        )
    )  # type: ignore[attr-defined]

    try:
        storage._validate_schema_contract()
        assert False, "expected RuntimeError"
    except RuntimeError as exc:
        assert "synapse_audit_events" in str(exc)
        assert "idx_synapse_audit_events_owner_created" in str(exc)


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


def test_postgres_storage_forwards_typed_finance_atomic_commands() -> None:
    captured = {}

    class _Atomic:
        def process_withdrawal_request_atomic(self, command):
            captured["withdraw"] = command
            return "withdraw-ok"

        def register_deposit_intent_atomic(self, command):
            captured["register"] = command
            return command.intent_row

        def confirm_deposit_intent_atomic(self, command):
            captured["confirm"] = command
            return DepositIntentRow(
                id=command.deposit_intent_id,
                ownerAddress=command.owner_wallet,
                txHash="0x" + "1" * 64,
                status="CONFIRMED",
                createdAt="2026-03-17 00:00:00",
                updatedAt="2026-03-17 00:00:01",
            )

        def complete_withdraw_tx_atomic(self, command):
            captured["complete_tx"] = command
            return True

        def charge_consumer_and_record_usage_atomic(self, command):
            captured["charge"] = command
            return SimpleNamespace(consumer_available_balance_after=7.5)

        def reserve_provider_withdraw_atomic(self, command):
            captured["reserve"] = command
            return SimpleNamespace(before_balance=10.0, after_balance=8.0)

    storage = object.__new__(PostgresStorage)
    storage._data_manager = SimpleNamespace(  # type: ignore[attr-defined]
        finance=SimpleNamespace(atomic=_Atomic())
    )

    withdraw_command = WithdrawalAtomicRequestCommand(
        provider_address="0xabc",
        amount_usdc=Decimal("12.000000"),
        request_id="req-1",
        idempotency_key="idem-1",
        request_meta={"requestId": "req-1"},
        single_limit_usdc=Decimal("100"),
        rolling_24h_limit_usdc=Decimal("500"),
        window_seconds=86400,
        high_risk_override=False,
    )
    deposit_row = DepositIntentRow(
        id="dep-1",
        ownerAddress="0xabc",
        txHash="0x" + "2" * 64,
        createdAt="2026-03-17 00:00:00",
        updatedAt="2026-03-17 00:00:01",
    )
    register_command = DepositIntentRegisterCommand(
        owner_wallet="0xabc",
        tx_hash=deposit_row.tx_hash,
        request_id="idem-2",
        intent_row=deposit_row,
    )
    confirm_command = DepositIntentConfirmCommand(
        owner_wallet="0xabc",
        deposit_intent_id="dep-1",
        event_key="evt-1",
        confirmations=3,
    )
    complete_tx_command = CompleteWithdrawTxCommand(
        owner_wallet="0xabc",
        tx_hash="0x" + "3" * 64,
        kind="provider_withdraw",
    )
    charge_command = ChargeConsumerUsageCommand(
        owner_wallet="0xabc",
        provider_wallet="0xdef",
        total_charge=Decimal("1.250000"),
        provider_net=Decimal("1.000000"),
        platform_fee_total=Decimal("0.250000"),
        usage_row=UsageLogRow(
            id="usage-1",
            ts=1,
            consumerAddress="0xabc",
            providerAddress="0xdef",
            totalCharge=Decimal("1.250000"),
        ),
    )
    reserve_command = ReserveProviderWithdrawCommand(
        owner_wallet="0xabc",
        amount_usdc=Decimal("2.000000"),
    )

    assert storage.process_withdrawal_request_atomic(withdraw_command) == "withdraw-ok"
    assert storage.register_deposit_intent_atomic(register_command) == deposit_row
    confirmed = storage.confirm_deposit_intent_atomic(confirm_command)
    assert storage.complete_withdraw_tx_atomic(complete_tx_command) is True
    charged = storage.charge_consumer_and_record_usage_atomic(charge_command)
    reserved = storage.reserve_provider_withdraw_atomic(reserve_command)

    assert captured["withdraw"] == withdraw_command
    assert captured["register"] == register_command
    assert captured["confirm"] == confirm_command
    assert captured["complete_tx"] == complete_tx_command
    assert captured["charge"] == charge_command
    assert captured["reserve"] == reserve_command
    assert confirmed.status == "CONFIRMED"
    assert abs(charged.consumer_available_balance_after - 7.5) < 1e-9
    assert abs(reserved.after_balance - 8.0) < 1e-9
