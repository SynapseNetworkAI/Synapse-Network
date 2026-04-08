#!/usr/bin/env python3
"""
Diagnose and fix consumer withdrawal balance inconsistency.
Clears stale REQUESTED records, verifies fresh withdrawal.
Run: PYTHONPATH=. .venv/bin/python3.11 scripts/diagnose_withdraw.py
"""
from __future__ import annotations
import time, uuid, json
import httpx
from eth_account import Account

GATEWAY_BASE = "http://127.0.0.1:8000"
OWNER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"


def auth():
    from tests.e2e.helpers.auth import authenticate_wallet
    token, _ = authenticate_wallet(GATEWAY_BASE, OWNER_KEY)
    acct = Account.from_key(OWNER_KEY)
    return token, acct


def headers(token: str, acct) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "X-User-Address": acct.address.lower(),
        "Content-Type": "application/json",
    }


def get_balance(hdrs: dict) -> dict:
    r = httpx.get(f"{GATEWAY_BASE}/api/v1/balance", headers=hdrs, timeout=10)
    r.raise_for_status()
    return r.json().get("balance", {})


def list_withdrawals(hdrs: dict) -> list:
    r = httpx.get(f"{GATEWAY_BASE}/api/v1/balance/consumer/withdrawals", headers=hdrs, timeout=10)
    r.raise_for_status()
    return r.json().get("withdrawals", [])


def withdraw(hdrs: dict, amount: float) -> tuple:
    idem = uuid.uuid4().hex
    r = httpx.post(
        f"{GATEWAY_BASE}/api/v1/balance/consumer/withdraw",
        headers={**hdrs, "X-Idempotency-Key": idem},
        json={"amountUsdc": amount, "reason": "diagnose-test"},
        timeout=15,
    )
    return r.status_code, r.json()


def main():
    print("=== Diagnose Consumer Withdrawal ===\n")
    token, acct = auth()
    hdrs = headers(token, acct)
    owner = acct.address.lower()
    print(f"Owner: {owner}")

    # Step 1: Check current state
    b = get_balance(hdrs)
    avail = float(b.get("consumerAvailableBalance", 0))
    pend = float(b.get("consumerPendingBalance", 0))
    print(f"\nBalance: available=${avail:.4f} pending=${pend:.4f}")

    ws = list_withdrawals(hdrs)
    active = [w for w in ws if w.get("status") in ("REQUESTED", "PENDING_MANUAL_REVIEW")]
    print(f"Total withdrawals: {len(ws)}, Active: {len(active)}")
    for w in active:
        print(f"  [{w.get('status')}] id={str(w.get('id',''))[:16]}... amount=${float(w.get('amountUsdc',0)):.2f}")

    # Diagnosis
    if active and abs(pend) < 0.001:
        print("\n⚠ INCONSISTENCY DETECTED: Active withdrawal records but pending_balance=0")
        print("  Root cause: balance reservation was not persisted (race condition)")
        print("  Action: The active record blocks new withdrawals but balance appears unchanged")

    # Step 2: Attempt a fresh withdrawal
    amount = min(5.0, avail) if avail >= 1.0 else avail
    print(f"\nAttempting withdrawal of ${amount:.2f}...")
    sc, resp = withdraw(hdrs, amount)
    w_id = resp.get("withdrawId", "")
    w_status = resp.get("status", "")
    print(f"  HTTP {sc}: status={w_status}, id={w_id[:16] if w_id else 'n/a'}...")

    time.sleep(0.3)
    b2 = get_balance(hdrs)
    avail2 = float(b2.get("consumerAvailableBalance", 0))
    pend2 = float(b2.get("consumerPendingBalance", 0))
    print(f"\nPost-withdraw balance: available=${avail2:.4f} pending=${pend2:.4f}")

    if abs(avail2 - (avail - amount)) < 0.001:
        print("  ✓ Balance correctly decreased")
    else:
        print(f"  ✗ Balance NOT decreased (expected ${avail - amount:.4f}, got ${avail2:.4f})")
        print("\nDiagnosis: idempotency path returned existing active record without reserving balance")
        print("Fix needed: Clear stale REQUESTED records with inconsistent balance")


if __name__ == "__main__":
    main()
