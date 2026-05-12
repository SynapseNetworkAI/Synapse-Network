# BUG-STAGING-ADMIN-01 — Admin API CORS Origin Drift Blocks Staging Smoke

**Status:** Open  
**Severity:** High  
**Component:** `services/gateway-admin` / staging deploy workflow  
**Reported:** 2026-05-12  
**Environment:** `staging`  
**Last verified against runtime:** 2026-05-12

---

## Summary

Fresh staging smoke evidence on `2026-05-12` failed even after the RPC check was
rerun against the official public Arbitrum Sepolia RPC. The only remaining
blocker was the admin API CORS preflight:

```text
gateway_admin_cors_admin_front
OPTIONS https://admin-api-staging.synapse-network.ai/api/admin/v1/auth/login
Origin: https://admin-staging.synapse-network.ai
status=400
body=Disallowed CORS origin
```

This blocks the staging smoke gate and makes later admin/browser dogfood
evidence unreliable because the admin frontend origin is not accepted by the
live admin API.

## Runtime Evidence

Fresh evidence bundle:

- `docs/evidence/staging/smoke/20260512T152857Z-staging-smoke/`

Direct reproduction:

```bash
curl -is -X OPTIONS \
  https://admin-api-staging.synapse-network.ai/api/admin/v1/auth/login \
  -H 'Origin: https://admin-staging.synapse-network.ai' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
```

Observed response:

```text
HTTP/2 400
access-control-allow-methods: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT
body: Disallowed CORS origin
```

## Root Cause

The code and Terraform substrate both expect staging admin CORS to allow:

```text
ADMIN_GATEWAY_ALLOWED_ORIGINS=https://admin-staging.synapse-network.ai
```

But the staging deploy workflow only forced this minimal env set for
`gateway-admin`:

```text
ADMIN_GATEWAY_DEBUG=false
ADMIN_SESSION_COOKIE_SECURE=true
```

That means a workflow-driven staging deploy could leave the service without the
full fixed staging admin env contract, including
`ADMIN_GATEWAY_ALLOWED_ORIGINS`, and drift away from the Terraform intent.

## Fix

The staging deploy workflow now pushes the full `gateway-admin` staging env set
instead of only two ad-hoc vars:

- `ADMIN_GATEWAY_ALLOWED_ORIGINS=https://admin-staging.synapse-network.ai`
- `ADMIN_GATEWAY_PORT=8000`
- `ADMIN_SESSION_COOKIE_SAMESITE=lax`
- `ADMIN_SESSION_COOKIE_DOMAIN=.synapse-network.ai`
- `POSTGRES_POOL_MAX=3`
- `EXECUTION_WORKER_ENABLED=false`
- `GATEWAY_INTERNAL_BASE_URL=https://api-staging.synapse-network.ai`
- `GCP_ALERT_RECEIVER_*` staging defaults
- plus the existing secrets injection

Repo fix path:

- `.github/workflows/deploy-staging.yml`

## Verification Plan

1. Redeploy `gateway-admin` through the corrected staging deploy workflow.
2. Rerun:

```bash
npm run e2e:staging-smoke
npm run ci:staging-smoke-evidence
```

3. Confirm `gateway_admin_cors_admin_front` passes with:

```text
status=2xx
access-control-allow-origin=https://admin-staging.synapse-network.ai
```

4. Only after smoke is green should admin-facing staging dogfood lanes be
   rerun.

## Notes

During the same investigation, the staging smoke runner was hardened so that a
placeholder `.env.staging` RPC value such as `...ALCHEMY_KEY` no longer causes
false smoke failures when Secret Manager is unavailable locally. That runner
change reduced the fresh smoke failure set to the single real CORS regression
above.
