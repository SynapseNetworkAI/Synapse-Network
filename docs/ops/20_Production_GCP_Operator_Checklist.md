---
title: Production GCP Operator Checklist
status: active
owner: ops
last_reviewed: 2026-05-14
---

# Production GCP Operator Checklist

This checklist is the operator handoff for the production Google Cloud launch
substrate. It separates what the repository can provision automatically from
what still requires explicit human confirmation.

Use this together with:

1. [Google Cloud Launch Readiness](/Users/cliff/workspace/agent/Synapse-Network/docs/ops/15_Google_Cloud_Launch_Readiness.md)
2. [Production Go/No-Go Security Verification](/Users/cliff/workspace/agent/Synapse-Network/docs/ops/10_Production_Go_No_Go_Security_Verification.md)
3. [Validation Entry Points](/Users/cliff/workspace/agent/Synapse-Network/docs/reference/Validation_Entry_Points.md)

## 1. Repository-Automated Steps

These are the steps the repo now supports directly:

1. `bash scripts/deploy/gcp_preflight.sh --env prod --project <gcp-project-id>`
2. `cd infra/terraform/gcp-prod && terraform init && terraform plan`
3. `bash scripts/deploy/gcp_bootstrap.sh --env prod --project <gcp-project-id>`
4. `bash scripts/deploy/gcp_check_cloud_run_secret_versions.sh --env prod --project <gcp-project-id>`
5. `bash scripts/deploy/gcp_build_images.sh --env prod --project <gcp-project-id>`
6. `bash scripts/deploy/gcp_sync_jobs.sh --env prod --project <gcp-project-id> --service all --gateway-image <img> --gateway-admin-image <img>`
7. `GCP_ALERT_RECEIVER_TOKEN=<token> bash scripts/deploy/gcp_configure_alerts.sh --env prod --project <gcp-project-id> --receiver-url <gateway-admin-webhook-url>`

Terraform-backed automatic provisioning includes:

1. Artifact Registry
2. backup bucket
3. Cloud SQL instance and databases
4. Secret Manager placeholders
5. Cloud Run services and jobs
6. Scheduler jobs
7. Cloud Monitoring alert substrate
8. production VPC / subnet / private service networking / Serverless VPC Access connector
9. Cloud KMS key ring and asymmetric signer key
10. service accounts and baseline IAM bindings

## 2. Human-Confirmed Inputs

These values must be provided or confirmed by an operator:

1. production GCP project id
2. billing account attached to the production project
3. `backup_bucket_name`
4. `admin_invoker_group_email`
5. `gateway_admin_breakglass_group_email`
6. production domains:
   - `synapse-network.ai`
   - `api.synapse-network.ai`
   - `admin.synapse-network.ai`
   - `admin-api.synapse-network.ai`
   - `docs.synapse-network.ai`
7. production contract addresses:
   - `SynapseCore`
   - `USDC`
8. Safe treasury address
9. Ledger owner signer address
10. KMS crypto key resource id and derived Ethereum signer address

## 3. Secret Manager Values

Terraform creates placeholders. `bash scripts/deploy/gcp_bootstrap.sh --env prod --project <project>`
now also creates the minimum Cloud SQL users and writes the DSN secrets for:

- `synapse-prod-postgres-dsn`
- `synapse-prod-admin-database-dsn`
- `synapse-prod-admin-database-migration-dsn`
- `synapse-prod-gateway-readonly-dsn`
- `synapse-prod-gateway-forum-write-dsn`

Operators still add the remaining real external values with:

```bash
printf '%s' '<secret-value>' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-prod-<secret-id>
```

Bootstrap-managed production secrets:

1. `synapse-prod-postgres-password`
2. `synapse-prod-postgres-dsn`
3. `synapse-prod-postgres-migrator-password`
4. `synapse-prod-admin-postgres-password`
5. `synapse-prod-admin-database-dsn`
6. `synapse-prod-admin-database-migration-dsn`
7. `synapse-prod-gateway-readonly-dsn`
8. `synapse-prod-gateway-forum-write-dsn`

Repo-generated production secrets:

1. `synapse-prod-jwt-secret`
2. `synapse-prod-auth-secret`
3. `synapse-prod-gateway-internal-jwt-secret`
4. `synapse-prod-internal-trigger-secret`
5. `synapse-prod-admin-csrf-secret`
6. `synapse-prod-admin-totp-secret-encryption-key`
7. `synapse-prod-metrics-bearer-token`
8. `synapse-prod-gcp-alert-receiver-token`
9. `synapse-prod-alert-drill-token`

Operator-managed production secrets:

1. `synapse-prod-gateway-admin-wallet`
2. `synapse-prod-gmail-username`
3. `synapse-prod-gmail-app-password`
4. `synapse-prod-metrics-basic-username` if you want metrics Basic auth alongside bearer token
5. `synapse-prod-metrics-basic-password` if you want metrics Basic auth alongside bearer token
4. `synapse-prod-lark-webhook-p0`
5. `synapse-prod-lark-secret-p0`
6. `synapse-prod-lark-webhook-prod-alerts`
7. `synapse-prod-lark-secret-prod-alerts`
8. `synapse-prod-lark-webhook-staging-drill`
9. `synapse-prod-lark-secret-staging-drill`
10. `synapse-prod-arbitrum-one-rpc-url`
11. `synapse-prod-arbiscan-api-key`
12. `synapse-prod-deployer-private-key` only if you intentionally fall back to a raw hot-wallet deploy path instead of the default Ledger deploy path

Optional provider-service production secrets:

1. `synapse-prod-provider-signature-secret`
2. `synapse-prod-provider-postgres-dsn`
3. `synapse-prod-provider-onboarding-owner-private-key`
4. `synapse-prod-provider-etherscan-api-key`
5. `synapse-prod-provider-twitter-x-api-key`
6. `synapse-prod-provider-twitter-x-api-secret`
7. `synapse-prod-provider-twitter-x-api-bearer-token`
8. `synapse-prod-provider-deepseek-api-key`
9. `synapse-prod-provider-minio-access-key`
10. `synapse-prod-provider-minio-secret-key`

## 4. Admin Access Setup

Production admin access is Cloud Run IAM-based, not IAP-based.

Operators must:

1. create and maintain the production Google Group allowlist
2. ensure `admin-front` is the default operator entrypoint
3. keep `gateway-admin` direct access narrower than `admin-front`

Required production runtime settings:

```bash
NEXT_PUBLIC_ADMIN_API_BASE_URL=
ADMIN_API_PROXY_TARGET=https://admin-api.synapse-network.ai
ADMIN_API_PROXY_AUDIENCE=https://admin-api.synapse-network.ai
```

## 5. Private Cloud SQL Network Checks

Before launch, operators must confirm:

1. Cloud SQL has no public IPv4
2. Gateway uses VPC egress
3. Gateway-admin uses VPC egress
4. `synapse-prod-db-migrate` uses VPC egress
5. `synapse-prod-gateway-admin-db-migrate` uses VPC egress
6. migration jobs can reach Postgres without Cloud SQL Auth Proxy

## 6. KMS Custody Checks

Before launch, operators must verify:

1. `WITHDRAW_SIGNER_MODE=gcp_kms` in production
2. only `synapse-prod-gateway` runtime service account can sign with the KMS key
3. no human operator account has standing sign permission
4. `SynapseCore.platformSigner()` matches the KMS-derived Ethereum address

## 7. Final No-Go Gates

Do not mark production ready until these are attached:

1. production Terraform plan evidence
2. production deploy manifest
3. small-value real-chain rehearsal tx hashes
4. monitoring / alert drill evidence
5. rollback / restore / chaos evidence
6. production config review
7. four-owner sign-off
