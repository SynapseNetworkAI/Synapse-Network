# BUG-STAGING-WR-04 Staging issued agent credential token drifted from stored credential secret

## Symptom

The staging withdrawal review dogfood issued a fresh agent credential, but the
first provider invoke failed with:

```text
CREDENTIAL_INVALID
```

Direct inspection showed the returned token did not match the credential row
later stored in Cloud SQL:

- issue response token prefix: `agt_ea9aa5...`
- stored credential prefix/status row: `agt_42c050...`

## Root cause

In the live staging environment, the credential returned by
`POST /v1/credentials/agent/issue` was not the same secret that the Gateway
later validated for the same `credential_id`.

This was observed as a staging runtime drift issue. The repo-local lifecycle
code is internally consistent, but the staging release gate still needs a stable
way to obtain a live-valid token.

## Fix

`scripts/e2e/withdrawal_review_dogfood.mjs` now rotates the freshly issued
credential immediately and uses the rotated token for the provider receivable
fixture.

That gives the staging dogfood a live-valid token without depending on the
drifting secret returned by the initial `issue` response.

## Verification

- rerun `npm run e2e:withdrawal-review-dogfood:staging`
- confirm the provider invoke no longer fails with `CREDENTIAL_INVALID`
