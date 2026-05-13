# BUG-STAGING-WR-05 Staging withdrawal review dogfood ran out of mature consumer balance

## Symptom

The consumer manual-review lanes in staging failed with:

```text
INSUFFICIENT_MATURE_CONSUMER_BALANCE
Requested 500.000000 USDC exceeds mature withdrawable balance of 50.991772 USDC
```

## Root cause

The dedicated staging consumer test wallet still had large available balance, but
most of its recent top-up deposits were younger than the enforced T+7 maturity
window.

The existing dogfood helper also only backdated consumer deposits by `2 days`,
which no longer matches the real maturity rule enforced by Gateway.

## Fix

Two changes were applied:

1. `scripts/e2e/withdrawal_review_maturity_helpers.mjs`
   now backdates confirmed consumer deposits by `8 days`, not `2 days`.
2. `scripts/e2e/withdrawal_review_dogfood.mjs`
   now runs the consumer deposit maturity helper for staging as well, so the
   dedicated staging test wallet always has mature funds before the manual-review
   lanes execute.

This is a staging-only release-gate fixture mutation, not a production behavior
change.

## Verification

- rerun `npm run e2e:withdrawal-review-dogfood:staging`
- confirm the evidence bundle records `consumer:deposit-matured`
- confirm the consumer reject/approve lanes no longer fail with
  `INSUFFICIENT_MATURE_CONSUMER_BALANCE`
