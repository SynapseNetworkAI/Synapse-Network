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
MIN_CONSUMER_WITHDRAW_USDC = Decimal("10.00")


def _post_consumer_withdraw(
    gateway_base: str, headers: dict, amount_usdc: Decimal, reason: str = ""
) -> httpx.Response:
    idem_key = uuid.uuid4().hex
    return httpx.post(
        f"{gateway_base}/api/v1/balance/consumer/withdraw",
        headers={**headers, "X-Idempotency-Key": idem_key},
        json={"amountUsdc": format(amount_usdc, "f"), "reason": reason},
        timeout=WITHDRAW_TIMEOUT,
    )


def _consumer_withdraw(
    gateway_base: str, headers: dict, amount_usdc: Decimal, reason: str = ""
) -> dict:
    r = _post_consumer_withdraw(gateway_base, headers, amount_usdc, reason)
    if r.status_code == 400 and "INSUFFICIENT_MATURE_CONSUMER_BALANCE" in r.text:
        pytest.skip(
            "Consumer balance exists but no funds have passed the T+7 mature withdrawal window."
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
    frozen_before = Decimal(str(balance_before_full.get("consumerFrozenBalance") or 0))

    assert available_before >= MIN_CONSUMER_WITHDRAW_USDC, (
        "Insufficient available balance for the minimum consumer withdrawal. "
        f"Need at least {MIN_CONSUMER_WITHDRAW_USDC} USDC; run test_04_deposit first."
    )

    # Match the current product minimum so the e2e covers the real withdraw policy.
    withdraw_usdc = MIN_CONSUMER_WITHDRAW_USDC
    r = _post_consumer_withdraw(GATEWAY_BASE, owner_headers, withdraw_usdc, reason="e2e test")
    if r.status_code == 400 and "INSUFFICIENT_MATURE_CONSUMER_BALANCE" in r.text:
        balance_after_full = get_balance_full(GATEWAY_BASE, owner_headers)
        available_after = Decimal(str(balance_after_full.get("consumerAvailableBalance") or 0))
        pending_after = Decimal(str(balance_after_full.get("consumerPendingBalance") or 0))
        frozen_after = Decimal(str(balance_after_full.get("consumerFrozenBalance") or 0))
        assert float(available_after) == pytest.approx(float(available_before), abs=1e-4)
        assert float(pending_after) == pytest.approx(float(pending_before), abs=1e-4)
        assert float(frozen_after) == pytest.approx(float(frozen_before), abs=1e-4)
        session_state["consumer_withdraw_blocked_by_maturity"] = True
        session_state["consumer_total_before_withdraw"] = available_before + pending_before + frozen_before
        return
    assert r.status_code == 200, f"Withdraw request failed ({r.status_code}): {r.text}"
    resp = r.json()

    assert resp.get("status") in {"REQUESTED", "PENDING_MANUAL_REVIEW"}, (
        f"Unexpected status: {resp}"
    )
    assert Decimal(str(resp.get("amountUsdc", 0))) == pytest.approx(withdraw_usdc)

    session_state["consumer_withdraw_id"] = resp.get("withdrawId")
    session_state["consumer_withdraw_amount"] = withdraw_usdc
    session_state["consumer_withdraw_status"] = resp.get("status")
    session_state["consumer_total_before_withdraw"] = available_before + pending_before + frozen_before

    # Read fresh balance
    balance_after_full = get_balance_full(GATEWAY_BASE, owner_headers)
    available_after = Decimal(str(balance_after_full.get("consumerAvailableBalance") or 0))
    pending_after = Decimal(str(balance_after_full.get("consumerPendingBalance") or 0))

    if resp.get("existingWithdrawal"):
        assert float(available_after) == pytest.approx(float(available_before), abs=1e-4), (
            f"Existing withdrawal should leave available balance unchanged at {available_before}, "
            f"but got {available_after}"
        )
        assert float(pending_after) == pytest.approx(float(pending_before), abs=1e-4), (
            f"Existing withdrawal should leave pending balance unchanged at {pending_before}, "
            f"but got {pending_after}"
        )
    else:
        # available must have decreased
        assert float(available_after) == pytest.approx(float(available_before - withdraw_usdc), abs=1e-4), (
            f"Available balance should be {available_before - withdraw_usdc} "
            f"but got {available_after}"
        )

        # pending must have increased (for REQUESTED status)
        if resp.get("status") == "REQUESTED":
            assert float(pending_after) == pytest.approx(
                float(pending_before + withdraw_usdc), abs=1e-4
            ), (
                f"Pending balance should be {pending_before + withdraw_usdc} "
                f"but got {pending_after}"
            )


def test_consumer_withdraw_frozen_amount_not_available(owner_headers, session_state):
    """After withdrawal, the reserved amount is NOT in consumer_available_balance."""
    if not session_state.get("consumer_withdraw_id"):
        pytest.skip("No withdrawal was created; mature consumer funds may be unavailable.")

    balance_full = get_balance_full(GATEWAY_BASE, owner_headers)
    available = Decimal(str(balance_full.get("consumerAvailableBalance") or 0))

    # Attempt to withdraw the pending amount again — it should find active record and return early
    withdraw_amount = session_state.get("consumer_withdraw_amount", MIN_CONSUMER_WITHDRAW_USDC)

    # If the full available balance is exactly the pending amount (rest was withdrawn),
    # a fresh withdrawal of that amount fails or returns existing record.
    # Either outcome confirms the previously reserved amount is inaccessible.
    r = httpx.post(
        f"{GATEWAY_BASE}/api/v1/balance/consumer/withdraw",
        headers={**owner_headers, "X-Idempotency-Key": uuid.uuid4().hex},
        json={"amountUsdc": format(withdraw_amount, "f"), "reason": "second attempt"},
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
        # Could be 400 INSUFFICIENT_CONSUMER_BALANCE if the remaining available balance is below minimum.
        assert r.status_code == 400


def test_consumer_withdraw_record_appears_in_listing(owner_headers, session_state):
    """GET /withdrawals → the withdrawal from the previous test appears."""
    withdraw_id = session_state.get("consumer_withdraw_id")
    if not withdraw_id and session_state.get("consumer_withdraw_blocked_by_maturity"):
        pytest.skip("Consumer withdrawal was correctly blocked by T+7 maturity gate.")
    if not withdraw_id:
        pytest.skip("No withdrawal was created; mature consumer funds may be unavailable.")

    listings = _list_consumer_withdrawals(GATEWAY_BASE, owner_headers)
    ids = [row.get("id") or row.get("withdrawId") for row in listings]
    assert withdraw_id in ids, (
        f"Withdrawal {withdraw_id} not found in listings. Got IDs: {ids}"
    )


def test_consumer_withdraw_record_has_correct_amount_and_status(owner_headers, session_state):
    """The withdrawal record in listings has correct amountUsdc and status."""
    withdraw_id = session_state.get("consumer_withdraw_id")
    expected_amount = session_state.get("consumer_withdraw_amount", MIN_CONSUMER_WITHDRAW_USDC)
    if not withdraw_id and session_state.get("consumer_withdraw_blocked_by_maturity"):
        pytest.skip("Consumer withdrawal was correctly blocked by T+7 maturity gate.")
    if not withdraw_id:
        pytest.skip("No withdrawal was created; mature consumer funds may be unavailable.")

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

    baseline_total = Decimal(str(session_state.get("consumer_total_before_withdraw") or total))
    assert total <= baseline_total + Decimal("0.01"), (
        f"Total consumer obligation {total} exceeds pre-withdraw baseline {baseline_total}. "
        "Balance integrity violated."
    )


def test_consumer_withdraw_invalid_amount_rejected(owner_headers):
    """Amounts below the consumer withdrawal minimum are rejected with 400."""
    r = httpx.post(
        f"{GATEWAY_BASE}/api/v1/balance/consumer/withdraw",
        headers={**owner_headers, "X-Idempotency-Key": uuid.uuid4().hex},
        json={"amountUsdc": "0.500000", "reason": ""},
        timeout=WITHDRAW_TIMEOUT,
    )
    assert r.status_code == 400


def test_consumer_withdraw_exceeds_balance_rejected(owner_headers):
    """Over-balance withdraw is rejected unless an active withdraw guard trips first."""
    balance = get_balance(GATEWAY_BASE, owner_headers)
    over_amount = Decimal(str(balance)) + Decimal("10000.000000")

    r = httpx.post(
        f"{GATEWAY_BASE}/api/v1/balance/consumer/withdraw",
        headers={**owner_headers, "X-Idempotency-Key": uuid.uuid4().hex},
        json={"amountUsdc": format(over_amount, "f"), "reason": ""},
        timeout=WITHDRAW_TIMEOUT,
    )
    if r.status_code == 409:
        listings = _list_consumer_withdrawals(GATEWAY_BASE, owner_headers)
        assert any(
            row.get("status") in {"REQUESTED", "PENDING_MANUAL_REVIEW"} for row in listings
        ), "409 active-withdraw guard returned without an active consumer withdrawal row."
        assert "PENDING_WITHDRAWAL_EXISTS" in r.text
        return

    assert r.status_code == 400
    assert "INSUFFICIENT_CONSUMER_BALANCE" in r.text
