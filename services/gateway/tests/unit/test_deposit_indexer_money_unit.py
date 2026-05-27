from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

from src.domain.finance import (
    BalanceLedger,
    ConsumerWalletRecord,
    PlatformFees,
    ProviderWalletRecord,
)
from src.services.platform.tasks.deposit_indexer.chain import (
    _amount_usdc_from_raw,
    _pick_matching_event,
)
from src.services.platform.tasks.deposit_indexer.reconciliation import (
    run_reconciliation_check_once,
)
from src.services.platform.tasks.deposit_indexer.processing import (
    _resolve_deposit_receipt_state,
)
from src.utils.datetime_utils import to_epoch_seconds


class _FakeBalanceRepository:
    def read_balance_ledger(self) -> BalanceLedger:
        return BalanceLedger(
            consumerWallets=[
                ConsumerWalletRecord(
                    ownerAddress="0x1111111111111111111111111111111111111111",
                    availableBalance=Decimal("7.500000"),
                    pendingBalance=Decimal("2.500000"),
                    frozenBalance=Decimal("1.250000"),
                )
            ],
            providerWallets=[
                ProviderWalletRecord(
                    ownerAddress="0x2222222222222222222222222222222222222222",
                    availableBalance=Decimal("0.750000"),
                    pendingBalance=Decimal("0.250000"),
                    frozenBalance=Decimal("0.500000"),
                )
            ],
            platform=PlatformFees(feeAccrued=Decimal("0.500000")),
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
        lambda: Decimal("13.250000"),
    )
    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.reconciliation._now",
        lambda: 1711111111,
    )

    summary = run_reconciliation_check_once(storage)

    assert summary["chainVaultUsdc"] == "13.250000"
    assert summary["ledgerObligationUsdc"] == "13.250000"
    assert summary["deltaUsdc"] == "0.000000"
    assert summary["alert"] is False
    persisted = storage.gateway_state.runtime_state["deposit_reconciliation_state"]
    assert persisted["chainVaultUsdc"] == "13.250000"
    assert persisted["ledgerObligationUsdc"] == "13.250000"
    assert persisted["deltaUsdc"] == "0.000000"


def test_balance_ledger_total_vault_tracked_balance_includes_frozen_provider_and_platform() -> None:
    ledger = BalanceLedger(
        consumerWallets=[
            ConsumerWalletRecord(
                ownerAddress="0x1111111111111111111111111111111111111111",
                availableBalance=Decimal("7.500000"),
                pendingBalance=Decimal("2.500000"),
                frozenBalance=Decimal("1.250000"),
            )
        ],
        providerWallets=[
            ProviderWalletRecord(
                ownerAddress="0x2222222222222222222222222222222222222222",
                availableBalance=Decimal("0.750000"),
                pendingBalance=Decimal("0.250000"),
                frozenBalance=Decimal("0.500000"),
            )
        ],
        platform=PlatformFees(feeAccrued=Decimal("0.500000")),
    )

    assert ledger.total_consumer_obligation() == Decimal("10.000000")
    assert ledger.total_vault_tracked_balance() == Decimal("13.250000")


def test_deposit_receipt_failed_tx_does_not_credit(monkeypatch) -> None:
    intent = {
        "id": "dep_failed",
        "ownerAddress": "0x1111111111111111111111111111111111111111",
        "amountUsdc": "1.000000",
        "status": "PENDING_CONFIRMATION",
    }
    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.processing._get_confirmed_receipt_or_none",
        lambda _tx_hash: {"failed": True},
    )

    result = _resolve_deposit_receipt_state(
        tx_hash="0xabc",
        owner_wallet="0x1111111111111111111111111111111111111111",
        min_amount_usdc=Decimal("1.000000"),
        now=1711111111,
        intent=intent,
    )

    assert result == {"result": "failed"}
    assert intent["status"] == "FAILED"
    assert intent["failureReason"] == "CHAIN_TX_FAILED"


def test_deposit_receipt_without_matching_current_contract_event_does_not_credit(monkeypatch) -> None:
    intent = {
        "id": "dep_no_event",
        "ownerAddress": "0x1111111111111111111111111111111111111111",
        "amountUsdc": "1.000000",
        "status": "PENDING_CONFIRMATION",
    }
    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.processing._get_confirmed_receipt_or_none",
        lambda _tx_hash: {"receipt": {"transactionHash": "0xabc"}},
    )
    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.processing._resolve_matched_event",
        lambda _receipt, _owner_wallet, _min_amount_usdc: None,
    )

    result = _resolve_deposit_receipt_state(
        tx_hash="0xabc",
        owner_wallet="0x1111111111111111111111111111111111111111",
        min_amount_usdc=Decimal("1.000000"),
        now=1711111111,
        intent=intent,
    )

    assert result == {"result": "failed"}
    assert intent["status"] == "FAILED"
    assert intent["failureReason"] == "NO_MATCHING_DEPOSIT_EVENT"


def test_pending_intent_times_out_when_receipt_never_appears(monkeypatch) -> None:
    intent = {
        "id": "dep_timeout",
        "ownerAddress": "0x1111111111111111111111111111111111111111",
        "amountUsdc": "1.000000",
        "status": "PENDING_CONFIRMATION",
        "createdAt": "2026-05-27 00:00:00",
    }
    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.processing._get_confirmed_receipt_or_none",
        lambda _tx_hash: None,
    )
    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.processing.settings",
        SimpleNamespace(deposit_pending_intent_stale_after_sec=10),
    )

    result = _resolve_deposit_receipt_state(
        tx_hash="0xabc",
        owner_wallet="0x1111111111111111111111111111111111111111",
        min_amount_usdc=Decimal("1.000000"),
        now=to_epoch_seconds("2026-05-27 00:00:30"),
        intent=intent,
    )

    assert result == {"result": "failed"}
    assert intent["status"] == "FAILED"
    assert intent["failureReason"] == "MISSING_TX_RECEIPT_TIMEOUT"
