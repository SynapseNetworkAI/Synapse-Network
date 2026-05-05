---
title: Staging Domains and Network Access
status: active
owner: ops
last_reviewed: 2026-04-27
---

# Staging Domains and Network Access

This runbook defines the public domain mapping and network permission model for
the Google Cloud staging environment.

## Summary

Staging has six external HTTPS hostnames:

| Hostname                               | Cloud Run service               | Public access | Why                                                                    |
| -------------------------------------- | ------------------------------- | ------------- | ---------------------------------------------------------------------- |
| `staging.synapse-network.ai`           | `synapse-staging-user-front`    | Yes           | Browser-facing user/provider app.                                      |
| `docs-staging.synapse-network.ai`      | `synapse-staging-docs-front`    | Yes           | Dedicated developer docs.                                              |
| `api-staging.synapse-network.ai`       | `synapse-staging-gateway`       | Yes           | User-front calls Gateway API directly from the browser.                |
| `admin-staging.synapse-network.ai`     | `synapse-staging-admin-front`   | Yes           | Browser-facing operations console.                                     |
| `admin-api-staging.synapse-network.ai` | `synapse-staging-gateway-admin` | Yes           | Admin-front calls Gateway-admin API directly from the browser.         |
| `provider-staging.synapse-network.ai`  | `synapse-staging-provider`      | Limited       | Gateway reaches Provider runtime through signed provider invoke calls. |

Public access here means the Cloud Run endpoint accepts unauthenticated HTTP
requests at the Google ingress layer. It does **not** mean the business API is
open. Gateway and Gateway-admin must still enforce JWT/session/auth, CORS, CSRF,
MFA, internal service tokens, and role checks.

GitHub staging deploy supports `deploy_scope=docs-front` for a docs-only
rollout to `synapse-staging-docs-front`.

## Public vs Private Surfaces

### Must Be Public

These surfaces need browser access and therefore cannot rely on Google IAM
identity tokens for normal users:

| Surface           | Required public setting                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| User-front        | Disable Cloud Run invoker IAM check.                                                                 |
| Docs-front        | Disable Cloud Run invoker IAM check so developers and crawlers can open docs.                        |
| Gateway API       | Disable Cloud Run invoker IAM check if User-front calls it directly.                                 |
| Admin-front       | Disable Cloud Run invoker IAM check so operators can open the web console.                           |
| Gateway-admin API | Disable Cloud Run invoker IAM check if Admin-front calls it directly.                                |
| Provider runtime  | Disable Cloud Run invoker IAM check only for `/health`, `/ready`, and Gateway-signed invoke ingress. |

Security controls for public API services:

- Gateway CORS must allow only `https://staging.synapse-network.ai`.
- Gateway-admin CORS must allow only `https://admin-staging.synapse-network.ai`.
- Gateway user APIs require wallet/session/JWT authentication where applicable.
- Gateway-admin APIs require admin session/auth, CSRF protection, MFA policy, and
  Gateway internal JWT for internal Gateway calls.
- `/metrics` must require `METRICS_BEARER_TOKEN`; do not treat public API
  access as permission to scrape metrics.
- Provider `/provider-services/*/invoke` must require Gateway HMAC headers:
  `X-Synapse-Service-Id`, `X-Synapse-Signed-At`, `X-Synapse-Signature`, and
  `X-Synapse-Request-Id`. Anonymous direct invoke must return application
  `401/403`, not `200`.

### Must Stay Private

These surfaces must not be public:

| Surface                  | Rule                                                                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud SQL                | Public IPv4 may exist, but connector enforcement must be `REQUIRED` and authorized networks must stay empty. Access only through Cloud SQL connector / Auth Proxy plus IAM. |
| Secret Manager           | No public access. Runtime service account gets only required `secretAccessor`.                                                                                              |
| Terraform state bucket   | Private forever. No runtime service account access.                                                                                                                         |
| Backup bucket            | Private forever.                                                                                                                                                            |
| Evidence bucket          | Private by default; share explicitly only when needed.                                                                                                                      |
| Cloud Run Jobs           | No public domain mapping. Trigger through Scheduler/IAM or operator `gcloud`.                                                                                               |
| Migration job            | No public domain mapping. Trigger only during release.                                                                                                                      |
| Backup/restore drill job | No public domain mapping. Trigger only during drill.                                                                                                                        |
| Internal job endpoints   | Prefer Cloud Run Jobs; if HTTP endpoints exist, require IAM or internal token.                                                                                              |

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
synapse-staging-docs-front
synapse-staging-gateway
synapse-staging-admin-front
synapse-staging-gateway-admin
synapse-staging-provider
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
  --service synapse-staging-docs-front \
  --domain docs-staging.synapse-network.ai

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

gcloud beta run domain-mappings create \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --service synapse-staging-provider \
  --domain provider-staging.synapse-network.ai
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
CNAME docs-staging.synapse-network.ai -> ghs.googlehosted.com
CNAME api-staging.synapse-network.ai -> ghs.googlehosted.com
CNAME admin-staging.synapse-network.ai -> ghs.googlehosted.com
CNAME admin-api-staging.synapse-network.ai -> ghs.googlehosted.com
CNAME provider-staging.synapse-network.ai -> ghs.googlehosted.com
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

### GoDaddy DNS Entry

If `synapse-network.ai` is managed in GoDaddy, add the Provider staging
subdomain as a CNAME record after the Cloud Run domain mapping exists:

```text
Type: CNAME
Name: provider-staging
Value: ghs.googlehosted.com
TTL: 600 seconds or GoDaddy default
```

Do not enter the full hostname in the `Name` field if GoDaddy already scopes the
record to `synapse-network.ai`; use `provider-staging`, not
`provider-staging.synapse-network.ai`. Before saving, remove any conflicting
`A`, `AAAA`, or `CNAME` record with the same `provider-staging` name.

GoDaddy path:

1. Open GoDaddy Domain Portfolio.
2. Select `synapse-network.ai`.
3. Open DNS / Manage DNS.
4. Add record.
5. Choose `CNAME`.
6. Set `Name = provider-staging`.
7. Set `Value = ghs.googlehosted.com`.
8. Save and wait for DNS propagation.

This follows GoDaddy's CNAME record flow and Cloud Run's custom domain mapping
flow: create the Cloud Run mapping first, then publish the DNS record shown by
Google.

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

gcloud run services update synapse-staging-docs-front \
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

gcloud run services update synapse-staging-provider \
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
NEXT_PUBLIC_DOCS_BASE_URL=https://docs-staging.synapse-network.ai
NEXT_PUBLIC_TX_EXPLORER_BASE_URL=https://sepolia.arbiscan.io
NEXT_PUBLIC_APP_ENV=staging
```

### Docs-front

```bash
NEXT_PUBLIC_APP_ENV=staging
NEXT_PUBLIC_DOCS_BASE_URL=https://docs-staging.synapse-network.ai
NEXT_PUBLIC_CONSOLE_BASE_URL=https://staging.synapse-network.ai/dashboard/overview
NEXT_PUBLIC_GATEWAY_BASE_URL=https://api-staging.synapse-network.ai
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
dig +short docs-staging.synapse-network.ai
dig +short api-staging.synapse-network.ai
dig +short admin-staging.synapse-network.ai
dig +short admin-api-staging.synapse-network.ai
dig +short provider-staging.synapse-network.ai
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
curl -I https://docs-staging.synapse-network.ai/
curl -fsS https://docs-staging.synapse-network.ai/llms.txt | sed -n '1,20p'
curl -I https://admin-staging.synapse-network.ai/
curl -i https://api-staging.synapse-network.ai/health
curl -i https://admin-api-staging.synapse-network.ai/health
curl -i https://provider-staging.synapse-network.ai/health
curl -i https://provider-staging.synapse-network.ai/ready
```

Expected:

- Frontend hosts return `200` or a Next.js redirect/status expected by the app.
- API `/health` returns `200`.
- Provider `/health` and `/ready` return `200`.
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

### Provider Runtime Access

Provider runtime is public only at the network layer. Business invocation still
goes through Gateway:

```text
Agent / SDK -> api-staging.synapse-network.ai -> gateway_signed -> provider-staging.synapse-network.ai
```

Verify the Provider service exists and capture its raw Cloud Run URL:

```bash
PROVIDER_RUN_URL="$(gcloud run services describe synapse-staging-provider \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(status.url)')"

printf '%s\n' "$PROVIDER_RUN_URL"
curl -i "$PROVIDER_RUN_URL/health"
curl -i "$PROVIDER_RUN_URL/ready"
```

Verify anonymous direct invoke is rejected:

```bash
curl -i -X POST \
  "https://provider-staging.synapse-network.ai/provider-services/web3-sentiment-index/invoke" \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"ETH"}'
```

Expected:

- DNS and TLS ready: no `Could not resolve host`, no certificate error.
- `/health` and `/ready`: `200`.
- `/docs` and `/openapi.json`: `404` or otherwise unavailable while
  `PROVIDER_PUBLIC_DOCS_ENABLED=false`.
- Unsigned `/provider-services/*/invoke`: application `401/403`.

After Provider onboarding, verify Gateway discovery sees Provider services:

```bash
curl -s https://api-staging.synapse-network.ai/api/v1/services/discover | jq
```

If discovery returns an empty service list, the Provider runtime may be healthy
but not registered or not visible through Gateway health/discovery policy. Run
the manual onboarding and GPP E2E jobs:

```bash
gcloud run jobs execute synapse-staging-provider-onboarding \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --wait

gcloud run jobs execute synapse-staging-provider-gpp-e2e \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --wait
```

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

| Symptom                                                                  | Likely cause                                        | Fix                                                                                         |
| ------------------------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `.run.app` returns Google Frontend `403` without token, `200` with token | Cloud Run invoker IAM check still enabled.          | Run `gcloud run services update <service> --no-invoker-iam-check`.                          |
| Custom domain TLS handshake fails                                        | Domain mapping or managed certificate not ready.    | Check `gcloud beta run domain-mappings describe <host>` and wait for certificate readiness. |
| Custom domain points to `ghs.googlehosted.com` but still fails           | DNS exists but Cloud Run mapping/cert not complete. | Verify the mapping exists in `us-central1` and wait for Google-managed cert.                |
| Browser gets CORS error                                                  | API CORS origin does not match frontend domain.     | Set Gateway/Gateway-admin CORS to the exact `https://...` frontend host.                    |
| API returns application `401/403`                                        | Network is open, app auth is denying request.       | Debug JWT/session/CSRF/MFA, not Cloud Run IAM.                                              |
| `/metrics` is reachable without token                                    | Security regression.                                | Require `METRICS_BEARER_TOKEN` and keep metrics off public dashboards.                      |

## Production Difference

Production can use the same shape, but with stricter review:

- Production Gateway may still be public because real users and agents call it.
- Production Docs-front uses `https://docs.synapse-network.ai` and
  `synapse-prod-docs-front`; it must not point at staging/testnet docs metadata.
- Production Admin-front/Admin API may require extra controls such as IAP,
  allowlisted operator accounts, or VPN/zero-trust access.
- Production must not reuse staging domains, secrets, Cloud SQL, contracts,
  wallets, or Lark routes.
- Production launch remains NO-GO until staging evidence and small-value
  production rehearsal evidence are complete.
