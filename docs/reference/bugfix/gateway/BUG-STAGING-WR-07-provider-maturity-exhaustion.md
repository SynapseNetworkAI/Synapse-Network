# BUG-STAGING-WR-07 Staging provider review dogfood lacked mature receivable for the reject lane

## Symptom

After provider invokes succeeded, the provider manual-review withdrawal still
failed with:

```text
PROVIDER_RECEIVABLE_NOT_MATURED
Requested 100.000000 USDC exceeds mature provider receivable ...
```

## Root cause

The staging dogfood generated fresh provider earnings during the run, but it
only matured provider charge ledger rows in local mode. Staging therefore tried
to create a `provider_withdrawal` before the just-created receivable had crossed
the T+7 maturity window.

## Fix

`scripts/e2e/withdrawal_review_dogfood.mjs` now matures the freshly generated
provider charge ledger rows in staging as well before requesting the provider
manual-review withdrawal.

This is a staging-fixture mutation for release-gate repeatability, not a
production runtime behavior change.

## Verification

- rerun `npm run e2e:withdrawal-review-dogfood:staging`
- confirm the evidence bundle records `provider:charges-matured`
- confirm the provider reject lane no longer fails with
  `PROVIDER_RECEIVABLE_NOT_MATURED`
