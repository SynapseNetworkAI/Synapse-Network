# BUG-FINANCE-06: Release E2E Used Retired Deposit Confirm Route

**Date:** 2026-05-28
**Status:** Fixed
**Surface:** Gateway release full-chain E2E evidence

## Symptom

After the finance hardening release reached staging, `release:evidence:gateway-fullchain:staging`
failed in `test_deposit_confirm` because the test still expected the public
deposit confirm endpoint to return `200`.

The deployed Gateway correctly returned:

```text
410 DEPOSIT_CONFIRM_INDEXER_ONLY
```

## Root Cause

The product contract changed: deposit confirmation is now owned by the chain
indexer and cannot be completed through an owner-authenticated public confirm
route. The release E2E kept the old manual-confirm model, so staging validation
was testing a retired unsafe path instead of the new indexer-owned path.

## Fix

- The E2E now asserts that the public confirm route returns
  `DEPOSIT_CONFIRM_INDEXER_ONLY`.
- Release E2E can trigger the protected deposit-indexer job with
  `GATEWAY_E2E_INTERNAL_TRIGGER_SECRET`.
- The test polls `/api/v1/balance/deposit/sync` and the balance API until the
  indexer-backed deposit reaches `CONFIRMED` and the spendable balance updates.
- Staging release evidence now requires `GATEWAY_E2E_INTERNAL_TRIGGER_SECRET`
  so the proof is deterministic.

## Prevention

Finance release tests must prove the active money-state transition path. When a
public money mutation endpoint is retired, release evidence should explicitly
assert the retirement status and then verify the replacement path end-to-end.

## Verification

```bash
cd services/gateway && .venv/bin/python -m pytest tests/e2e/test_04_deposit.py -q
GATEWAY_RELEASE_E2E_PROFILE=mvp-postgres npm run release:evidence:gateway-fullchain:staging
GATEWAY_RELEASE_E2E_REQUIRED_ENV=staging npm run ci:gateway-release-e2e-evidence
```
