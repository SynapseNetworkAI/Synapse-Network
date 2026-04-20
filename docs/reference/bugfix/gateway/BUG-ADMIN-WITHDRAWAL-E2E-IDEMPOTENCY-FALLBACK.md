# BUG-ADMIN-WITHDRAWAL-E2E-IDEMPOTENCY-FALLBACK

## Summary

The provider withdrawal idempotency fallback could fail to return the original response, and repeated same-key withdrawal requests could proceed far enough to hit an insufficient receivable error after the first request had already frozen the amount.

## Reproduction

1. Run `npm run e2e:admin-withdrawal-approval:seed`.
2. The seed creates a `2.000000 USDC` provider withdrawal with an idempotency key.
3. The seed immediately retries with the same idempotency key.
4. Before the fix, the duplicate request could fail with `INSUFFICIENT_PROVIDER_RECEIVABLE` instead of returning the original withdrawal response.

## Root Cause

The local idempotency fallback assumed a row object shape that was not always present and appended duplicate fallback rows for the same `(scope, owner, idempotency_key)`. The provider withdrawal create flow also checked available receivable before resolving existing idempotent/pending withdrawals.

## Fix

- `services/gateway/src/services/balance_mixins/redis_guard_idempotency.py` now reads fallback response data defensively and replaces an existing fallback row for the same key instead of appending duplicates.
- `services/gateway/src/services/provider/withdraw_service.py` now computes request hash and resolves idempotent/pending withdrawals before checking available receivable for a new withdrawal.

## Verification

`npm run e2e:admin-withdrawal-approval:seed` now verifies:

- same `X-Idempotency-Key` returns the same withdrawal
- a second active withdrawal with a different idempotency key is rejected without freezing the same balance again
- wrong internal token is rejected without changing withdrawal state

Final passing run:

- Run ID: `awa-20260420075352`
- Withdrawal ID: `wd-1776671637-7e8a4bac`

## Residual Risk

The fallback path is still a local/dev safety net. Production should keep Redis available and continue to enforce database uniqueness/idempotency at the durable boundary.
