"""Focused consumer withdrawal active-record guard tests."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from tests.unit.test_consumer_withdraw_unit import (
    IDEM_KEY,
    OWNER,
    FakeStorage,
    _make_service,
    run,
)


def test_active_withdrawal_blocks_different_amount():
    storage = FakeStorage()
    storage.balance_repo.seed_balance(OWNER, available=100.0)
    svc = _make_service(storage)

    run(
        svc.create_consumer_withdraw_intent(
            payload={"amountUsdc": 20.0, "reason": ""},
            owner_wallet=OWNER,
            idempotency_key=IDEM_KEY,
        )
    )

    with pytest.raises(HTTPException) as exc_info:
        run(
            svc.create_consumer_withdraw_intent(
                payload={"amountUsdc": 30.0, "reason": ""},
                owner_wallet=OWNER,
                idempotency_key="d" * 20,
            )
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "PENDING_WITHDRAWAL_EXISTS"


def test_requested_consumer_withdrawal_listing_is_claimable():
    storage = FakeStorage()
    storage.balance_repo.seed_balance(OWNER, available=20.0)
    svc = _make_service(storage)

    run(
        svc.create_consumer_withdraw_intent(
            payload={"amountUsdc": 20.0, "reason": ""},
            owner_wallet=OWNER,
            idempotency_key=IDEM_KEY,
        )
    )

    listings = run(svc.list_consumer_withdrawals(owner_wallet=OWNER))

    assert len(listings) == 1
    assert listings[0]["status"] == "REQUESTED"
    assert listings[0]["claimable"] is True
