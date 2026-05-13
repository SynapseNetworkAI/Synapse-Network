# BUG-STAGING-WR-03 Staging withdrawal review dogfood was polluted by stale manual-review rows

## Symptom

The staging withdrawal review dogfood failed on the consumer reject lane with an
apparent balance inflation:

```text
consumer reject available delta mismatch
expected=0.000000
actual=500.000000
```

## Root cause

`POST /v1/balance/consumer/withdraw` returned:

```json
{
  "status": "PENDING_MANUAL_REVIEW",
  "existingWithdrawal": true
}
```

So the dogfood did not create a fresh fixture row. It reused an old
`PENDING_MANUAL_REVIEW` withdrawal already freezing funds from an earlier staging
run. Rejecting that stale row restored the previously frozen balance, which made
the current run look like it had minted `500 USDC`.

## Fix

`scripts/e2e/withdrawal_review_dogfood.mjs` now rejects leftover staging
`PENDING_MANUAL_REVIEW` rows for the dedicated consumer/provider test wallets
before creating fresh dogfood fixtures.

The cleanup uses the real admin decision API instead of direct SQL mutation, so
the release gate keeps exercising the actual manual-review path.

## Verification

- rerun `npm run e2e:withdrawal-review-dogfood:staging`
- confirm the evidence bundle records
  `consumer-cleanup:stale-manual-review-rejected` and/or
  `provider-cleanup:stale-manual-review-rejected` only when stale rows existed
- confirm the fresh consumer reject lane no longer reports `existingWithdrawal`
