# BUG-WITHDRAW-01 — Consumer Withdraw Balance Restored By Confirmed Deposit Repair

**Severity:** High  
**Component:** `services/gateway` — consumer withdraw / deposit atomic repair  
**Reported:** 2026-04-08  
**Status:** Fixed

---

## Summary

On `http://localhost:3000/dashboard/billing/credits`, after clicking Withdraw for consumer credits,
the API returned `status: REQUESTED`, but `Remaining balance` stayed unchanged.

Example broken response:

```json
{
  "status": "REQUESTED",
  "ownerAddress": "0xd856907d7e35a8f9bd225859a59e58577147a092",
  "withdrawId": "d1548aa4-51cf-4ee0-9a83-536060630dc8",
  "amountUsdc": 20.0,
  "riskLevel": "green",
  "riskReasonCode": "",
  "message": ""
}
```

The withdrawal row existed, but the balance ledger still showed:

- `available_balance = 20.000000`
- `pending_balance = 0.000000`

---

## Root Cause

Two bugs combined:

1. Consumer withdraw rows could already be `REQUESTED` while the reservation was missing from the
   balance ledger.
2. `confirm_deposit_intent_atomic()` had a replay-repair branch for already `CONFIRMED` deposits.
   That branch moved `pending_balance -> available_balance` again whenever it saw enough pending
   funds. Because consumer withdrawals reuse the same consumer `pending_balance` bucket, this repair
   incorrectly released active withdrawal reservations back into available balance.

In practice, the sequence was:

1. consumer withdraw created `REQUESTED`
2. available moved to pending
3. deposit confirm replay/repair ran later
4. repair treated the same pending funds as stale deposit pending
5. funds were moved back to available
6. UI still showed full remaining balance although withdrawal stayed active

---

## Fix

1. `services/gateway/src/storage/postgres/repositories/finance_atomic_deposit_mixin.py`
   - Stop mutating balances when a deposit is already `CONFIRMED`
   - Replayed confirm calls are now idempotent reads, not balance repairs

2. `services/gateway/src/services/platform/finance_service.py`
   - Add self-healing on `GET /api/v1/balance`
   - If active consumer withdrawal rows exist but `pending_balance` is short, atomically re-reserve
     the missing amount before returning the balance summary

3. `services/gateway/src/storage/postgres/repositories/balance_repository.py`
   - `write_balance_ledger()` now uses `GREATEST(EXCLUDED.available_balance, current.available_balance)`
     for available-only upserts so stale snapshots cannot decrease balance state written by atomic
     mutation paths

---

## Verification

Executed and passing:

```bash
cd services/gateway
PYTHONPATH=. .venv/bin/pytest tests/unit/test_consumer_withdraw_unit.py -q
PYTHONPATH=. .venv/bin/pytest tests/unit/test_finance_runtime_service_unit.py -q -k "owner_balance_summary_uses_consumer_provider_fields or owner_balance_summary_repairs_stale_active_consumer_withdraw_gap"
PYTHONPATH=. .venv/bin/pytest tests/unit/storage/test_postgres_repositories_unit.py -q -k "balance_repository_read_and_write or confirmed_deposit_is_idempotent_without_balance_repair or confirm_deposit_writes_canonical_audit_evidence"

cd ../user-front
npx vitest run src/components/dashboard-workspace/OwnerCreditsPage.withdraw.test.tsx src/components/dashboard-workspace/OwnerCreditsPage.test.tsx
```

Live local DB verification after repair:

- `0xd856907d7e35a8f9bd225859a59e58577147a092` → `available=0.000000`, `pending=20.000000`
- `0x70997970c51812dc3a010c7d01b50e0d17dc79c8` → `available=95.554100`, `pending=5.000000`

---

## Related

- `services/gateway/src/services/owner/finance_consumer_withdraw_mixin.py`
- `services/gateway/src/services/platform/finance_service.py`
- `services/gateway/src/storage/postgres/repositories/balance_repository.py`
- `services/gateway/src/storage/postgres/repositories/finance_atomic_deposit_mixin.py`