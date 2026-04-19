---
Status: fixed
Owner: frontend
Last Updated: 2026-04-18
---

# BUG-FRONT-FULLCHAIN-03: Credential Page Verification Used Drifted API Paths

## Reproduction

Run the real-data browser verification after seeding the local fullchain fixture:

```bash
npm run e2e:user-front-fullchain:seed
npm run e2e:user-front-fullchain:verify
```

The `dashboard-credentials` page could render but the verification report failed to associate the page with a real gateway read.

## Root Cause

The user-front page registry still described the credential page as using `/api/v1/agent/credentials`, while the production component uses the current gateway endpoints under `/api/v1/credentials/agent/*`.

This made the verification contract stricter than the implementation in the wrong direction: the page was allowed to drift from its documented data contract without an obvious signal.

## Fix

Updated `services/user-front/src/app/user-front-page-registry.json` so the credential page declares the actual gateway endpoints used by the component:

- `GET /api/v1/credentials/agent/list`
- `GET /api/v1/credentials/agent/audit-logs`
- `POST /api/v1/credentials/agent/issue`
- `POST/DELETE /api/v1/credentials/agent/:credentialId`

The fullchain browser verifier now waits longer for fixture-backed data and matches actual page data sources instead of stale endpoint names.

## Verification

Run:

```bash
node --check scripts/ui/verify_user_front_pages.mjs
npm run ci:user-front-pages
npm run e2e:user-front-fullchain:verify
```

Expected result: `failed.length === 0` and `blocked.length === 0`.

## Residual Risk

The registry remains a manually curated page contract. Future endpoint renames must update the registry, docs, and verifier together.
