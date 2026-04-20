# BUG-ADMIN-WITHDRAWAL-E2E-DEADLOCK-RATE-LIMIT

## Summary

During the admin withdrawal approval fullchain dogfood, the local deposit flow could intermittently fail while the deposit indexer was backfilling and the balance write-rate fallback was inserting rate-limit rows. The symptom was a transient Postgres deadlock in the fallback path.

## Reproduction

1. Start the local Gateway with deposit indexer enabled.
2. Run `npm run e2e:admin-withdrawal-approval:seed`.
3. While the seed creates a deposit intent, allow the indexer backfill/reconciliation loop to run at the same time.
4. Observe an intermittent deadlock from the owner write-rate fallback insert/update path.

## Root Cause

The fallback rate-limit path is only used when Redis is unavailable. In local dogfood this path can contend with indexer writes against the same owner/account rows. A single deadlock was treated as fatal even though this operation is safe to retry.

## Fix

`services/gateway/src/services/balance_mixins/redis_guard_rate_limit.py` now retries `DeadlockDetected` up to three times with a short bounded backoff before surfacing the error.

## Verification

- `npm run e2e:admin-withdrawal-approval:seed`
- `npm run e2e:admin-withdrawal-approval:dogfood`
- `npm run e2e:admin-withdrawal-approval:reconcile`

Final passing evidence:

- `output/dogfood/admin-withdrawal-approval/2026-04-20T075358383Z/report.md`
- `output/dogfood/admin-withdrawal-approval/2026-04-20T075358383Z/reconciliation-report.md`

## Residual Risk

This is a local fallback guard. Production should prefer Redis-backed rate limiting and should still monitor Postgres deadlock count as a degraded signal.
