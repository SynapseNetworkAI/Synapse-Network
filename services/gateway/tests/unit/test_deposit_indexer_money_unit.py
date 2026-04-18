from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

from src.domain.finance import BalanceLedger, ConsumerWalletRecord
from src.services.platform.tasks.deposit_indexer.chain import (
    _amount_usdc_from_raw,
    _pick_matching_event,
)
from src.services.platform.tasks.deposit_indexer.reconciliation import (
    run_reconciliation_check_once,
)


class _FakeBalanceRepository:
    def read_balance_ledger(self) -> BalanceLedger:
        return BalanceLedger(
            consumerWallets=[
                ConsumerWalletRecord(
                    ownerAddress="0x1111111111111111111111111111111111111111",
                    availableBalance=Decimal("7.500000"),
                    pendingBalance=Decimal("2.500000"),
                )
            ]
        )


class _FakeGatewayStateRepository:
    def __init__(self) -> None:
        self.runtime_state: dict[str, dict[str, object]] = {}

    def read_runtime_state(self, state_key: str) -> dict[str, object]:
        return dict(self.runtime_state.get(state_key) or {})

    def write_runtime_state(self, state_key: str, payload: dict[str, object]) -> None:
        self.runtime_state[state_key] = dict(payload)


class _FakeAuditLogRepository:
    def __init__(self) -> None:
        self.rows: list[object] = []

    def append_audit_row(self, row: object) -> None:
        self.rows.append(row)


class _FakeStorage:
    def __init__(self) -> None:
        self.gateway_state = _FakeGatewayStateRepository()
        self.audit_logs = _FakeAuditLogRepository()
        self._data_manager = SimpleNamespace(
            finance=SimpleNamespace(balance=_FakeBalanceRepository()),
            system=SimpleNamespace(gateway_state=self.gateway_state),
            audit=SimpleNamespace(logs=self.audit_logs),
        )

    def get_data_manager(self) -> SimpleNamespace:
        return self._data_manager


def test_amount_usdc_from_raw_returns_decimal_not_float() -> None:
    amount = _amount_usdc_from_raw(1234567, decimals=6)

    assert amount == Decimal("1.234567")
    assert not isinstance(amount, float)


def test_pick_matching_event_compares_decimal_amounts(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.chain._resolve_token_decimals",
        lambda _token: 6,
    )

    matched = _pick_matching_event(
        [
            {
                "ownerAddress": "0x1111111111111111111111111111111111111111",
                "amountRaw": 999999,
                "token": "0x0000000000000000000000000000000000000001",
            },
            {
                "ownerAddress": "0x1111111111111111111111111111111111111111",
                "amountRaw": 1000000,
                "token": "0x0000000000000000000000000000000000000001",
            },
        ],
        "0x1111111111111111111111111111111111111111",
        Decimal("1.000000"),
    )

    assert matched is not None
    assert matched["amountRaw"] == 1000000


def test_reconciliation_persists_money_as_strings(monkeypatch) -> None:
    storage = _FakeStorage()
    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.reconciliation.settings",
        SimpleNamespace(
            v2_reconciliation_enabled=True,
            v2_reconciliation_alert_delta_usdc=Decimal("0.100000"),
            router_address="0x2222222222222222222222222222222222222222",
        ),
    )
    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.reconciliation._read_chain_vault_balance_usdc",
        lambda: Decimal("10.250000"),
    )
    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.reconciliation._now",
        lambda: 1711111111,
    )

    summary = run_reconciliation_check_once(storage)

    assert summary["chainVaultUsdc"] == "10.250000"
    assert summary["ledgerObligationUsdc"] == "10.000000"
    assert summary["deltaUsdc"] == "0.250000"
    assert summary["alert"] is True
    persisted = storage.gateway_state.runtime_state["deposit_reconciliation_state"]
    assert persisted["chainVaultUsdc"] == "10.250000"
    assert persisted["deltaUsdc"] == "0.250000"
