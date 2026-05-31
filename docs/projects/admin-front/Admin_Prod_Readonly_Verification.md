---
id: admin-prod-readonly-verification
title: Admin Prod Readonly Verification
status: canonical
created_at: 2026-05-20
updated_at: 2026-05-20
owner: admin-front
verified_with:
  - node --check scripts/ui/verify_admin_front_prod_readonly.mjs
  - node --check scripts/ci/admin_front_prod_readonly_evidence_check.mjs
---

# Admin Prod Readonly Verification

This runbook is the production-safe companion to local and staging admin
regression. It verifies that `admin.synapse-network.ai` is healthy for a real
operator session without executing state-changing control-plane actions.

## Commands

```bash
npm run e2e:admin-front:prod-readonly
npm run ci:admin-front-prod-readonly-evidence
```

The harness writes evidence under:

```text
output/dogfood/admin-front-prod-readonly/<runId>/
```

Minimum files:

- `route_results.json`
- `api_results.json`
- `console_results.json`
- `log_results.json`
- `report.json`
- `report.md`
- `screenshots/`

## Required Inputs

The harness needs one of these auth modes:

1. `ADMIN_SESSION_TOKEN` with optional `ADMIN_CSRF_TOKEN`
2. `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_OTP_CODE`

Prod defaults:

- `ADMIN_FRONT_URL=https://admin.synapse-network.ai`
- `ADMIN_GATEWAY_URL=https://admin-api.synapse-network.ai`

## Coverage

Readonly coverage includes:

- auth entry pages
- dashboard overview/runtime
- system
- finance and reconciliation
- analytics overview and drilldowns
- execution, risk, audit
- users, RBAC, menu config
- provider services
- forum support
- approvals, withdrawal reviews, review history

The harness allows navigation, refresh, pagination, filter, and drilldown style
reads only. It must not click actions that mutate prod state, including
approval, rejection, save, execute, finalize, revoke, force probe, or send.

## Pass Criteria

A prod readonly run passes only when:

1. Every route is reachable in the authenticated operator session.
2. No page shows `Internal server error`, `Failed to fetch`, or login redirect
   for authenticated routes.
3. Admin API requests observed during page loads do not return `>= 400`.
4. Console errors and failed XHR/fetch requests are absent.
5. Cloud Run `ERROR` logs in the verification window are absent, or log
   verification is explicitly skipped and documented outside the bundle.

## Safety Boundary

This is a production-safe read-only verification harness. It is not a
replacement for small-value rehearsals or finance execution evidence. Any
state-changing control-plane action requires a separate, explicit production
authorization and run plan.
