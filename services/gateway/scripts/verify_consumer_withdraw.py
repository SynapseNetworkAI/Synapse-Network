#!/usr/bin/env python3
"""
Consumer withdrawal verification script.
Run from services/gateway/:
  PYTHONPATH=. .venv/bin/python3.11 scripts/verify_consumer_withdraw.py
"""
from __future__ import annotations
import json, time, uuid
from pathlib import Path

import httpx
from eth_account import Account

GATEWAY_BASE = "http://127.0.0.1:8000"
OWNER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
SCREENSHOTS_DIR = Path(__file__).parents[3] / "docs" / "screenshots"
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

WITHDRAW_AMOUNT = 5.0  # $5 USDC (small enough to leave balance for other tests)


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


def balance_full(hdrs: dict) -> dict:
    r = httpx.get(f"{GATEWAY_BASE}/api/v1/balance", headers=hdrs, timeout=10)
    r.raise_for_status()
    return r.json().get("balance", {})


def withdraw(hdrs: dict, amount_usdc: float, reason: str = "verification") -> tuple[int, dict]:
    idem = uuid.uuid4().hex
    r = httpx.post(
        f"{GATEWAY_BASE}/api/v1/balance/consumer/withdraw",
        headers={**hdrs, "X-Idempotency-Key": idem},
        json={"amountUsdc": amount_usdc, "reason": reason},
        timeout=15,
    )
    return r.status_code, r.json()


def list_withdrawals(hdrs: dict) -> list[dict]:
    r = httpx.get(f"{GATEWAY_BASE}/api/v1/balance/consumer/withdrawals", headers=hdrs, timeout=10)
    r.raise_for_status()
    return r.json().get("withdrawals", [])


def main() -> None:
    print("=== Consumer Withdrawal Verification ===\n")
    print("Authenticating…")
    token, acct = auth()
    hdrs = headers(token, acct)
    owner = acct.address.lower()

    # ── Step 1: Before balance ────────────────────────────────────────────────
    print("Step 1: Balance BEFORE withdrawal")
    b_before = balance_full(hdrs)
    avail_before = float(b_before.get("consumerAvailableBalance", 0))
    pend_before  = float(b_before.get("consumerPendingBalance", 0))
    rows_before = list_withdrawals(hdrs)
    active_before = [
        row for row in rows_before
        if str(row.get("status") or "").upper() in {"REQUESTED", "PENDING_MANUAL_REVIEW"}
    ]
    print(f"  consumer_available_balance : ${avail_before:.6f}")
    print(f"  consumer_pending_balance   : ${pend_before:.6f}")
    print(f"  active_withdrawals         : {len(active_before)}")

    if avail_before < WITHDRAW_AMOUNT:
        print(f"\n  ⚠ available ({avail_before}) < withdraw amount ({WITHDRAW_AMOUNT}). Using max available.")
        actual_amount = round(avail_before * 0.5, 2) if avail_before > 1 else avail_before
    else:
        actual_amount = WITHDRAW_AMOUNT

    # ── Step 2: Withdraw ─────────────────────────────────────────────────────
    print(f"\nStep 2: POST /api/v1/balance/consumer/withdraw  (${actual_amount:.2f} USDC)")
    sc, resp = withdraw(hdrs, actual_amount, "verification-script")
    withdraw_status = resp.get("status", "unknown")
    withdraw_id = resp.get("withdrawId", "n/a")
    print(f"  HTTP {sc} → status={withdraw_status}, withdrawId={withdraw_id}")

    assert sc == 200, f"Withdraw failed: {resp}"

    # ── Step 3: After balance ─────────────────────────────────────────────────
    time.sleep(0.5)
    print("\nStep 3: Balance AFTER withdrawal")
    b_after = balance_full(hdrs)
    avail_after = float(b_after.get("consumerAvailableBalance", 0))
    pend_after  = float(b_after.get("consumerPendingBalance", 0))
    froz_after  = float(b_after.get("consumerFrozenBalance", 0))
    print(f"  consumer_available_balance : ${avail_after:.6f}  (delta: {avail_after - avail_before:+.6f})")
    print(f"  consumer_pending_balance   : ${pend_after:.6f}  (delta: {pend_after - pend_before:+.6f})")
    print(f"  consumer_frozen_balance    : ${froz_after:.6f}")

    # ── Step 4: Verify ────────────────────────────────────────────────────────
    print("\nStep 4: Assertions")
    if active_before:
        balance_ok = abs(avail_after - avail_before) < 0.001 and abs(pend_after - pend_before) < 0.001
        print(
            f"  active request returned without double deduction: {'PASS ✓' if balance_ok else 'FAIL ✗'}"
        )
        assert balance_ok, (
            "Active withdrawal should return existing record without changing balances again. "
            f"before=({avail_before:.6f},{pend_before:.6f}) after=({avail_after:.6f},{pend_after:.6f})"
        )
    else:
        balance_ok = abs(avail_after - (avail_before - actual_amount)) < 0.001
        pending_ok = abs(pend_after - (pend_before + actual_amount)) < 0.001
        print(f"  available decreased by ${actual_amount:.2f}: {'PASS ✓' if balance_ok else 'FAIL ✗'}")
        print(f"  pending increased by ${actual_amount:.2f}: {'PASS ✓' if pending_ok else 'FAIL ✗'}")
        assert balance_ok, f"Balance error: expected {avail_before - actual_amount:.6f}, got {avail_after:.6f}"
        assert pending_ok, f"Pending error: expected {pend_before + actual_amount:.6f}, got {pend_after:.6f}"

    # ── Step 5: Listing ───────────────────────────────────────────────────────
    print("\nStep 5: GET /api/v1/balance/consumer/withdrawals")
    rows = list_withdrawals(hdrs)
    found = next(
        (r for r in rows if (r.get("id") or r.get("withdrawId")) == withdraw_id), None
    )
    record_ok = found is not None
    print(f"  Total records in listing   : {len(rows)}")
    print(f"  Our record ({withdraw_id[:16]}…) found: {'PASS ✓' if record_ok else 'FAIL ✗'}")
    assert record_ok, f"Withdrawal {withdraw_id} not found in listing."

    # ── Save HTML report ──────────────────────────────────────────────────────
    ts = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())
    report = SCREENSHOTS_DIR / "withdraw_verification_report.html"
    _write_html_report(
        report, ts, owner,
        avail_before, pend_before,
        actual_amount, withdraw_status, withdraw_id, resp,
        avail_after, pend_after, froz_after, b_after,
        balance_ok, record_ok, found,
    )
    print(f"\n✓ Report saved: {report}")
    print(f"\n{'='*40}")
    print(f"SUMMARY  balance_before=${avail_before:.4f}  withdrawn=${actual_amount:.2f}  balance_after=${avail_after:.4f}")
    print(f"All checks PASSED ✓")


def _write_html_report(path, ts, owner, avail_before, pend_before,
                       amount, status, withdraw_id, resp,
                       avail_after, pend_after, froz_after, b_after,
                       balance_ok, record_ok, found_record):
    badge = lambda ok: ('<span style="background:#0f3a25;color:#35d07f;padding:2px 8px;border-radius:4px;font-size:12px">PASS ✓</span>'
                        if ok else
                        '<span style="background:#3a1010;color:#ff6b6b;padding:2px 8px;border-radius:4px;font-size:12px">FAIL ✗</span>')
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Consumer Withdrawal Verification — {ts}</title>
<style>
body{{background:#111;color:#e2e8f0;font-family:system-ui,sans-serif;padding:40px;max-width:960px}}
h1{{color:#35d07f;font-size:22px;margin-bottom:4px}}
h2{{color:#9ca3af;font-size:14px;margin-top:28px;border-bottom:1px solid #2a2a2a;padding-bottom:6px}}
table{{border-collapse:collapse;width:100%;margin-top:10px}}
th{{background:#1a1a1a;color:#9ca3af;text-align:left;padding:7px 12px;font-size:12px}}
td{{padding:7px 12px;border-bottom:1px solid #1f1f1f;font-size:13px}}
.mono{{font-family:monospace;font-size:11px;color:#86868b}}
.w{{color:#fff;font-weight:600}}
.red{{color:#ff6b6b}}.grn{{color:#35d07f}}.org{{color:#f97316}}
pre{{background:#0a0a0a;border:1px solid #222;padding:12px;border-radius:8px;font-size:11px;overflow-x:auto;white-space:pre-wrap}}
</style>
</head>
<body>
<h1>Consumer Withdrawal Verification</h1>
<p class="mono">Time: {ts} | Owner: {owner}</p>

<h2>Before Withdrawal</h2>
<table>
<tr><th>Field</th><th>Amount</th></tr>
<tr><td>consumer_available_balance</td><td class="w">${avail_before:.6f} USDC</td></tr>
<tr><td>consumer_pending_balance</td><td>${pend_before:.6f} USDC</td></tr>
</table>

<h2>Withdrawal Request</h2>
<table>
<tr><th>Field</th><th>Value</th></tr>
<tr><td>amountUsdc</td><td class="w org">${amount:.2f} USDC</td></tr>
<tr><td>status</td><td class="w">{status}</td></tr>
<tr><td>withdrawId</td><td class="mono">{withdraw_id}</td></tr>
</table>

<h2>After Withdrawal</h2>
<table>
<tr><th>Field</th><th>Amount</th><th>Delta</th></tr>
<tr>
  <td>consumer_available_balance</td><td class="w">${avail_after:.6f} USDC</td>
  <td class="{'org' if avail_after < avail_before else 'grn'}">{avail_after - avail_before:+.6f}</td>
</tr>
<tr>
  <td>consumer_pending_balance</td><td>${pend_after:.6f} USDC</td>
  <td class="grn">{pend_after - pend_before:+.6f}</td>
</tr>
<tr><td>consumer_frozen_balance</td><td>${froz_after:.6f} USDC</td><td>—</td></tr>
</table>

<h2>Verification Checks</h2>
<table>
<tr><th>Check</th><th>Result</th></tr>
<tr><td>available_balance decreased by ${amount:.2f} USDC</td><td>{badge(balance_ok)}</td></tr>
<tr><td>pending_balance increased by ${amount:.2f} USDC (funds frozen)</td>
  <td>{badge(abs(pend_after - pend_before - amount) < 0.001)}</td></tr>
<tr><td>Withdrawal record appears in /api/v1/balance/consumer/withdrawals</td><td>{badge(record_ok)}</td></tr>
</table>

<h2>Withdrawal API Response</h2>
<pre>{json.dumps(resp, indent=2)}</pre>

<h2>Balance After (Full)</h2>
<pre>{json.dumps(b_after, indent=2)}</pre>

<h2>Withdrawal Record in Listing</h2>
<pre>{json.dumps(found_record, indent=2, default=str) if found_record else '"not found"'}</pre>
</body></html>"""
    path.write_text(html, encoding="utf-8")


if __name__ == "__main__":
    main()
