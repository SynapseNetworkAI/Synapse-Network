---
title: Staging Domains and Network Access
status: active
owner: ops
last_reviewed: 2026-04-24
---

# Staging Domains and Network Access

This runbook defines the public domain mapping and network permission model for
the Google Cloud staging environment.

## Summary

Staging has four external HTTPS hostnames:

| Hostname | Cloud Run service | Public access | Why |
| --- | --- | --- | --- |
| `staging.synapse-network.ai` | `synapse-staging-user-front` | Yes | Browser-facing user/provider app. |
| `api-staging.synapse-network.ai` | `synapse-staging-gateway` | Yes | User-front calls Gateway API directly from the browser. |
| `admin-staging.synapse-network.ai` | `synapse-staging-admin-front` | Yes | Browser-facing operations console. |
| `admin-api-staging.synapse-network.ai` | `synapse-staging-gateway-admin` | Yes | Admin-front calls Gateway-admin API directly from the browser. |

Public access here means the Cloud Run endpoint accepts unauthenticated HTTP
requests at the Google ingress layer. It does **not** mean the business API is
open. Gateway and Gateway-admin must still enforce JWT/session/auth, CORS, CSRF,
MFA, internal service tokens, and role checks.

## Public vs Private Surfaces

### Must Be Public

These surfaces need browser access and therefore cannot rely on Google IAM
identity tokens for normal users:

| Surface | Required public setting |
| --- | --- |
| User-front | Disable Cloud Run invoker IAM check. |
| Gateway API | Disable Cloud Run invoker IAM check if User-front calls it directly. |
| Admin-front | Disable Cloud Run invoker IAM check so operators can open the web console. |
| Gateway-admin API | Disable Cloud Run invoker IAM check if Admin-front calls it directly. |

Security controls for public API services:

- Gateway CORS must allow only `https://staging.synapse-network.ai`.
- Gateway-admin CORS must allow only `https://admin-staging.synapse-network.ai`.
- Gateway user APIs require wallet/session/JWT authentication where applicable.
- Gateway-admin APIs require admin session/auth, CSRF protection, MFA policy, and
  Gateway internal JWT for internal Gateway calls.
- `/metrics` must require `METRICS_BEARER_TOKEN`; do not treat public API
  access as permission to scrape metrics.

### Must Stay Private

These surfaces must not be public:

| Surface | Rule |
| --- | --- |
| Cloud SQL | No public exposure. Access only through Cloud SQL connector / Cloud Run attachment. |
| Secret Manager | No public access. Runtime service account gets only required `secretAccessor`. |
| Terraform state bucket | Private forever. No runtime service account access. |
| Backup bucket | Private forever. |
| Evidence bucket | Private by default; share explicitly only when needed. |
| Cloud Run Jobs | No public domain mapping. Trigger through Scheduler/IAM or operator `gcloud`. |
| Migration job | No public domain mapping. Trigger only during release. |
| Backup/restore drill job | No public domain mapping. Trigger only during drill. |
| Internal job endpoints | Prefer Cloud Run Jobs; if HTTP endpoints exist, require IAM or internal token. |

## One-Time Domain Mapping

Before mapping domains, confirm the services exist:

```bash
PROJECT_ID=fabled-archive-494108-k5
REGION=us-central1

gcloud run services list \
  --project "$PROJECT_ID" \
  --region "$REGION"
```

Expected services:

```text
synapse-staging-user-front
synapse-staging-gateway
synapse-staging-admin-front
synapse-staging-gateway-admin
```

Create Cloud Run domain mappings:

```bash
PROJECT_ID=fabled-archive-494108-k5
REGION=us-central1

gcloud beta run domain-mappings create \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --service synapse-staging-user-front \
  --domain staging.synapse-network.ai

gcloud beta run domain-mappings create \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --service synapse-staging-gateway \
  --domain api-staging.synapse-network.ai

gcloud beta run domain-mappings create \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --service synapse-staging-admin-front \
  --domain admin-staging.synapse-network.ai

gcloud beta run domain-mappings create \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --service synapse-staging-gateway-admin \
  --domain admin-api-staging.synapse-network.ai
```

If a mapping already exists, inspect it instead of recreating it:

```bash
gcloud beta run domain-mappings list \
  --project "$PROJECT_ID" \
  --region "$REGION"

gcloud beta run domain-mappings describe staging.synapse-network.ai \
  --project "$PROJECT_ID" \
  --region "$REGION"
```

## DNS Records

For each staging subdomain, DNS should point to the Google managed host required
by the domain mapping output. For Cloud Run domain mappings this is commonly:

```text
CNAME staging.synapse-network.ai -> ghs.googlehosted.com
CNAME api-staging.synapse-network.ai -> ghs.googlehosted.com
CNAME admin-staging.synapse-network.ai -> ghs.googlehosted.com
CNAME admin-api-staging.synapse-network.ai -> ghs.googlehosted.com
```

Always follow the exact DNS record shown by:

```bash
gcloud beta run domain-mappings describe <hostname> \
  --project "$PROJECT_ID" \
  --region "$REGION"
```

TLS certificates are Google-managed. After DNS is correct, certificate
provisioning can take several minutes. Do not debug application code until the
domain mapping reports a ready certificate.

## Public Invoker Settings

Some organizations block adding `allUsers` as `roles/run.invoker`. If that
happens, use Cloud Run's invoker IAM check switch for public browser surfaces.

Make the four browser/API surfaces public:

```bash
PROJECT_ID=fabled-archive-494108-k5
REGION=us-central1

gcloud run services update synapse-staging-user-front \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --no-invoker-iam-check

gcloud run services update synapse-staging-gateway \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --no-invoker-iam-check

gcloud run services update synapse-staging-admin-front \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --no-invoker-iam-check

gcloud run services update synapse-staging-gateway-admin \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --no-invoker-iam-check
```

If organization policy allows `allUsers`, this equivalent IAM binding can also
be used:

```bash
gcloud run services add-iam-policy-binding synapse-staging-user-front \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --member allUsers \
  --role roles/run.invoker
```

Do not apply public invoker settings to Cloud Run Jobs, migration jobs, or
backup/restore drill jobs.

## Required Runtime Network Configuration

### User-front

```bash
NEXT_PUBLIC_GATEWAY_BASE_URL=https://api-staging.synapse-network.ai
NEXT_PUBLIC_APP_ENV=staging
```

### Gateway

```bash
CORS_ALLOW_ORIGINS=https://staging.synapse-network.ai
POSTGRES_HOST=/cloudsql/fabled-archive-494108-k5:us-central1:synapse-staging-postgres
RPC_URL=<Secret Manager: synapse-staging-arbitrum-sepolia-rpc-url>
ROUTER_ADDRESS=<SynapseCore Arbitrum Sepolia address>
USDC_TOKEN_ADDRESS=<MockUSDC Arbitrum Sepolia address>
METRICS_BEARER_TOKEN=<Secret Manager: synapse-staging-metrics-bearer-token>
```

### Admin-front

```bash
NEXT_PUBLIC_ADMIN_API_BASE_URL=https://admin-api-staging.synapse-network.ai
ADMIN_API_PROXY_TARGET=https://admin-api-staging.synapse-network.ai
NEXT_PUBLIC_APP_ENV=staging
```

### Gateway-admin

```bash
ADMIN_GATEWAY_ALLOWED_ORIGINS=https://admin-staging.synapse-network.ai
GATEWAY_INTERNAL_BASE_URL=https://api-staging.synapse-network.ai
GATEWAY_INTERNAL_JWT_SECRET=<Secret Manager: synapse-staging-gateway-internal-jwt-secret>
ADMIN_SESSION_COOKIE_DOMAIN=.synapse-network.ai
```

## Verification

### DNS

```bash
dig +short staging.synapse-network.ai
dig +short api-staging.synapse-network.ai
dig +short admin-staging.synapse-network.ai
dig +short admin-api-staging.synapse-network.ai
```

Expected during Cloud Run domain mapping:

```text
ghs.googlehosted.com.
```

### Cloud Run Readiness

```bash
gcloud run services describe synapse-staging-user-front \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(status.conditions[0].status,status.url)'
```

### Public HTTP

```bash
curl -I https://staging.synapse-network.ai/
curl -I https://admin-staging.synapse-network.ai/
curl -i https://api-staging.synapse-network.ai/health
curl -i https://admin-api-staging.synapse-network.ai/health
```

Expected:

- Frontend hosts return `200` or a Next.js redirect/status expected by the app.
- API `/health` returns `200`.
- Auth-protected business routes return `401/403` from the application, not a
  Google Frontend `403`.

If `.run.app` works only with an identity token, the service is still private:

```bash
SERVICE_URL="$(gcloud run services describe synapse-staging-user-front \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(status.url)')"

curl -I "$SERVICE_URL"
curl -I -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$SERVICE_URL"
```

If the first command returns Google Frontend `403` and the second returns `200`,
disable invoker IAM check for that browser-facing service.

### CORS

Gateway should accept staging user-front origin:

```bash
curl -i -X OPTIONS https://api-staging.synapse-network.ai/health \
  -H 'Origin: https://staging.synapse-network.ai' \
  -H 'Access-Control-Request-Method: GET'
```

Gateway-admin should accept staging admin-front origin:

```bash
curl -i -X OPTIONS https://admin-api-staging.synapse-network.ai/health \
  -H 'Origin: https://admin-staging.synapse-network.ai' \
  -H 'Access-Control-Request-Method: GET'
```

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `.run.app` returns Google Frontend `403` without token, `200` with token | Cloud Run invoker IAM check still enabled. | Run `gcloud run services update <service> --no-invoker-iam-check`. |
| Custom domain TLS handshake fails | Domain mapping or managed certificate not ready. | Check `gcloud beta run domain-mappings describe <host>` and wait for certificate readiness. |
| Custom domain points to `ghs.googlehosted.com` but still fails | DNS exists but Cloud Run mapping/cert not complete. | Verify the mapping exists in `us-central1` and wait for Google-managed cert. |
| Browser gets CORS error | API CORS origin does not match frontend domain. | Set Gateway/Gateway-admin CORS to the exact `https://...` frontend host. |
| API returns application `401/403` | Network is open, app auth is denying request. | Debug JWT/session/CSRF/MFA, not Cloud Run IAM. |
| `/metrics` is reachable without token | Security regression. | Require `METRICS_BEARER_TOKEN` and keep metrics off public dashboards. |

## Production Difference

Production can use the same shape, but with stricter review:

- Production Gateway may still be public because real users and agents call it.
- Production Admin-front/Admin API may require extra controls such as IAP,
  allowlisted operator accounts, or VPN/zero-trust access.
- Production must not reuse staging domains, secrets, Cloud SQL, contracts,
  wallets, or Lark routes.
- Production launch remains NO-GO until staging evidence and small-value
  production rehearsal evidence are complete.
