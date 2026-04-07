# BUG-DEPOSIT-01 — Deposit Intent Status Shows FAILED Despite Balance Being Credited

**Severity:** High  
**Component:** `services/gateway` — deposit indexer  
**Reported:** 2026-04-07  
**Status:** Fixed

---

## Summary

When a user registers a deposit intent after performing an on-chain `SynapseCore.deposit()`, the
intent status stays `FAILED` in the `/v1/balance/deposit/sync` endpoint response, even though the
balance is correctly credited to the user's account.

---

## Symptoms

```json
{
  "sync": {
    "status": "FAILED",
    "confirmed": false,
    "creditedAmountUsdc": 0.0,
    "eventKey": null,
    "confirmations": 0
  }
}
```

Consumer balance: increases correctly (+5.0 USDC) despite the FAILED status.

---

## Root Cause

In `services/gateway/src/services/platform/tasks/deposit_indexer/chain.py`,
`_extract_router_event_rows()` extracts the depositor address from decoded ABI event args:

```python
# Before fix (line ~85)
str(args.get(_legacy_deposit_sender_key()) or args.get("from") or "")
```

`_legacy_deposit_sender_key()` returns `"buyer"`, but the `DepositInfo(address user, uint256 amount)`
event emitted by SynapseCore uses `"user"` as the field name for the depositor. Neither `"buyer"`
nor `"from"` exists in the decoded args → `owner_wallet` is an empty string →
`_make_event_row()` returns `None` → `_decode_router_deposit_events()` finds zero events.

The fallback `_decode_erc20_transfer_to_router()` creates a recovery intent and credits the balance
via the backfill block scanner, but the user-registered intent created via `/v1/balance/deposit/intent`
is never updated to `CONFIRMED` — it remains `FAILED`.

---

## Impact

- Users who call `/v1/balance/deposit/sync` to poll for confirmation see `FAILED` indefinitely.
- Automated scripts treating `FAILED` as a terminal state may re-submit deposits, causing double
  credits.
- The balance is still credited correctly, so no fund loss occurs, but UX is broken.

---

## Fix

`services/gateway/src/services/platform/tasks/deposit_indexer/chain.py` —
`_extract_router_event_rows`: add `"user"` as an additional lookup key:

```python
# After fix
sender = (
    args.get(_legacy_deposit_sender_key())
    or args.get("user")       # DepositInfo(address user, uint256 amount)
    or args.get("from")
    or ""
)
```

This allows the standard ABI-decoded path to correctly resolve the `DepositInfo` event owner, so
the deposit intent is confirmed atomically via `confirm_deposit_intent_atomic()` and `sync` returns
`status: CONFIRMED`.

---

## Test Verification

Run the E2E full-flow test:

```bash
cd services/gateway && python3 ../../scripts/e2e_fullflow_test.py
```

Expected: Phase 2 deposit polling shows `status=CONFIRMED` within 4–6 s on local Hardhat.

---

## Related

- `_make_event_row()` in `chain.py`
- `_process_single_intent()` in `processing.py`
- `confirm_deposit_intent_atomic()` in storage layer
- `/v1/balance/deposit/sync` route in `balance_deposit.py`
