from __future__ import annotations

import asyncio
from decimal import Decimal

import pytest
from fastapi import HTTPException

from src.domain.finance import UsageLogRow
from src.services.owner.finance_service import OwnerFinanceService

from tests.unit.test_finance_runtime_service_unit import (
    DummyLockManager,
    FakeStorage,
    _configure_owner_service,
)


OWNER = "0xabc"


def _q6(value: object) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.000001"))


def _make_refund_service() -> tuple[FakeStorage, OwnerFinanceService, str]:
    storage = FakeStorage()
    storage.balance.ledger.ensure_consumer_wallet(OWNER).available_balance = Decimal("100.000000")
    storage.gateway_state.usage_rows = [
        UsageLogRow(
            id="usage-refund-1",
            ts=1710000000,
            consumerAddress=OWNER,
            status="succeeded",
            originRequestId="manual-origin-1",
            originTxHash="",
            totalCharge="30.0",
        )
    ]
    service = OwnerFinanceService(storage, DummyLockManager())
    _configure_owner_service(service)
    service._release_consumer_pending_to_available = (  # type: ignore[method-assign]
        lambda owner, amount_usdc: (
            setattr(
                wallet := storage.balance.ledger.ensure_consumer_wallet(owner),
                "pending_balance",
                _q6(_q6(wallet.pending_balance or 0) - _q6(amount_usdc)),
            ),
            setattr(
                wallet,
                "available_balance",
                _q6(_q6(wallet.available_balance or 0) + _q6(amount_usdc)),
            ),
        )
    )
    service._release_consumer_frozen_to_available = (  # type: ignore[method-assign]
        lambda owner, amount_usdc: (
            setattr(
                wallet := storage.balance.ledger.ensure_consumer_wallet(owner),
                "frozen_balance",
                _q6(_q6(wallet.frozen_balance or 0) - _q6(amount_usdc)),
            ),
            setattr(
                wallet,
                "available_balance",
                _q6(_q6(wallet.available_balance or 0) + _q6(amount_usdc)),
            ),
        )
    )
    created = asyncio.run(
        service.process_refund_intent(
            {
                "amountUsdc": 20,
                "originRequestId": "manual-origin-1",
                "originTxHash": "0x" + "1" * 64,
                "refundType": "SYSTEM_FAILURE",
            },
            OWNER,
            "refund-money-safety-key-1",
        )
    )
    return storage, service, created["refundId"]


def test_refund_complete_same_tx_is_idempotent_and_balance_stable() -> None:
    storage, service, refund_id = _make_refund_service()
    before_complete_available = storage.balance.ledger.consumer_available_balance(OWNER)
    before_complete_pending = storage.balance.ledger.consumer_pending_balance(OWNER)

    first = asyncio.run(
        service.complete_refund_intent(OWNER, refund_id, "0x" + "2" * 64)
    )
    second = asyncio.run(
        service.complete_refund_intent(OWNER, refund_id, "0x" + "2" * 64)
    )

    after_complete_available = storage.balance.ledger.consumer_available_balance(OWNER)
    after_complete_pending = storage.balance.ledger.consumer_pending_balance(OWNER)

    assert first == second
    assert first["status"] == "COMPLETED"
    assert after_complete_available == before_complete_available
    assert after_complete_pending == before_complete_pending - Decimal("20.000000")
    assert len(
        [row for row in storage.audit.rows if row.action == "REFUND_INTENT_COMPLETED"]
    ) == 1


def test_refund_complete_with_different_tx_after_completion_rejects() -> None:
    _, service, refund_id = _make_refund_service()

    asyncio.run(service.complete_refund_intent(OWNER, refund_id, "0x" + "2" * 64))

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            service.complete_refund_intent(OWNER, refund_id, "0x" + "3" * 64)
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "REFUND_ALREADY_COMPLETED"


def test_refund_fail_cannot_override_completed_refund() -> None:
    storage, service, refund_id = _make_refund_service()

    asyncio.run(service.complete_refund_intent(OWNER, refund_id, "0x" + "2" * 64))
    available_after_complete = storage.balance.ledger.consumer_available_balance(OWNER)
    pending_after_complete = storage.balance.ledger.consumer_pending_balance(OWNER)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            service.fail_refund_intent(
                OWNER,
                refund_id,
                reason_code="CALLBACK_REPLAY",
                tx_hash="0x" + "2" * 64,
            )
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "REFUND_ALREADY_COMPLETED"
    assert storage.balance.ledger.consumer_available_balance(OWNER) == available_after_complete
    assert storage.balance.ledger.consumer_pending_balance(OWNER) == pending_after_complete


def test_refund_fail_is_stable_after_terminal_failure() -> None:
    storage, service, refund_id = _make_refund_service()

    first = asyncio.run(
        service.fail_refund_intent(
            OWNER,
            refund_id,
            reason_code="WALLET_REJECTED",
            tx_hash="0x" + "4" * 64,
        )
    )
    second = asyncio.run(
        service.fail_refund_intent(
            OWNER,
            refund_id,
            reason_code="WALLET_REJECTED",
            tx_hash="0x" + "4" * 64,
        )
    )

    assert first == second
    assert first["status"] == "FAILED"
    assert storage.balance.ledger.consumer_available_balance(OWNER) == Decimal("100.000000")
    assert storage.balance.ledger.consumer_pending_balance(OWNER) == Decimal("0.000000")
