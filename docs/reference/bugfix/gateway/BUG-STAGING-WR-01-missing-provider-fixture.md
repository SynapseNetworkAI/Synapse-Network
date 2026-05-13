# BUG-STAGING-WR-01 Missing staging provider review fixture

## Symptom

`npm run e2e:withdrawal-review-dogfood:staging` aborted before any review-path assertions ran:

```text
Staging provider review requires WITHDRAWAL_REVIEW_DOGFOOD_FIXTURE.
```

The runner hard-required a historical JSON fixture path from `tmp/staging-fixtures/`,
but that file was never part of durable repo state.

## Root cause

The staging withdrawal-review dogfood treated a transient local artifact as a
release prerequisite. Once the old fixture file disappeared, the staging gate
could no longer generate provider receivable on its own, even though all live
inputs were still available:

- staging consumer wallet key
- staging provider wallet key
- provider-owned staging service
- Gateway credential issuance API

## Fix

`scripts/e2e/withdrawal_review_dogfood.mjs` now auto-generates a fresh staging
fixture when `WITHDRAWAL_REVIEW_DOGFOOD_FIXTURE` is missing.

The generated fixture includes:

- provider-owned service id
- service price and target endpoint
- fresh staging agent credential token
- consumer/provider wallet addresses

The runner still accepts an explicit fixture path, but no longer depends on a
manual leftover file to execute the staging gate.

## Verification

- rerun `npm run e2e:withdrawal-review-dogfood:staging`
- rerun `npm run ci:withdrawal-review-dogfood-staging-evidence`
