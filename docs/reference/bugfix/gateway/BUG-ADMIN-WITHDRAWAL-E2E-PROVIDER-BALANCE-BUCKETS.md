# BUG-ADMIN-WITHDRAWAL-E2E-PROVIDER-BALANCE-BUCKETS

## Summary

After admin approval and on-chain claim, `complete` could fail with `WITHDRAWAL_LOCK_INCONSISTENT` because provider manual-review approval did not move the frozen withdrawal amount into the pending withdrawal bucket in the Postgres ledger.

## Reproduction

1. Run the withdrawal approval dogfood flow.
2. Approve a `2.000000 USDC` provider withdrawal in `/withdrawal-reviews`.
3. Claim the signed ticket on `SynapseCore.withdraw(...)`.
4. Call the Gateway complete endpoint with the tx hash.
5. Before the fix, complete could return `409 WITHDRAWAL_LOCK_INCONSISTENT` while the provider account still showed `frozen_balance=2.000000` and `pending_balance=0.000000`.

## Root Cause

Provider withdrawal helper methods still relied on the in-memory ledger fallback for bucket transitions. In the Postgres-backed runtime, manual-review approval and completion need atomic provider balance updates against `synapse_account_balances`.

## Fix

- Added provider-specific atomic balance methods in `services/gateway/src/storage/postgres/repositories/balance_repository.py`:
  - `move_provider_frozen_to_pending`
  - `consume_provider_pending_for_withdrawal`
  - `release_provider_pending_to_available`
  - `release_provider_frozen_to_available`
- `services/gateway/src/services/provider/withdraw_helpers_mixin.py` now uses these Postgres methods when available and falls back only for non-Postgres test doubles.

## Verification

Final passing fullchain:

- Admin approval status: `APPROVED_AUTO`
- Chain claim tx: `0x5f6bacad8c7550f3407904de202f779167ccf978fdb3874d0f1d19f492956246`
- Gateway complete status: `COMPLETED`
- Provider pending balance after complete: `0.000000`
- Provider frozen balance after complete: `0.000000`

Evidence:

- `output/dogfood/admin-withdrawal-approval/2026-04-20T075358383Z/reconciliation-report.md`

## Residual Risk

The same bucket transition pattern should be used for any future consumer refund/withdrawal admin UI so manual-review actions never depend on in-memory ledger behavior.
