# BUG-STAGING-WR-08 Staging withdrawal review dogfood hit transient auth verify 401

## Symptom

The staging withdrawal review dogfood occasionally died before any money-path
assertions with:

```text
POST /v1/auth/verify failed: 401
Invalid signature or expired challenge
```

## Root cause

Staging `challenge -> sign -> verify` occasionally returns a transient `401`
even when the same wallet and signer succeed on immediate retry. This is the
same class of live auth flake already observed in the staging full-chain lane.

## Fix

`scripts/e2e/withdrawal_review_dogfood.mjs` now retries wallet auth up to three
times when verify fails with the known transient `401`/expired-challenge error.

## Verification

- rerun `npm run e2e:withdrawal-review-dogfood:staging`
- confirm transient verify failures are absorbed by the retry path instead of
  aborting the whole gate
