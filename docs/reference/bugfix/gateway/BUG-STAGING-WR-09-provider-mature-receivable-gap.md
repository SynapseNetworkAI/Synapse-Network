# BUG-STAGING-WR-09: withdrawal-review staging provider lane failed on mature receivable gap

## Symptom

Fresh `withdrawal-review-dogfood:staging` runs reached the provider reject lane
and failed at:

```text
POST /v1/providers/withdrawals/intent failed: 400
PROVIDER_RECEIVABLE_NOT_MATURED
Requested 100.000000 USDC exceeds mature provider receivable of 26.803804 USDC.
```

## Root Cause

The staging harness was still using a fixed provider manual-review amount of
`100.000000 USDC`, but the dedicated staging provider wallet only had
`26.803804 USDC` of mature receivable available at that moment.

This was not a product bug in provider withdrawals. It was a harness bug:

- the lane assumed staging would always have enough pre-matured provider income
- the lane never topped up or re-matured provider earnings before creating the
  manual-review withdrawal

## Fix

Update `scripts/e2e/withdrawal_review_dogfood.mjs` so the provider review lane:

1. reads the real SQL mature receivable formula for the provider wallet
2. computes the gap to the configured manual-review withdrawal amount
3. invokes the paid staging provider fixture enough times to cover the gap
4. matures those new charge rows past T+7
5. only then creates the provider manual-review withdrawal

## Verification

After the fix, the staging provider review lane should no longer fail just
because the dedicated provider wallet starts below the manual-review threshold.
It must first bring the mature receivable above the configured amount, then
proceed through the real admin reject flow.
