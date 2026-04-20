# BUG-ADMIN-WITHDRAWAL-E2E-RUNTIME-RACE

## Summary

The admin withdrawal seed could fail when a newly registered provider service was visible in discovery but the invoke router briefly had no healthy upstream target.

## Reproduction

1. Run `npm run e2e:admin-withdrawal-approval:seed`.
2. Register a new provider service and wait for discovery.
3. Immediately invoke the service.
4. Before the fix, a transient `503 SERVICE_UNAVAILABLE` from `/api/v1/gateway/generate` failed the seed.

## Root Cause

Discovery visibility and invoke routing health can briefly diverge around a fresh service registration and health probe update. The seed treated this runtime settling window as a hard product failure.

## Fix

`scripts/e2e/admin_withdrawal_approval_seed.mjs` now retries invoke on expected transient runtime protection codes: `SERVICE_UNAVAILABLE`, `SERVICE_BUSY`, and `SERVICE_CIRCUIT_OPEN`.

## Verification

- `npm run e2e:admin-withdrawal-approval:seed`
- Final passing run: `awa-20260420075352`

## Residual Risk

If retry exhaustion happens, the seed still fails. A persistent unavailable service remains a real Gateway/runtime bug.
