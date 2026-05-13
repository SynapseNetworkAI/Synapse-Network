# BUG-STAGING-WR-10: provider top-up loop exhausted fixture credential maxCalls

## Symptom

After `BUG-STAGING-WR-09` added a provider mature-receivable top-up loop, the
fresh staging dogfood run failed mid-loop with:

```text
provider invoke provider-topup-51 failed: 429
CREDENTIAL_MAX_CALLS_EXCEEDED
```

## Root Cause

The staging fixture generator still issued the consumer agent credential with:

- `maxCalls = 50`

That cap was enough for the older two-invoke provider baseline, but not for the
new top-up path where the harness may need dozens of additional paid invokes to
bring mature provider receivable above the manual-review threshold.

## Fix

Increase the generated staging fixture credential ceiling in
`scripts/e2e/withdrawal_review_dogfood.mjs` from `50` to `500` calls.

This keeps the dogfood lane focused on testing the real withdrawal-review
behavior instead of failing on an artificial harness limit.

## Verification

Rerun:

```bash
npm run e2e:withdrawal-review-dogfood:staging
```

The provider top-up loop should be able to complete without a
`CREDENTIAL_MAX_CALLS_EXCEEDED` failure.
