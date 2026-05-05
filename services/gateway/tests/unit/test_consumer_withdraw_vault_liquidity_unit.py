from decimal import Decimal

import pytest
from fastapi import HTTPException

from src.domain.operation_metadata import WithdrawalTicketMetadata

from test_consumer_withdraw_unit import (
    IDEM_KEY,
    OWNER,
    REVIEWER,
    FakeStorage,
    _fake_withdraw_ticket,
    _make_service,
    money,
    run,
)


def test_vault_liquidity_shortage_blocks_before_locking_or_ticket() -> None:
    storage = FakeStorage()
    storage.balance_repo.seed_balance(OWNER, available=185.99)
    svc = _make_service(storage)
    ticket_called = False

    def _raise_liquidity_shortage(amount_usdc):
        assert money(amount_usdc) == Decimal("185.990000")
        raise RuntimeError("INSUFFICIENT_VAULT_LIQUIDITY")

    def _build_ticket(**kwargs):
        nonlocal ticket_called
        ticket_called = True
        return _fake_withdraw_ticket(withdrawal_id=kwargs["withdrawal_id"])

    svc._assert_withdraw_vault_liquidity = _raise_liquidity_shortage
    svc._build_consumer_withdraw_ticket = _build_ticket

    with pytest.raises(HTTPException) as exc_info:
        run(
            svc.create_consumer_withdraw_intent(
                payload={"amountUsdc": 185.99, "reason": ""},
                owner_wallet=OWNER,
                idempotency_key=IDEM_KEY,
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "VAULT_LIQUIDITY_INSUFFICIENT"
    assert ticket_called is False
    assert storage.gateway_state.refund_rows == []
    ledger = storage.balance_repo.read_balance_ledger()
    assert ledger.consumer_available_balance(OWNER) == Decimal("185.990000")
    assert ledger.consumer_pending_balance(OWNER) == Decimal("0.000000")
    assert ledger.consumer_frozen_balance(OWNER) == Decimal("0.000000")


def test_vault_liquidity_unavailable_blocks_without_locking() -> None:
    storage = FakeStorage()
    storage.balance_repo.seed_balance(OWNER, available=20.0)
    svc = _make_service(storage)

    def _raise_check_unavailable(_amount_usdc):
        raise RuntimeError("WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE")

    svc._assert_withdraw_vault_liquidity = _raise_check_unavailable

    with pytest.raises(HTTPException) as exc_info:
        run(
            svc.create_consumer_withdraw_intent(
                payload={"amountUsdc": 20.0, "reason": ""},
                owner_wallet=OWNER,
                idempotency_key=IDEM_KEY,
            )
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["code"] == "WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE"
    assert storage.gateway_state.refund_rows == []
    ledger = storage.balance_repo.read_balance_ledger()
    assert ledger.consumer_available_balance(OWNER) == Decimal("20.000000")
    assert ledger.consumer_pending_balance(OWNER) == Decimal("0.000000")


def test_existing_requested_without_ticket_checks_vault_before_resigning() -> None:
    storage = FakeStorage()
    storage.balance_repo.seed_balance(OWNER, available=20.0)
    svc = _make_service(storage)
    created = run(
        svc.create_consumer_withdraw_intent(
            payload={"amountUsdc": 20.0, "reason": ""},
            owner_wallet=OWNER,
            idempotency_key=IDEM_KEY,
        )
    )
    row = storage.gateway_state.refund_rows[0]
    row.signature = None
    row.ticket = WithdrawalTicketMetadata()

    def _raise_liquidity_shortage(_amount_usdc):
        raise RuntimeError("INSUFFICIENT_VAULT_LIQUIDITY")

    svc._assert_withdraw_vault_liquidity = _raise_liquidity_shortage

    with pytest.raises(HTTPException) as exc_info:
        run(
            svc.create_consumer_withdraw_intent(
                payload={"amountUsdc": 20.0, "reason": ""},
                owner_wallet=OWNER,
                idempotency_key="vault-resign-blocked-key",
            )
        )

    assert exc_info.value.detail["code"] == "VAULT_LIQUIDITY_INSUFFICIENT"
    assert storage.gateway_state.refund_rows[0].id == created["withdrawId"]
    assert not storage.gateway_state.refund_rows[0].ticket.signature


def test_manual_review_approval_checks_vault_before_moving_frozen() -> None:
    storage = FakeStorage()
    storage.balance_repo.seed_balance(OWNER, available=1000.0)
    svc = _make_service(storage)
    created = run(
        svc.create_consumer_withdraw_intent(
            payload={"amountUsdc": 600.0, "reason": "large withdraw"},
            owner_wallet=OWNER,
            idempotency_key=IDEM_KEY,
        )
    )

    def _raise_liquidity_shortage(_amount_usdc):
        raise RuntimeError("INSUFFICIENT_VAULT_LIQUIDITY")

    svc._assert_withdraw_vault_liquidity = _raise_liquidity_shortage

    with pytest.raises(HTTPException) as exc_info:
        run(
            svc.review_consumer_withdrawal(
                owner_wallet=OWNER,
                refund_id=created["withdrawId"],
                request_meta={
                    "review": {
                        "decision": "APPROVE",
                        "reviewerAddress": REVIEWER,
                        "reviewerNote": "Approved after manual review",
                    }
                },
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "VAULT_LIQUIDITY_INSUFFICIENT"
    ledger = storage.balance_repo.read_balance_ledger()
    assert ledger.consumer_available_balance(OWNER) == Decimal("400.000000")
    assert ledger.consumer_frozen_balance(OWNER) == Decimal("600.000000")
    assert ledger.consumer_pending_balance(OWNER) == Decimal("0.000000")
    row = storage.gateway_state.refund_rows[0]
    assert row.status == "PENDING_MANUAL_REVIEW"
    assert row.review_decision is None
