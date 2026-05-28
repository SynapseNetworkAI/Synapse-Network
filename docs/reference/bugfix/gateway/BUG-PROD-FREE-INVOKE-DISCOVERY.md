# BUG-PROD-FREE-INVOKE-DISCOVERY

## Symptom

`npm run e2e:prod-free-invoke` failed after the production finance-hardening
release even though production Agent discovery and free invocation were healthy.

The runner still queried legacy `GET /api/v1/services/discover`, which can be
empty in production, while the canonical Agent path is
`POST /api/v1/agent/discovery/search`.

The same run also produced false UI failures because Playwright `innerText()`
returned an empty string for hydrated production pages and because the forbidden
raw-error regex treated normal page copy containing `ledger` as a finance error.

## Root Cause

The production evidence runner had drifted from the public Agent invocation
contract:

- service discovery used the legacy marketplace endpoint instead of Agent
  discovery;
- DOM text extraction relied on `innerText()` instead of `textContent`;
- UI error scanning mixed real raw-error markers with ordinary product words.

## Fix

- `scripts/e2e/prod_core_e2e.mjs` now discovers services through
  `POST /api/v1/agent/discovery/search`.
- Production UI evidence waits for expected page text and reads
  `document.body.textContent`.
- The prod UI raw-error gate now blocks concrete error leaks such as `503`,
  `HTTPException`, `RPC Error`, `CHAIN_RPC`, `PROVIDER_`, and `WITHDRAW_`,
  without failing on normal product copy.

## Verification

```bash
PROD_E2E_CONFIRM=I_UNDERSTAND_THIS_MUTATES_PROD_FREE_INVOKE \
npm run e2e:prod-free-invoke

PROD_CORE_E2E_EVIDENCE_DIR=<latest-prod-free-invoke-evidence> \
npm run ci:prod-core-e2e-evidence
```

Latest passing evidence from the release validation:

`docs/evidence/prod/core-e2e/20260528T155128Z-free-invoke`
