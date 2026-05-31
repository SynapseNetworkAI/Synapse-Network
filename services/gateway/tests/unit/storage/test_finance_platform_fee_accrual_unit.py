from __future__ import annotations

import asyncio
from decimal import Decimal
from types import SimpleNamespace

import pytest

from src.domain.finance import BalanceLedger
from src.domain.execution import CompleteWithdrawTxCommand
from src.services.owner.finance_fee_policy import (
    accrue_consumer_withdraw_fee_after_fallback,
    consumer_withdraw_fee_usdc,
)
from src.services.owner.consumer_withdraw_logging import (
    log_consumer_withdraw_completed,
)
from src.services.platform.tasks import consumer_withdraw_completion
from src.services.platform.tasks.consumer_withdraw_completion import (
    emit_consumer_withdraw_completed_metric,
    settle_completed_consumer_withdraw_balance,
)
from src.storage.postgres.repositories.balance_repository import BalanceRepository
from src.storage.postgres.repositories.finance_platform_fee_sql import (
    accrue_platform_fee_if_consumer_withdraw,
)

from tests.unit.storage.test_postgres_repositories_unit import (
    FakeDB,
    FinanceAtomicRepository,
    _q6,
)


class _BalanceRepo:
    def __init__(self) -> None:
        self.ledger = BalanceLedger()
        self.written: list[BalanceLedger] = []

    def read_balance_ledger(self) -> BalanceLedger:
        return self.ledger

    def write_balance_ledger(self, ledger: BalanceLedger) -> None:
        self.written.append(ledger)


class _Storage:
    def __init__(self, balance_repo: _BalanceRepo) -> None:
        self._dm = SimpleNamespace(finance=SimpleNamespace(balance=balance_repo))

    def get_data_manager(self) -> SimpleNamespace:
        return self._dm


class _FastSettleBalanceRepo:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def consume_consumer_pending_for_withdrawal_and_accrue_platform_fee(
        self,
        *,
        owner: str,
        amount_usdc: Decimal,
        fee_usdc: Decimal,
        updated_at: str,
    ) -> None:
        self.calls.append(
            {
                "owner": owner,
                "amount_usdc": amount_usdc,
                "fee_usdc": fee_usdc,
                "updated_at": updated_at,
            }
        )


def test_finance_atomic_repository_complete_consumer_withdraw_accrues_platform_fee() -> None:
    db = FakeDB()
    db.connect_plan.append(
        {
            "fetchone": [
                ("wd-1", "acct-consumer", Decimal("20.000000"), "REQUESTED", None)
            ]
        }
    )
    repo = FinanceAtomicRepository(
        db,
        _q6,
        "UPSERT",
        "BAL_FOR_UPDATE",
        "AUDIT_INSERT",
        ("restricted", "suspended", "blocked"),
    )

    ok = repo.complete_withdraw_tx_atomic(
        CompleteWithdrawTxCommand(
            owner_wallet="0xabc",
            tx_hash="0xtx",
            kind="owner_refund",
            withdrawal_id="wd-1",
        )
    )

    assert ok is True
    executed = db.connections[0].cursor_obj.executed
    sql_dump = "\n".join(sql for sql, _ in executed)
    params_dump = [params for _, params in executed if params is not None]
    assert "INSERT INTO synapse_withdraw_tx_dedup" in sql_dump
    assert "SET pending_balance = pending_balance - %s" in sql_dump
    assert "SET available_balance = available_balance + %s" in sql_dump
    assert "platform_revenue::main" in str(params_dump)
    assert "0.500000" in str(params_dump)


def test_consumer_withdraw_fee_fallback_ignores_non_consumer_withdraw() -> None:
    balance_repo = _BalanceRepo()

    accrue_consumer_withdraw_fee_after_fallback(
        _Storage(balance_repo),
        SimpleNamespace(refund_type="provider_refund"),
    )

    assert balance_repo.written == []


def test_consumer_withdraw_fee_fallback_accrues_platform_fee() -> None:
    balance_repo = _BalanceRepo()

    accrue_consumer_withdraw_fee_after_fallback(
        _Storage(balance_repo),
        SimpleNamespace(refund_type="consumer_withdraw"),
    )

    assert balance_repo.written == [balance_repo.ledger]
    assert balance_repo.ledger.platform.fee_accrued == consumer_withdraw_fee_usdc()


def test_settle_completed_consumer_withdraw_uses_atomic_fee_settle_when_available() -> None:
    balance_repo = _FastSettleBalanceRepo()
    dm = SimpleNamespace(finance=SimpleNamespace(balance=balance_repo))

    settle_completed_consumer_withdraw_balance(
        dm,
        owner="0xabc",
        amount_usdc=Decimal("10"),
        fee_usdc=Decimal("0.5"),
    )

    assert len(balance_repo.calls) == 1
    assert balance_repo.calls[0]["owner"] == "0xabc"
    assert balance_repo.calls[0]["amount_usdc"] == Decimal("10")
    assert balance_repo.calls[0]["fee_usdc"] == Decimal("0.5")


@pytest.mark.asyncio
async def test_emit_consumer_withdraw_completed_metric_schedules_background_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, Decimal, str, str]] = []

    async def _fake_emit(
        owner: str,
        *,
        amount_usdc: Decimal,
        tx_hash: str,
        role: str,
    ) -> None:
        calls.append((owner, amount_usdc, tx_hash, role))

    monkeypatch.setattr(
        consumer_withdraw_completion,
        "emit_withdrawal_completed",
        _fake_emit,
    )

    emit_consumer_withdraw_completed_metric("0xabc", Decimal("3.25"), "0xtx")
    await asyncio.sleep(0)

    assert calls == [("0xabc", Decimal("3.25"), "0xtx", "consumer")]


def test_log_consumer_withdraw_completed_emits_structured_line(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level("INFO"):
        log_consumer_withdraw_completed(
            withdrawal_id="wd-1",
            owner="0xabc",
            amount_usdc=Decimal("10"),
            fee_usdc=Decimal("0.5"),
            net_usdc=Decimal("9.5"),
            tx_hash="0xtx",
            completion_source="client_complete",
        )

    assert "event=CONSUMER_WITHDRAW_COMPLETED" in caplog.text
    assert "withdrawal_id=wd-1" in caplog.text
    assert "completion_source=client_complete" in caplog.text


def test_balance_repository_consumes_consumer_pending_and_accrues_platform_fee() -> None:
    db = FakeDB()
    repo = BalanceRepository(db, _q6, "UPSERT")

    repo.consume_consumer_pending_for_withdrawal_and_accrue_platform_fee(
        owner="0xABC",
        amount_usdc=Decimal("12"),
        fee_usdc=Decimal("0.5"),
        updated_at="2026-05-09T00:00:00Z",
    )

    assert len(db.tx_cursors) == 2
    all_sql = "\n".join(sql for cur in db.tx_cursors for sql, _ in cur.executed)
    all_params = [
        params
        for cur in db.tx_cursors
        for _, params in cur.executed
        if params is not None
    ]
    assert "INSERT INTO synapse_ledger_accounts" in all_sql
    assert "ON CONFLICT (account_id) DO NOTHING" in all_sql
    assert "SET pending_balance = pending_balance - %s" in all_sql
    assert "SET available_balance = available_balance + %s" in all_sql
    assert "consumer_wallet::0xabc" in str(all_params)
    assert "platform_revenue::main" in str(all_params)


def test_balance_repository_consumer_pending_consume_fails_closed_on_missing_row() -> None:
    db = FakeDB()
    db.tx_plan.append({})
    db.tx_plan.append({"rowcount_overrides": [("UPDATE synapse_account_balances", 0)]})
    repo = BalanceRepository(db, _q6, "UPSERT")

    with pytest.raises(RuntimeError, match="CONSUME_PENDING_BALANCE_INCONSISTENT"):
        repo.consume_consumer_pending_for_withdrawal_and_accrue_platform_fee(
            owner="0xABC",
            amount_usdc=Decimal("12"),
            fee_usdc=Decimal("0.5"),
            updated_at="2026-05-09T00:00:00Z",
        )


def test_balance_repository_platform_fee_accrual_fails_closed_on_missing_row() -> None:
    db = FakeDB()
    db.tx_plan.append({})
    db.tx_plan.append(
        {
            "rowcount_overrides": [
                ("SET available_balance = available_balance + %s", 0)
            ]
        }
    )
    repo = BalanceRepository(db, _q6, "UPSERT")

    with pytest.raises(RuntimeError, match="PLATFORM_FEE_ACCRUAL_INCONSISTENT"):
        repo.consume_consumer_pending_for_withdrawal_and_accrue_platform_fee(
            owner="0xABC",
            amount_usdc=Decimal("12"),
            fee_usdc=Decimal("0.5"),
            updated_at="2026-05-09T00:00:00Z",
        )


def test_platform_fee_sql_ignores_non_consumer_withdrawal_kind() -> None:
    db = FakeDB()
    with db.tx_cursor() as cur:
        accrue_platform_fee_if_consumer_withdraw(
            cur,
            lambda _cur, _owner, _kind, _now: "platform_revenue::main",
            "2026-05-09T00:00:00Z",
            "provider_withdraw",
        )

    assert db.tx_cursors[-1].executed == []


def test_platform_fee_sql_fails_closed_when_platform_fee_row_is_missing() -> None:
    db = FakeDB()
    db.tx_plan.append(
        {
            "rowcount_overrides": [
                ("SET available_balance = available_balance + %s", 0)
            ]
        }
    )

    with db.tx_cursor() as cur:
        with pytest.raises(RuntimeError, match="PLATFORM_FEE_ACCRUAL_INCONSISTENT"):
            accrue_platform_fee_if_consumer_withdraw(
                cur,
                lambda _cur, _owner, _kind, _now: "platform_revenue::main",
                "2026-05-09T00:00:00Z",
                "consumer_refund",
            )
