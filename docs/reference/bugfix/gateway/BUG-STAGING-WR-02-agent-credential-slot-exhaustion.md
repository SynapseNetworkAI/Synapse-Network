# BUG-STAGING-WR-02 Staging withdrawal review dogfood hit agent credential slot exhaustion

## Symptom

`npm run e2e:withdrawal-review-dogfood:staging` failed while auto-generating the
staging provider fixture:

```text
POST /v1/credentials/agent/issue failed: 409
AGENT_CREDENTIAL_LIMIT_REACHED
```

## Root cause

The staging consumer test wallet had old active E2E credentials left behind.
`withdrawal_review_dogfood.mjs` could issue a fresh credential, but it had no
cleanup path when the per-owner credential limit was already full.

## Fix

The staging dogfood runner now:

1. lists active agent credentials for the staging consumer wallet
2. revokes old E2E-style credentials using known prefixes
3. retries credential issuance automatically

This matches the same safety posture already used by the gateway E2E suite and
keeps the staging gate rerunnable without manual credential cleanup.

## Verification

- rerun `npm run e2e:withdrawal-review-dogfood:staging`
- confirm the evidence bundle records
  `consumer:agent-credential-slots-reclaimed`
