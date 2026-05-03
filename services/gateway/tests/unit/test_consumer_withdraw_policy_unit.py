"""Consumer withdrawal dust, maturity, and sliding-window policy tests."""
from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi import HTTPException

from src.services.owner.finance_constants import CONSUMER_WITHDRAW_MAX_DAILY_COUNT

from tests.unit.test_consumer_withdraw_unit import (
    IDEM_KEY,
    OWNER,
    FakeStorage,
    _make_service,
    run,
)


def test_consumer_dust_withdrawal_rejected_without_creating_row() -> None:
    storage = FakeStorage()
    storage.balance_repo.seed_balance(OWNER, available=100)
    svc = _make_service(storage)

    with pytest.raises(HTTPException) as exc_info:
        run(svc.create_consumer_withdraw_intent(
            payload={"amountUsdc": "9.99", "reason": ""},
            owner_wallet=OWNER,
            idempotency_key=IDEM_KEY,
        ))

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "MIN_WITHDRAWAL_AMOUNT_NOT_MET"
    assert storage.gateway_state.refund_rows == []
    ledger = storage.balance_repo.read_balance_ledger()
    assert ledger.consumer_available_balance(OWNER) == Decimal("100.000000")
    assert ledger.consumer_pending_balance(OWNER) == Decimal("0.000000")


def test_consumer_withdraw_more_than_mature_balance_raises_400() -> None:
    storage = FakeStorage()
    storage.balance_repo.seed_balance(OWNER, available=200)
    storage.balance_repo.read_consumer_mature_withdrawable = (
        lambda _owner, _seconds: Decimal("50.000000")
    )
    svc = _make_service(storage)

    with pytest.raises(HTTPException) as exc_info:
        run(svc.create_consumer_withdraw_intent(
            payload={"amountUsdc": "120", "reason": ""},
            owner_wallet=OWNER,
            idempotency_key=IDEM_KEY,
        ))

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "INSUFFICIENT_MATURE_CONSUMER_BALANCE"
    assert storage.gateway_state.refund_rows == []
    ledger = storage.balance_repo.read_balance_ledger()
    assert ledger.consumer_available_balance(OWNER) == Decimal("200.000000")


def test_consumer_mature_balance_allows_fifo_aggregate_partial_withdrawal() -> None:
    storage = FakeStorage()
    storage.balance_repo.seed_balance(OWNER, available=150)
    storage.balance_repo.read_consumer_mature_withdrawable = (
        lambda _owner, _seconds: Decimal("50.000000")
    )
    svc = _make_service(storage)

    result = run(svc.create_consumer_withdraw_intent(
        payload={"amountUsdc": "50", "reason": ""},
        owner_wallet=OWNER,
        idempotency_key=IDEM_KEY,
    ))

    assert result["status"] == "REQUESTED"
    ledger = storage.balance_repo.read_balance_ledger()
    assert ledger.consumer_available_balance(OWNER) == Decimal("100.000000")
    assert ledger.consumer_pending_balance(OWNER) == Decimal("50.000000")


def test_consumer_db_sliding_window_stats_drive_manual_review() -> None:
    storage = FakeStorage()
    storage.balance_repo.seed_balance(OWNER, available=100)
    storage.balance_repo.read_consumer_withdrawal_window_stats = (
        lambda _owner, _seconds: (CONSUMER_WITHDRAW_MAX_DAILY_COUNT, Decimal("80.000000"))
    )
    svc = _make_service(storage)

    result = run(svc.create_consumer_withdraw_intent(
        payload={"amountUsdc": "20", "reason": ""},
        owner_wallet=OWNER,
        idempotency_key=IDEM_KEY,
    ))

    assert result["status"] == "PENDING_MANUAL_REVIEW"
    assert result["riskReasonCode"] == "DAILY_WITHDRAW_LIMIT_EXCEEDED"
    ledger = storage.balance_repo.read_balance_ledger()
    assert ledger.consumer_frozen_balance(OWNER) == Decimal("20.000000")
