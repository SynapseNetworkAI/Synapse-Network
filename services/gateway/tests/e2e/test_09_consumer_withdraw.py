"""E2E test: consumer balance withdrawal pipeline.

Verifies (against a live gateway at :8000):
1. Before withdrawal — record the available balance
2. POST /api/v1/balance/consumer/withdraw
   - Returns {status, amountUsdc, ...}
   - Available balance decreases by the withdrawn amount
   - Pending balance increases (or frozen for large amounts)
3. Withdrawn amount is frozen / pending — a second withdrawal of the same
   full amount is rejected or returns the existing record (not double-deducted)
4. GET /api/v1/balance/consumer/withdrawals
   - The withdrawal record appears in the listing
   - status is REQUESTED or PENDING_MANUAL_REVIEW

Pre-conditions (same as other e2e tests):
   - scripts/local/setup_local_env.sh already ran (Hardhat node + contracts)
   - scripts/local/restart_gateway.sh already ran (gateway on :8000)
   - test_04_deposit must have run first (to seed the consumer balance)

Run with:
   cd services/gateway
   PYTHONPATH=. .venv/bin/pytest tests/e2e/test_09_consumer_withdraw.py -v --tb=short
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import httpx
import pytest

from tests.e2e.conftest import GATEWAY_BASE
from tests.e2e.helpers.gateway import get_balance, get_balance_full

WITHDRAW_TIMEOUT = 20


def _consumer_withdraw(gateway_base: str, headers: dict, amount_usdc: float, reason: str = "") -> dict:
    idem_key = uuid.uuid4().hex
    r = httpx.post(
        f"{gateway_base}/api/v1/balance/consumer/withdraw",
        headers={**headers, "X-Idempotency-Key": idem_key},
        json={"amountUsdc": amount_usdc, "reason": reason},
        timeout=WITHDRAW_TIMEOUT,
    )
    assert r.status_code == 200, f"Withdraw request failed ({r.status_code}): {r.text}"
    return r.json()


def _list_consumer_withdrawals(gateway_base: str, headers: dict) -> list[dict]:
    r = httpx.get(
        f"{gateway_base}/api/v1/balance/consumer/withdrawals",
        headers=headers,
        timeout=WITHDRAW_TIMEOUT,
    )
    assert r.status_code == 200, f"List withdrawals failed ({r.status_code}): {r.text}"
    data = r.json()
    return data.get("withdrawals", [])


# ─── Tests ─────────────────────────────────────────────────────────────────────


def test_consumer_has_balance_before_withdraw(owner_headers):
    """Prerequisite: consumer must have a non-zero available balance."""
    balance = get_balance(GATEWAY_BASE, owner_headers)
    assert balance > Decimal("0"), (
        f"Consumer available balance is 0. Run test_04_deposit first. balance={balance}"
    )


def test_consumer_withdraw_decreases_available_balance(owner_headers, session_state):
    """POST withdraw → available_balance decreases by exactly the withdrawn amount."""
    balance_before_full = get_balance_full(GATEWAY_BASE, owner_headers)
    available_before = Decimal(str(balance_before_full.get("consumerAvailableBalance") or 0))
    pending_before = Decimal(str(balance_before_full.get("consumerPendingBalance") or 0))

    assert available_before > Decimal("0"), (
        "No available balance to withdraw. Run test_04_deposit first."
    )

    # Withdraw a small fixed amount (1 USDC) to avoid exhausting the whole balance
    withdraw_usdc = Decimal("1.00")
    resp = _consumer_withdraw(GATEWAY_BASE, owner_headers, float(withdraw_usdc), reason="e2e test")

    assert resp.get("status") in {"REQUESTED", "PENDING_MANUAL_REVIEW"}, (
        f"Unexpected status: {resp}"
    )
    assert Decimal(str(resp.get("amountUsdc", 0))) == pytest.approx(withdraw_usdc)

    session_state["consumer_withdraw_id"] = resp.get("withdrawId")
    session_state["consumer_withdraw_amount"] = withdraw_usdc
    session_state["consumer_withdraw_status"] = resp.get("status")

    # Read fresh balance
    balance_after_full = get_balance_full(GATEWAY_BASE, owner_headers)
    available_after = Decimal(str(balance_after_full.get("consumerAvailableBalance") or 0))
    pending_after = Decimal(str(balance_after_full.get("consumerPendingBalance") or 0))

    # available must have decreased
    assert available_after == pytest.approx(float(available_before - withdraw_usdc), abs=1e-4), (
        f"Available balance should be {available_before - withdraw_usdc} "
        f"but got {available_after}"
    )

    # pending must have increased (for REQUESTED status)
    if resp.get("status") == "REQUESTED":
        assert pending_after == pytest.approx(
            float(pending_before + withdraw_usdc), abs=1e-4
        ), (
            f"Pending balance should be {pending_before + withdraw_usdc} "
            f"but got {pending_after}"
        )


def test_consumer_withdraw_frozen_amount_not_available(owner_headers, session_state):
    """After withdrawal, the reserved amount is NOT in consumer_available_balance."""
    balance_full = get_balance_full(GATEWAY_BASE, owner_headers)
    available = Decimal(str(balance_full.get("consumerAvailableBalance") or 0))

    # Attempt to withdraw the pending amount again — it should find active record and return early
    withdraw_amount = session_state.get("consumer_withdraw_amount", Decimal("1.00"))

    # If the full available balance is exactly the pending amount (rest was withdrawn),
    # a fresh withdrawal of that amount fails or returns existing record.
    # Either outcome confirms the previously reserved amount is inaccessible.
    r = httpx.post(
        f"{GATEWAY_BASE}/api/v1/balance/consumer/withdraw",
        headers={**owner_headers, "X-Idempotency-Key": uuid.uuid4().hex},
        json={"amountUsdc": float(withdraw_amount), "reason": "second attempt"},
        timeout=WITHDRAW_TIMEOUT,
    )
    # Should either return existing active record (200) or refuse
    if r.status_code == 200:
        # Existing active record returned — same withdraw ID, balance still frozen
        second_resp = r.json()
        first_id = session_state.get("consumer_withdraw_id")
        assert second_resp.get("withdrawId") == first_id, (
            "Second withdrawal returned a different ID — double deduction possible!"
        )
    else:
        # Could be 400 INSUFFICIENT_CONSUMER_BALANCE if rest of available is < 1
        assert r.status_code == 400


def test_consumer_withdraw_record_appears_in_listing(owner_headers, session_state):
    """GET /withdrawals → the withdrawal from the previous test appears."""
    withdraw_id = session_state.get("consumer_withdraw_id")
    assert withdraw_id, "No withdraw_id from previous step — skipping."

    listings = _list_consumer_withdrawals(GATEWAY_BASE, owner_headers)
    ids = [row.get("id") or row.get("withdrawId") for row in listings]
    assert withdraw_id in ids, (
        f"Withdrawal {withdraw_id} not found in listings. Got IDs: {ids}"
    )


def test_consumer_withdraw_record_has_correct_amount_and_status(owner_headers, session_state):
    """The withdrawal record in listings has correct amountUsdc and status."""
    withdraw_id = session_state.get("consumer_withdraw_id")
    expected_amount = session_state.get("consumer_withdraw_amount", Decimal("1.00"))
    assert withdraw_id, "No withdraw_id from previous step."

    listings = _list_consumer_withdrawals(GATEWAY_BASE, owner_headers)
    found = next(
        (r for r in listings if (r.get("id") or r.get("withdrawId")) == withdraw_id),
        None,
    )
    assert found is not None, f"Withdrawal {withdraw_id} not found in listings."

    assert Decimal(str(found.get("amountUsdc", 0))) == pytest.approx(
        expected_amount, abs=Decimal("0.001")
    )
    assert found.get("status") in {"REQUESTED", "PENDING_MANUAL_REVIEW"}, (
        f"Unexpected status: {found.get('status')}"
    )


def test_consumer_withdraw_reduces_total_spendable_capacity(owner_headers, session_state):
    """Consumer cannot overspend: total obligation = available + pending <= original deposit."""
    balance_full = get_balance_full(GATEWAY_BASE, owner_headers)
    available = Decimal(str(balance_full.get("consumerAvailableBalance") or 0))
    pending = Decimal(str(balance_full.get("consumerPendingBalance") or 0))
    frozen = Decimal(str(balance_full.get("consumerFrozenBalance") or 0))

    total = available + pending + frozen

    # If the system started with 10 USDC deposited, total cannot exceed that
    # (may be slightly less due to fees, but never more)
    from tests.e2e.conftest import DEPOSIT_USDC
    assert total <= DEPOSIT_USDC + Decimal("0.01"), (
        f"Total consumer obligation {total} exceeds deposit {DEPOSIT_USDC}. "
        "Balance integrity violated."
    )


def test_consumer_withdraw_invalid_amount_rejected(owner_headers):
    """Amounts below minimum (1 USDC) or zero are rejected with 400."""
    r = httpx.post(
        f"{GATEWAY_BASE}/api/v1/balance/consumer/withdraw",
        headers={**owner_headers, "X-Idempotency-Key": uuid.uuid4().hex},
        json={"amountUsdc": 0.0, "reason": ""},
        timeout=WITHDRAW_TIMEOUT,
    )
    assert r.status_code == 400


def test_consumer_withdraw_exceeds_balance_rejected(owner_headers):
    """Requesting more than available balance → 400 INSUFFICIENT_CONSUMER_BALANCE."""
    balance = get_balance(GATEWAY_BASE, owner_headers)
    over_amount = float(balance) + 10000.0

    r = httpx.post(
        f"{GATEWAY_BASE}/api/v1/balance/consumer/withdraw",
        headers={**owner_headers, "X-Idempotency-Key": uuid.uuid4().hex},
        json={"amountUsdc": over_amount, "reason": ""},
        timeout=WITHDRAW_TIMEOUT,
    )
    assert r.status_code == 400
    assert "INSUFFICIENT_CONSUMER_BALANCE" in r.text
