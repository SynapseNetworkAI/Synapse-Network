---
title: Staging Environment Configuration
status: active
owner: ops
last_reviewed: 2026-04-23
---

# Staging Environment Configuration

This is the source of truth for Synapse staging environment configuration across
Google Cloud, Cloud Run, Secret Manager, frontend apps, Gateway services, and
Arbitrum Sepolia contract deployment.

## Domain Map

All public URLs must include `https://`.

| Service           | Public URL                                     | Purpose                       |
| ----------------- | ---------------------------------------------- | ----------------------------- |
| User-front        | `https://staging.synapse-network.ai`           | Consumer/provider web app.    |
| Docs-front        | `https://docs-staging.synapse-network.ai`      | Dedicated developer docs.     |
| Gateway API       | `https://api-staging.synapse-network.ai`       | User-facing Gateway API.      |
| Admin-front       | `https://admin-staging.synapse-network.ai`     | Operations/admin web console. |
| Gateway-admin API | `https://admin-api-staging.synapse-network.ai` | Admin/control-plane API.      |

DNS and TLS are configured outside the repo through Google Cloud custom domains
or a managed HTTPS load balancer. Do not point frontend code at bare hostnames
such as `api-staging.synapse-network.ai`; always use the full HTTPS URL.

For the exact Cloud Run domain mappings, public invoker settings, CORS checks,
and private network boundaries, use
`docs/ops/18_Staging_Domains_and_Network_Access.md`.

## Google Cloud Storage Buckets

Staging uses separate buckets by data sensitivity and lifecycle. Do not put
website assets, backup artifacts, release evidence, and Terraform state into one
bucket. Mixed buckets create IAM, public-access, retention, and incident-response
confusion.

Current staging project bucket names:

| Bucket                                                   | Purpose                                                                    | Public access                                            | Versioning | Lifecycle                                                                                         | Notes                                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `synapse-staging-static-assets-fabled-archive-494108-k5` | Optional public static assets bucket for future CDN-hosted website assets. | Private by default; can be made public/CDN-backed later. | Enabled    | Noncurrent object versions are deleted after 90 days.                                             | Not required for Cloud Run front-end deploys.                                  |
| `synapse-staging-backups-fabled-archive-494108-k5`       | Staging backup and restore drill artifacts.                                | Public access prevention enabled.                        | Optional   | Delete staging objects after 30 days.                                                             | Never store public website assets here.                                        |
| `synapse-staging-evidence-fabled-archive-494108-k5`      | Release evidence, E2E reports, traces, and audit proof.                    | Public access prevention enabled.                        | Optional   | Release evidence is retained up to 365 days; debug/failed/tmp prefixes are deleted after 30 days. | Contains private operational evidence; do not make public.                     |
| `synapse-terraform-state-fabled-archive-494108-k5`       | Terraform remote state.                                                    | Public access prevention enabled.                        | Enabled    | Live state is retained; noncurrent state versions are deleted after 365 days.                     | Highest-sensitivity infra state bucket; runtime services should not access it. |

Creation status:

- Created in project `fabled-archive-494108-k5` on 2026-04-23.
- Created through `scripts/deploy/gcp_create_staging_buckets.sh`.
- Safety settings applied: uniform bucket-level access, public access prevention
  for private buckets, versioning where required, and lifecycle policies.
- These buckets are not secrets, but `backups`, `evidence`, and
  `terraform-state` must remain private forever.
- Reapply lifecycle and Artifact Registry cleanup policies with:
  `bash scripts/deploy/gcp_apply_staging_cost_controls.sh fabled-archive-494108-k5`.

## Staging Storage Cost Controls

Current storage cost posture:

- GCS buckets are intentionally cheap and lifecycle-managed. Terraform state is
  not short-lived; only old object versions are cleaned after 365 days.
- Release evidence is kept long enough for staging audit/debug history. Failed,
  debug, or temporary evidence should go under `debug/`, `failed/`, `tmp/`,
  `staging/debug/`, `staging/failed/`, or `deployments/failed/` so it expires
  after 30 days.
- Artifact Registry is the resource that grows fastest because every deploy can
  add large image layers.

Artifact Registry cleanup policy for `synapse-staging`:

| Policy                                 | Action | Scope                                                                  |
| -------------------------------------- | ------ | ---------------------------------------------------------------------- |
| `delete-untagged-older-than-7d`        | Delete | Untagged image versions older than 7 days.                             |
| `delete-staging-tagged-older-than-45d` | Delete | Tags starting with `staging-` older than 45 days.                      |
| `keep-promoted-release-tags`           | Keep   | Tags starting with `prod-`, `production-`, `promoted-`, or `release-`. |
| `keep-recent-10-per-package`           | Keep   | The 10 newest versions per image package for rollback.                 |

Apply or refresh the live policy:

```bash
export PROJECT_ID=fabled-archive-494108-k5
gcloud config set project "$PROJECT_ID"

bash scripts/deploy/gcp_apply_staging_cost_controls.sh "$PROJECT_ID"
```

To test the Artifact Registry cleanup policy without deleting candidates:

```bash
SYNAPSE_ARTIFACT_CLEANUP_DRY_RUN=1 \
  bash scripts/deploy/gcp_apply_staging_cost_controls.sh fabled-archive-494108-k5
```

Verify:

```bash
gcloud artifacts repositories describe synapse-staging \
  --project=fabled-archive-494108-k5 \
  --location=us-central1 \
  --format=json

gsutil lifecycle get gs://synapse-staging-evidence-fabled-archive-494108-k5
gsutil lifecycle get gs://synapse-terraform-state-fabled-archive-494108-k5
```

Creation commands:

```bash
PROJECT_ID=fabled-archive-494108-k5
REGION=us-central1

gcloud storage buckets create gs://synapse-staging-static-assets-$PROJECT_ID \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --uniform-bucket-level-access

gcloud storage buckets create gs://synapse-staging-backups-$PROJECT_ID \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --uniform-bucket-level-access \
  --public-access-prevention

gcloud storage buckets create gs://synapse-staging-evidence-$PROJECT_ID \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --uniform-bucket-level-access \
  --public-access-prevention

gcloud storage buckets create gs://synapse-terraform-state-$PROJECT_ID \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --uniform-bucket-level-access \
  --public-access-prevention
```

Preferred automated setup after `gcloud auth login`:

```bash
gcloud config set project fabled-archive-494108-k5
scripts/deploy/gcp_create_staging_buckets.sh fabled-archive-494108-k5
```

Website image assets are not required for MVP staging infrastructure. Next.js
front-end images inside `public/` are shipped inside the front-end container when
Cloud Run deploys `user_front_image` or `admin_front_image`. Use the
`static-assets` bucket only later if we intentionally move heavy public assets
behind GCS/CDN.

Only `static-assets` may ever receive public-read or CDN configuration. Keep
`backups`, `evidence`, and `terraform-state` private forever.

## Next Staging Configuration Order

After the buckets exist, configure staging in this order. Do not skip ahead to
production or contract deployment before the substrate is stable.

1. Configure Terraform backend/state.
   - Use bucket: `synapse-terraform-state-fabled-archive-494108-k5`.
   - Store only Terraform state here.
   - Do not grant runtime Cloud Run services access to this bucket.
   - Backend is configured in `infra/terraform/gcp-staging/versions.tf`.
   - Run `terraform init -reconfigure` after pulling the backend config.
2. Create local Terraform tfvars.
   - File: `infra/terraform/gcp-staging/terraform.tfvars`.
   - Required bucket value:
     `backup_bucket_name = "synapse-staging-backups-fabled-archive-494108-k5"`.
   - Leave `gateway_image`, `gateway_admin_image`, `user_front_image`,
     `docs_front_image`, and `admin_front_image` empty for the first
     substrate-only apply.
3. Run Terraform for substrate resources.
   - Artifact Registry.
   - Cloud SQL.
   - Secret Manager placeholders.
   - Service accounts and IAM.
   - Cloud Run service/job shells.
4. Run bootstrap.
   - `bash scripts/deploy/gcp_staging_bootstrap.sh`.
   - This creates/updates the Cloud SQL app user and migrator user.
   - It writes `synapse-staging-postgres-password` and
     `synapse-staging-postgres-migrator-password`.
5. Write user-provided secrets with `gcp_put_secret.sh`.
   - JWT/auth/internal secrets.
   - Lark webhooks and optional Lark signing secrets.
   - Gmail username/app password.
   - Arbitrum Sepolia RPC URL and Etherscan API V2 verification key.
   - Staging deployer and withdraw signer private keys.
6. Run the Cloud Run secret-version preflight.
   - `bash scripts/deploy/gcp_check_staging_cloud_run_secret_versions.sh fabled-archive-494108-k5`.
   - Do this before setting image variables or applying Cloud Run changes.
   - This prevents `secret:latest` revision failures from half-updating staging.
7. Build and push container images to Artifact Registry.
   - Then set the five `*_image` Terraform variables or deploy through
     `gcloud run deploy` for the first smoke.
   - Recommended: use
     `bash scripts/deploy/gcp_cloudbuild_staging_images.sh fabled-archive-494108-k5`
     so Google Cloud Build performs the CPU/memory-heavy Next.js builds on a
     Linux builder.
   - Fallback: use `bash scripts/deploy/gcp_build_staging_images.sh fabled-archive-494108-k5`
     only when local Docker has enough memory.
8. Configure DNS and TLS.
   - `staging.synapse-network.ai`.
   - `docs-staging.synapse-network.ai`.
   - `api-staging.synapse-network.ai`.
   - `admin-staging.synapse-network.ai`.
   - `admin-api-staging.synapse-network.ai`.
9. Deploy Arbitrum Sepolia staging contracts.
   - Run dry-run first.
   - Deploy owner-only `MockUSDC` and `SynapseCore`.
   - Produce contract deployment evidence.
10. Inject deployed contract addresses into Gateway staging.
    - `ROUTER_ADDRESS`.
    - `USDC_TOKEN_ADDRESS`.
11. Run smoke and release evidence.
    - Health checks.
    - Lark E2E.
    - One-ticket withdrawal evidence.
    - Gateway full-chain staging evidence.
    - Staging core dogfood evidence.

## Terraform Inputs

Local file: `infra/terraform/gcp-staging/terraform.tfvars`. Do not commit it.

| Variable                                   | Example                                                                    | Purpose                                                                                                               | Secret | Source                           | Location         |
| ------------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------- | ---------------- |
| `project_id`                               | `synapse-staging-123`                                                      | Google Cloud project id.                                                                                              | No     | GCP project                      | Terraform tfvars |
| `region`                                   | `us-central1`                                                              | Cloud Run, Cloud SQL, Artifact Registry region.                                                                       | No     | Ops decision                     | Terraform tfvars |
| `environment`                              | `staging`                                                                  | Resource name/env label.                                                                                              | No     | Fixed                            | Terraform tfvars |
| `backup_bucket_name`                       | `synapse-staging-backups-<unique>`                                         | GCS bucket for backup/evidence artifacts.                                                                             | No     | Ops-created globally unique name | Terraform tfvars |
| `artifact_registry_repository`             | `synapse-staging`                                                          | Docker image repository.                                                                                              | No     | Fixed                            | Terraform tfvars |
| `cloud_sql_tier`                           | `db-f1-micro`                                                              | Low-cost Cloud SQL starting tier.                                                                                     | No     | Ops decision                     | Terraform tfvars |
| `cloud_sql_edition`                        | `ENTERPRISE`                                                               | Required Cloud SQL edition for shared-core tiers such as `db-f1-micro`; do not use `ENTERPRISE_PLUS` for MVP staging. | No     | Fixed                            | Terraform tfvars |
| `cloud_sql_database_name`                  | `synapse_gateway_staging`                                                  | Gateway database name.                                                                                                | No     | Fixed                            | Terraform tfvars |
| `cloud_sql_backup_start_time`              | `19:00`                                                                    | UTC backup time; equals 03:00 Asia/Kuala_Lumpur.                                                                      | No     | Fixed                            | Terraform tfvars |
| `cloud_sql_transaction_log_retention_days` | `1`                                                                        | Staging PITR log retention.                                                                                           | No     | Fixed                            | Terraform tfvars |
| `gateway_image`                            | `us-central1-docker.pkg.dev/<project>/synapse-staging/gateway:<tag>`       | Gateway Cloud Run image.                                                                                              | No     | Artifact Registry                | Terraform tfvars |
| `gateway_admin_image`                      | `us-central1-docker.pkg.dev/<project>/synapse-staging/gateway-admin:<tag>` | Gateway-admin Cloud Run image.                                                                                        | No     | Artifact Registry                | Terraform tfvars |
| `user_front_image`                         | `us-central1-docker.pkg.dev/<project>/synapse-staging/user-front:<tag>`    | User-front Cloud Run image.                                                                                           | No     | Artifact Registry                | Terraform tfvars |
| `docs_front_image`                         | `us-central1-docker.pkg.dev/<project>/synapse-staging/docs-front:<tag>`    | Docs-front Cloud Run image.                                                                                           | No     | Artifact Registry                | Terraform tfvars |
| `admin_front_image`                        | `us-central1-docker.pkg.dev/<project>/synapse-staging/admin-front:<tag>`   | Admin-front Cloud Run image.                                                                                          | No     | Artifact Registry                | Terraform tfvars |

Leave image variables empty for the first substrate-only Terraform apply. Set
them once images are pushed to Artifact Registry.

These `*_image` values are Docker/OCI container image URLs for Cloud Run. They
are not PNG/JPG/SVG website images.

Recommended build path: Cloud Build. This avoids local Mac ARM to Linux amd64
emulation and prevents Next.js production builds from being killed by local
Docker memory pressure.

```bash
bash scripts/deploy/gcp_cloudbuild_staging_images.sh fabled-archive-494108-k5
```

This script defaults to `STAGING_IMAGE_BUILD_BACKEND=cloudbuild` and emits
`--platform linux/amd64` in generated Docker build steps. Do not deploy
locally-built Apple Silicon / arm64 images to Cloud Run; they fail at startup
with `exec format error`.

Fallback local Docker build:

```bash
bash scripts/deploy/gcp_build_staging_images.sh fabled-archive-494108-k5
```

Both scripts print a ready-to-paste `terraform.tfvars` block:

```hcl
gateway_image       = "us-central1-docker.pkg.dev/fabled-archive-494108-k5/synapse-staging/gateway:<tag>"
gateway_admin_image = "us-central1-docker.pkg.dev/fabled-archive-494108-k5/synapse-staging/gateway-admin:<tag>"
user_front_image    = "us-central1-docker.pkg.dev/fabled-archive-494108-k5/synapse-staging/user-front:<tag>"
docs_front_image    = "us-central1-docker.pkg.dev/fabled-archive-494108-k5/synapse-staging/docs-front:<tag>"
admin_front_image   = "us-central1-docker.pkg.dev/fabled-archive-494108-k5/synapse-staging/admin-front:<tag>"
```

Manual equivalent:

```bash
export PROJECT_ID=fabled-archive-494108-k5
export REGION=us-central1
export REPO=synapse-staging
export TAG=staging-$(date -u +%Y-%m-%d-%H%M%S)
export REGISTRY=${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}

gcloud auth configure-docker ${REGION}-docker.pkg.dev

docker build --platform linux/amd64 -t ${REGISTRY}/gateway:${TAG} services/gateway
docker push ${REGISTRY}/gateway:${TAG}

docker build --platform linux/amd64 -f services/gateway-admin/Dockerfile -t ${REGISTRY}/gateway-admin:${TAG} .
docker push ${REGISTRY}/gateway-admin:${TAG}

docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_GATEWAY_BASE_URL=https://api-staging.synapse-network.ai \
  --build-arg NEXT_PUBLIC_APP_ENV=staging \
  --build-arg CONTRACT_CONFIG_SOURCE=src/contract-config.arbitrum-sepolia.example.json \
  -t ${REGISTRY}/user-front:${TAG} \
  services/user-front
docker push ${REGISTRY}/user-front:${TAG}

docker build --platform linux/amd64 \
  -t ${REGISTRY}/docs-front:${TAG} \
  services/docs-front
docker push ${REGISTRY}/docs-front:${TAG}

docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_ADMIN_API_BASE_URL=https://admin-api-staging.synapse-network.ai \
  --build-arg ADMIN_API_PROXY_TARGET=https://admin-api-staging.synapse-network.ai \
  --build-arg NEXT_PUBLIC_APP_ENV=staging \
  -t ${REGISTRY}/admin-front:${TAG} \
  services/admin-front
docker push ${REGISTRY}/admin-front:${TAG}
```

If a Cloud Run service was created manually before Terraform owns it, import it
before setting its image variable and applying Terraform:

```bash
terraform -chdir=infra/terraform/gcp-staging import \
  'google_cloud_run_v2_service.services["gateway"]' \
  projects/fabled-archive-494108-k5/locations/us-central1/services/synapse-staging-gateway
```

## Secret Manager

V1 uses Google Cloud Secret Manager with default Google-managed encryption at
rest. Staging does not use Cloud KMS / CMEK for Secret Manager envelope
encryption.

Gateway withdrawal ticket signing is separate: staging uses the dedicated Cloud
KMS asymmetric key `synapse-staging-withdraw-signer`. Gateway services/jobs must
not receive a runtime `PRIVATE_KEY` or `synapse-staging-private-key` after KMS
withdrawal evidence is green.

Write secret values with:

```bash
printf '%s' '<secret-value>' | \
  bash scripts/deploy/gcp_put_secret.sh <synapse-staging-secret-id>
```

Never put secret values in Terraform variables, git, screenshots, evidence, or
shell command arguments.

### Secret Manager Write Command Cheat Sheet

Always pin the project before writing staging secrets:

```bash
export PROJECT_ID=fabled-archive-494108-k5
gcloud config set project "$PROJECT_ID"
```

EVM private keys must come from dedicated staging wallets. Do not generate them
with `openssl rand`, and do not reuse personal, treasury, or production wallets.
These are deployment-only or E2E-only keys; the Gateway withdrawal signer is KMS.

```bash
printf '%s' '0xYOUR_STAGING_DEPLOYER_PRIVATE_KEY' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-deployer-private-key

printf '%s' '0xYOUR_STAGING_GAS_FUNDER_PRIVATE_KEY' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-gas-funder-private-key
```

E2E-only wallet keys are also EVM private keys. They are used by staging
full-chain automation and must not be injected into Gateway runtime:

```bash
printf '%s' '0xYOUR_STAGING_E2E_CONSUMER_PRIVATE_KEY' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-e2e-consumer-private-key

printf '%s' '0xYOUR_STAGING_E2E_PROVIDER_PRIVATE_KEY' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-e2e-provider-private-key
```

Admin dogfood credentials are only for the dedicated staging admin test account.
Do not use a real operator password for these secrets:

```bash
printf '%s' 'YOUR_STAGING_ADMIN_E2E_PASSWORD' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-admin-e2e-password

printf '%s' 'YOUR_STAGING_ADMIN_E2E_TOTP_SECRET' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-admin-e2e-otp-secret
```

If you do not know the staging admin E2E password, reset the dedicated test
account instead of guessing or reusing a real operator account:

```bash
bash scripts/deploy/gcp_reset_staging_admin_e2e.sh fabled-archive-494108-k5
```

### Staging Withdrawal Signer KMS

Terraform creates the staging withdrawal signer key:

```text
projects/fabled-archive-494108-k5/locations/us-central1/keyRings/synapse-staging/cryptoKeys/synapse-staging-withdraw-signer/cryptoKeyVersions/1
```

Derive the Ethereum address from the KMS public key before enabling Gateway KMS
signing:

```bash
node scripts/chain/gcp_kms_derive_eth_address.mjs \
  projects/fabled-archive-494108-k5/locations/us-central1/keyRings/synapse-staging/cryptoKeys/synapse-staging-withdraw-signer/cryptoKeyVersions/1
```

Then set `withdraw_signer_address` in the staging Terraform variables and rotate
`SynapseCore.platformSigner()` to the same address with the owner/Safe-controlled
flow. Do not deploy Gateway with `WITHDRAW_SIGNER_MODE=gcp_kms` until
`SynapseCore.platformSigner()` and `WITHDRAW_SIGNER_ADDRESS` match.

Audit and cleanup are separate:

```bash
gcloud auth login
gcloud config set project fabled-archive-494108-k5
bash scripts/deploy/gcp_audit_staging_security_config.sh fabled-archive-494108-k5
```

Delete the legacy `synapse-staging-private-key` only after the audit proves zero
Cloud Run references and a KMS withdrawal E2E report proves signing works:

```bash
STAGING_SECURITY_CLEANUP_CONFIRM=I_UNDERSTAND_THIS_DELETES_STAGING_SECURITY_RESOURCES \
STAGING_LEGACY_WITHDRAW_SECRET_TERRAFORM_DISABLED=1 \
STAGING_SECURITY_AUDIT_REPORT=output/security/staging-config-audit/<timestamp>/report.json \
STAGING_KMS_WITHDRAWAL_E2E_REPORT=<withdrawal-e2e-report.json> \
  bash scripts/deploy/gcp_cleanup_staging_security_config.sh fabled-archive-494108-k5
```

The reset script:

- generates a new strong password unless `STAGING_ADMIN_E2E_PASSWORD` is set;
- generates a new Google Authenticator-compatible TOTP seed unless
  `STAGING_ADMIN_E2E_OTP_SECRET` is set;
- writes both values to Secret Manager;
- resets `staging-admin-e2e@synapse-network.ai` in the Gateway-admin staging DB;
- revokes old sessions and old active TOTP factors for that test account.

The TOTP secret is not a Google login link and does not expire like a magic
link. It is the manual key that Google Authenticator stores. The six-digit OTP
codes generated from it expire every 30 seconds. To rotate the manual key, run
the reset script again.

Gmail staging uses SMTP app password or Workspace SMTP relay. The Gmail API is
not required for V1 email delivery.

```bash
printf '%s' 'staging-alerts@synapse-network.ai' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-gmail-username

printf '%s' 'YOUR_GMAIL_APP_PASSWORD_OR_RELAY_CREDENTIAL' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-gmail-app-password
```

Lark webhook URLs are required for Lark E2E. Lark signing secrets are required
only when the bot has signing validation enabled. If the bot uses keyword-only
validation, leave `synapse-staging-lark-secret-*` unset.

```bash
printf '%s' 'https://open.larksuite.com/open-apis/bot/v2/hook/...' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-lark-webhook-p0

printf '%s' 'https://open.larksuite.com/open-apis/bot/v2/hook/...' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-lark-webhook-prod-alerts

printf '%s' 'https://open.larksuite.com/open-apis/bot/v2/hook/...' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-lark-webhook-staging-drill
```

GCP Monitoring must call gateway-admin, not the raw Lark webhook. Generate the
receiver token and staging drill token locally, then store them in Secret
Manager:

```bash
openssl rand -base64 48 | tr -d '\n' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-gcp-alert-receiver-token

openssl rand -base64 48 | tr -d '\n' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-alert-drill-token
```

Before wiring the real GCP channel, verify the receiver and drill behavior with
the local fake-Lark E2E:

```bash
npm run e2e:gcp-alerts:local
npm run ci:gcp-alerts-local-evidence
```

This local command does not read Google Secret Manager and does not send real
Lark messages. It proves the gateway-admin receiver auth, card redaction, Lark
failure handling, and the Gateway 500 drill safety switches before staging gets
touched.

Application secrets and ops bearer tokens can be generated locally with strong
randomness:

```bash
openssl rand -base64 48 | tr -d '\n' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-jwt-secret

openssl rand -base64 48 | tr -d '\n' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-auth-secret

openssl rand -base64 48 | tr -d '\n' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-gateway-internal-jwt-secret

openssl rand -base64 48 | tr -d '\n' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-admin-csrf-secret

openssl rand -base64 48 | tr -d '\n' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-metrics-bearer-token
```

Third-party values must come from the provider dashboard:

```bash
printf '%s' 'https://arb-sepolia.g.alchemy.com/v2/YOUR_KEY' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-arbitrum-sepolia-rpc-url

printf '%s' 'YOUR_ETHERSCAN_V2_API_KEY' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-arbiscan-api-key
```

Production must use a separate project, helper, mailbox, wallet set, and secret
id prefix. Never reuse staging Gmail, Lark, signer, deployer, or gas funder
secrets for production.

| Secret id                                      | Purpose                                                                                                                                                                              | Used by                                 | Source                                                                     | Required before                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------- | ------------------------------ |
| `synapse-staging-postgres-password`            | Cloud SQL Gateway app user password.                                                                                                                                                 | Gateway, Gateway jobs                   | Auto-generated by `gcp_staging_bootstrap.sh`                               | Gateway deploy                 |
| `synapse-staging-postgres-dsn`                 | Gateway full Cloud SQL Unix-socket Postgres DSN. Prefer this on Cloud Run so psycopg connects through `/cloudsql/<project>:<region>:<instance>` without app-side URL reconstruction. | Gateway, Gateway jobs, staging E2E      | Auto-generated by `gcp_staging_bootstrap.sh` from the Gateway app password | Gateway deploy / Gmail E2E     |
| `synapse-staging-postgres-migrator-password`   | Cloud SQL Gateway migrator user password.                                                                                                                                            | DB migration job / release deploy shell | Auto-generated by `gcp_staging_bootstrap.sh`                               | DB migration                   |
| `synapse-staging-admin-postgres-password`      | Gateway-admin control-plane DB password.                                                                                                                                             | Gateway-admin                           | Auto-generated by `gcp_staging_bootstrap.sh`                               | Gateway-admin deploy           |
| `synapse-staging-admin-database-dsn`           | Gateway-admin control-plane full Postgres DSN.                                                                                                                                       | Gateway-admin                           | Auto-generated by `gcp_staging_bootstrap.sh`                               | Gateway-admin deploy           |
| `synapse-staging-admin-database-migration-dsn` | Gateway-admin migrator full Postgres DSN.                                                                                                                                            | Admin migration job / deploy shell      | Auto-generated by `gcp_staging_bootstrap.sh`                               | Gateway-admin migration        |
| `synapse-staging-gateway-readonly-dsn`         | Gateway read-only full Postgres DSN for admin projections.                                                                                                                           | Gateway-admin                           | Auto-generated by `gcp_staging_bootstrap.sh`                               | Admin finance views            |
| `synapse-staging-gateway-forum-write-dsn`      | Gateway app write DSN for forum/support write-through.                                                                                                                               | Gateway-admin                           | Auto-generated by `gcp_staging_bootstrap.sh`                               | Forum/support writes           |
| `synapse-staging-jwt-secret`                   | Signs/verifies user-facing Gateway JWTs.                                                                                                                                             | Gateway                                 | User-generated 32+ byte secret                                             | Gateway deploy                 |
| `synapse-staging-auth-secret`                  | Wallet challenge/session auth secret.                                                                                                                                                | Gateway                                 | User-generated 32+ byte secret                                             | Gateway deploy                 |
| `synapse-staging-withdraw-signer`              | Cloud KMS asymmetric signer for Gateway withdrawal tickets.                                                                                                                          | Gateway                                 | Terraform KMS resource + derived Ethereum address                          | Withdrawal ticket tests        |
| `synapse-staging-private-key`                  | Legacy Gateway withdrawal signer private key. Cleanup-only after KMS evidence is green; must not be injected into Gateway.                                                           | None after KMS migration                | Legacy staging signer wallet                                               | Cleanup audit only             |
| `synapse-staging-gateway-internal-jwt-secret`  | Gateway-admin to Gateway internal service-token secret.                                                                                                                              | Gateway, Gateway-admin                  | User-generated 32+ byte secret                                             | Admin actions                  |
| `synapse-staging-admin-csrf-secret`            | Gateway-admin CSRF/session protection secret.                                                                                                                                        | Gateway-admin                           | User-generated 32+ byte secret                                             | Admin login                    |
| `synapse-staging-gateway-admin-wallet`         | Internal admin wallet subject/allow-list identity.                                                                                                                                   | Gateway, Gateway-admin                  | Dedicated staging admin wallet address                                     | Admin actions                  |
| `synapse-staging-gmail-username`               | Gmail/Workspace sender username.                                                                                                                                                     | Email worker                            | Google Workspace mailbox                                                   | Email E2E                      |
| `synapse-staging-gmail-app-password`           | Gmail app password or SMTP relay credential.                                                                                                                                         | Email worker                            | Google Workspace                                                           | Email E2E                      |
| `synapse-staging-lark-webhook-p0`              | P0 Lark war-room webhook URL.                                                                                                                                                        | Lark E2E / alert relay                  | Lark bot                                                                   | Lark E2E                       |
| `synapse-staging-lark-webhook-prod-alerts`     | Production-alert-hall style webhook used for staging route tests.                                                                                                                    | Lark E2E / alert relay                  | Lark bot                                                                   | Lark E2E                       |
| `synapse-staging-lark-webhook-staging-drill`   | Drill-only Lark webhook URL.                                                                                                                                                         | Lark E2E / alert relay                  | Lark bot                                                                   | Lark E2E                       |
| `synapse-staging-lark-secret-p0`               | Optional P0 Lark signing secret.                                                                                                                                                     | Lark relay                              | Lark bot config                                                            | Only if signing is enabled     |
| `synapse-staging-lark-secret-prod-alerts`      | Optional prod-alerts Lark signing secret.                                                                                                                                            | Lark relay                              | Lark bot config                                                            | Only if signing is enabled     |
| `synapse-staging-lark-secret-staging-drill`    | Optional drill Lark signing secret.                                                                                                                                                  | Lark relay                              | Lark bot config                                                            | Only if signing is enabled     |
| `synapse-staging-gcp-alert-receiver-token`     | Gateway-admin receiver token for GCP Monitoring webhook delivery.                                                                                                                    | Gateway-admin                           | User-generated token                                                       | GCP alert channel              |
| `synapse-staging-alert-drill-token`            | Gateway controlled HTTP 500 drill token.                                                                                                                                             | Gateway                                 | User-generated token                                                       | Staging alert drill            |
| `synapse-staging-arbitrum-sepolia-rpc-url`     | Arbitrum Sepolia RPC URL.                                                                                                                                                            | Gateway, Hardhat deploy/evidence        | Alchemy/Infura/other RPC provider                                          | Contract deploy                |
| `synapse-staging-arbiscan-api-key`             | Etherscan API V2-compatible key used for Arbitrum Sepolia source verification. The old secret id is kept for compatibility.                                                          | Hardhat verify                          | Etherscan account                                                          | Contract deploy                |
| `synapse-staging-deployer-private-key`         | Staging contract deployer private key.                                                                                                                                               | Contract deploy only                    | Dedicated staging deployer wallet                                          | Contract deploy                |
| `synapse-staging-gas-funder-private-key`       | Optional operator-only gas funder private key used to top up deployer/consumer/provider wallets.                                                                                     | Local wallet utility only               | Dedicated staging gas funder wallet                                        | Optional wallet top-up         |
| `synapse-staging-e2e-consumer-private-key`     | Dedicated consumer wallet private key for staging full-chain E2E only.                                                                                                               | Local/release E2E runner                | Dedicated staging E2E consumer wallet                                      | Gateway full-chain staging E2E |
| `synapse-staging-e2e-provider-private-key`     | Dedicated provider wallet private key for staging full-chain E2E only.                                                                                                               | Local/release E2E runner                | Dedicated staging E2E provider wallet                                      | Gateway full-chain staging E2E |
| `synapse-staging-admin-e2e-password`           | Dedicated staging admin dogfood password.                                                                                                                                            | Admin-front dogfood runner              | Test admin account setup                                                   | Admin-front staging dogfood    |
| `synapse-staging-admin-e2e-otp-secret`         | Dedicated staging admin dogfood TOTP seed.                                                                                                                                           | Admin-front dogfood runner              | Test admin MFA enrollment                                                  | Admin-front staging dogfood    |
| `synapse-staging-metrics-bearer-token`         | Internal `/metrics` scrape bearer token.                                                                                                                                             | Gateway, Gateway-admin                  | User-generated token                                                       | Monitoring                     |

### Secret Value Presence Check

This check confirms that each staging Secret Manager placeholder has at least
one enabled version. It never prints secret values.

```bash
PROJECT_ID=fabled-archive-494108-k5
for s in $(gcloud secrets list --project="$PROJECT_ID" --filter='name:synapse-staging-' --format='value(name)' | sed 's#projects/.*/secrets/##' | sort); do
  latest="$(gcloud secrets versions list "$s" --project="$PROJECT_ID" --filter='state:ENABLED' --sort-by='~createTime' --limit=1 --format='value(name)' 2>/dev/null || true)"
  if [ -n "$latest" ]; then
    printf '%-58s %s\n' "$s" "has-enabled-version"
  else
    printf '%-58s %s\n' "$s" "missing-enabled-version"
  fi
done
```

Before any Terraform apply or `gcloud run deploy` that updates Cloud Run
services/jobs, run the Cloud Run secret-version preflight:

```bash
bash scripts/deploy/gcp_check_staging_cloud_run_secret_versions.sh fabled-archive-494108-k5
```

This is a hard deployment gate. Terraform can create Secret Manager
placeholders, but Cloud Run resolves `secret:latest` while creating a revision
or job. If the placeholder exists without an enabled version, Cloud Run rejects
the revision and Terraform can fail after other resources were already updated.

If the preflight fails:

1. Add the missing value with `scripts/deploy/gcp_put_secret.sh` or rerun
   `scripts/deploy/gcp_staging_bootstrap.sh` for generated database secrets.
2. Rerun the preflight until every Cloud Run referenced secret prints `[ok]`.
3. Only then run `terraform -chdir=infra/terraform/gcp-staging apply`.

If a previous failed apply left a Cloud Run Job tainted, do not approve a plan
that destroys the job while deletion protection is still blocking replacement.
After the missing secret versions are fixed, clear the failed taint and let
Terraform converge normally:

```bash
terraform -chdir=infra/terraform/gcp-staging untaint \
  'google_cloud_run_v2_job.jobs["gateway_admin_db_migrate"]'
terraform -chdir=infra/terraform/gcp-staging plan
terraform -chdir=infra/terraform/gcp-staging apply
```

Secret Manager having a value does not mean Cloud Run is using it. Runtime
services and jobs must explicitly inject each secret as an environment variable.
For Gmail delivery, Gateway and `synapse-staging-notification-outbox-drain`
must expose:

- `GMAIL_SMTP_USERNAME` from `synapse-staging-gmail-username`
- `GMAIL_SMTP_APP_PASSWORD` from `synapse-staging-gmail-app-password`
- `POSTGRES_DSN` from `synapse-staging-postgres-dsn`
- `EMAIL_FROM=Synapse Network Staging <staging-alerts@synapse-network.ai>`
- `EMAIL_REPLY_TO=support@synapse-network.ai`
- `PUBLIC_GATEWAY_BASE_URL=https://api-staging.synapse-network.ai` for API
  references used in transactional email metadata.
- `PUBLIC_APP_BASE_URL=https://staging.synapse-network.ai` for user-facing email
  CTA links such as `Open Synapse`.
- `TRANSACTION_LARK_ENABLED=true` in staging only.
- `TRANSACTION_LARK_WEBHOOK_URL` from
  `synapse-staging-lark-webhook-staging-drill`.
- `TRANSACTION_LARK_SECRET` from `synapse-staging-lark-secret-staging-drill`
  only when the Lark bot has signing enabled.
- `SUPPORT_LARK_ENABLED=true` in staging only when support case triage cards
  should be sent.
- `SUPPORT_LARK_WEBHOOK_URL` from
  `synapse-staging-lark-webhook-staging-drill` for staging, or a dedicated
  support triage group for production.
- `SUPPORT_LARK_SECRET` from the matching Lark signing secret only when that
  bot has signing enabled.

Local transaction notification E2E has two modes:

- Default local mode uses fake delivery sinks and does not send real Gmail or
  real Lark.
- `local-real` mode sends real local Gmail SMTP and real Lark. Put private
  values in `services/gateway/.env.local.private` or shell exports; do not put
  real app passwords, webhook URLs, or signing secrets in tracked files.

Put the non-secret local defaults in `services/gateway/.env.local` or the local
startup script:

```bash
EMAIL_OUTBOX_ENABLED=true
EMAIL_TRANSPORT=gmail_smtp
EMAIL_FROM='Synapse Network Local <local@synapse.test>'
EMAIL_REPLY_TO='support@synapse-network.ai'
PUBLIC_GATEWAY_BASE_URL=http://127.0.0.1:8000
PUBLIC_APP_BASE_URL=http://127.0.0.1:3000

TRANSACTION_LARK_ENABLED=true
TRANSACTION_LARK_WEBHOOK_URL=http://127.0.0.1:<fake-lark-port>/lark
TRANSACTION_LARK_SECRET=
TRANSACTION_LARK_TIMEOUT_SEC=3
SUPPORT_LARK_ENABLED=true
SUPPORT_LARK_WEBHOOK_URL=http://127.0.0.1:<fake-lark-port>/lark
SUPPORT_LARK_SECRET=
SUPPORT_LARK_TIMEOUT_SEC=3

POSTGRES_DSN=postgresql://synapse_gateway_app:local-dev-gateway-app-password@localhost:5432/synapse_gateway
JWT_SECRET=replace-this-with-a-32-byte-minimum-jwt-secret
AUTH_SECRET=replace-this-with-a-32-byte-minimum-auth-secret
```

For real local delivery, add the private values outside Git:

```bash
cat > services/gateway/.env.local.private <<'EOF'
GMAIL_SMTP_USERNAME=<gmail-or-workspace-sender>
GMAIL_SMTP_APP_PASSWORD=<16-char-app-password-no-spaces>
EMAIL_FROM='Synapse Network Local <sender@example.com>'
EMAIL_REPLY_TO=support@synapse-network.ai
PUBLIC_APP_BASE_URL=http://127.0.0.1:3000
TRANSACTION_LARK_WEBHOOK_URL=https://open.larksuite.com/open-apis/bot/v2/hook/...
TRANSACTION_LARK_SECRET=<optional-signing-secret>
SUPPORT_LARK_WEBHOOK_URL=https://open.larksuite.com/open-apis/bot/v2/hook/...
SUPPORT_LARK_SECRET=<optional-signing-secret>
TRANSACTION_NOTIFICATIONS_TEST_EMAIL=<real-recipient@example.com>
TRANSACTION_NOTIFICATIONS_LOCAL_REAL_CONFIRM=I_UNDERSTAND_THIS_SENDS_REAL_LOCAL_EMAIL_AND_LARK
EOF
```

Run local evidence before deploying new transaction notification code:

```bash
npm run e2e:transaction-notifications:local
npm run ci:transaction-notifications-local-evidence
```

Run real local delivery evidence only when you intentionally want a real email
and Lark card:

```bash
npm run e2e:transaction-notifications:local-real
npm run ci:transaction-notifications-local-real-evidence
```

Run live staging evidence only after deploying the new Gateway image:

```bash
export TRANSACTION_NOTIFICATIONS_STAGING_CONFIRM=I_UNDERSTAND_THIS_SENDS_STAGING_EMAIL_AND_LARK
export STAGING_TRANSACTION_POSTGRES_DSN=<Cloud-SQL-Auth-Proxy-localhost-DSN>
export STAGING_TRANSACTION_TEST_EMAIL=<verified-staging-test-email>

npm run e2e:transaction-notifications:staging
npm run ci:transaction-notifications-staging-evidence
```

### Local vs Staging E2E Secret Isolation

Local and staging E2E must never share a secret source.

- Local E2E commands set `SYNAPSE_E2E_ENV=local` and
  `ALLOW_GCP_SECRET_MANAGER=0`; they read only local env files such as
  `services/gateway/.env.local`, `services/gateway/.env.local.private`, and
  `services/gateway/.env.e2e.local`.
- Staging E2E commands set `SYNAPSE_E2E_ENV=staging` and
  `ALLOW_GCP_SECRET_MANAGER=1`; they may read only `synapse-staging-*` secrets
  through the shared `readStagingSecret()` wrapper.
- A local shell can still export `PROJECT_ID` for other work. Local E2E ignores
  that context and fails if any script attempts to read Google Secret Manager.
- Local HTTP endpoints must be `localhost` or `127.0.0.1`. Staging HTTP
  endpoints must be `https://*.synapse-network.ai`; staging Postgres evidence
  may use a localhost Cloud SQL Auth Proxy DSN.
- Do not load `services/gateway/.env.staging` from dual-mode local/staging E2E
  scripts. Staging `.env` files are operator convenience files, not local test
  inputs.

Use the dedicated local E2E override file when shell variables are too noisy:

```bash
cp services/gateway/.env.e2e.local.example services/gateway/.env.e2e.local
```

Run the isolation static gate after changing E2E, perf, drill, or npm script
boundaries:

```bash
npm run ci:e2e-env-isolation
```

### LLM DeepSeek Chat Token-Metered E2E

DeepSeek Chat is validated as a Provider-registered LLM service. This gate
proves the full Gateway path is live: discovery, invoke, final usage parsing,
pre-auth hold, exact token charge, hold release, and Provider/Platform split.

Local:

```bash
export LLM_E2E_GATEWAY_BASE=http://127.0.0.1:8000
export LLM_E2E_SERVICE_ID=svc_deepseek_chat
export LLM_E2E_CREDENTIAL=<local-test-agent-credential>
export LLM_E2E_INPUT_PRICE_PER_1M_USDC=0.140000
export LLM_E2E_OUTPUT_PRICE_PER_1M_USDC=0.280000

npm run e2e:llm-deepseek:local
npm run ci:llm-deepseek-local-evidence
```

Staging, after deploying the Gateway image that contains the LLM billing path:

```bash
export LLM_DEEPSEEK_E2E_CONFIRM=I_UNDERSTAND_THIS_CALLS_LIVE_LLM_AND_CHARGES_STAGING
export LLM_E2E_GATEWAY_BASE=https://api-staging.synapse-network.ai
export LLM_E2E_SERVICE_ID=svc_deepseek_chat
export LLM_E2E_CREDENTIAL=<staging-test-agent-credential>
export LLM_E2E_INPUT_PRICE_PER_1M_USDC=0.140000
export LLM_E2E_OUTPUT_PRICE_PER_1M_USDC=0.280000
export LLM_E2E_POSTGRES_DSN=<optional-Cloud-SQL-Auth-Proxy-localhost-DSN>

npm run e2e:llm-deepseek:staging
npm run ci:llm-deepseek-staging-evidence
```

Do not run the staging command from PR CI. It calls the live Provider endpoint
and mutates staging balances. If `LLM_E2E_POSTGRES_DSN` is set, the runner also
records the `synapse_invocations` DB row as evidence; otherwise it still
validates the Gateway response and exact token-metered billing formula.

Terraform injects the Gmail username and app password into Gateway-backed
services and jobs through `gateway_secret_env`. It also injects
`POSTGRES_DSN`; do not rely on split `POSTGRES_HOST=/cloudsql/...` fields for
jobs, because the current Gateway DSN builder expects a complete Postgres DSN.
If staging was updated manually before Terraform owns the service/job, verify
runtime injection directly:

```bash
gcloud run jobs describe synapse-staging-notification-outbox-drain \
  --project fabled-archive-494108-k5 \
  --region us-central1 \
  --format=json | jq -r '.spec.template.spec.template.spec.containers[0].env[]?.name' | sort
```

Temporary manual repair, if Terraform has not yet been applied:

```bash
gcloud run services update synapse-staging-gateway \
  --project "$PROJECT_ID" \
  --region us-central1 \
  --update-secrets GMAIL_SMTP_USERNAME=synapse-staging-gmail-username:latest,GMAIL_SMTP_APP_PASSWORD=synapse-staging-gmail-app-password:latest \
  --update-env-vars EMAIL_FROM='Synapse Network Staging <staging-alerts@synapse-network.ai>',EMAIL_REPLY_TO='support@synapse-network.ai'

gcloud run jobs update synapse-staging-notification-outbox-drain \
  --project "$PROJECT_ID" \
  --region us-central1 \
  --update-secrets POSTGRES_DSN=synapse-staging-postgres-dsn:latest,GMAIL_SMTP_USERNAME=synapse-staging-gmail-username:latest,GMAIL_SMTP_APP_PASSWORD=synapse-staging-gmail-app-password:latest \
  --update-env-vars EMAIL_FROM='Synapse Network Staging <staging-alerts@synapse-network.ai>',EMAIL_REPLY_TO='support@synapse-network.ai'
```

Transaction notification behavior:

- Deposit/refund/withdrawal success points enqueue Gmail receipt rows after the
  money mutation has committed. SMTP or Lark failures must never roll back
  ledger state.
- Gmail receipts are sent only to verified owner emails. Saving or changing an
  email does not send a “saved successfully” email; it stages the address as
  `pending_email` and sends an `email_verification` message with a 6-digit code.
  Codes expire after 10 minutes; each wallet can send at most 5 verification
  emails per UTC day, including the first send and resends.
- Staging Lark transaction cards are a watch channel only. They must include
  `STAGING_TRANSACTION_EVENT` and `NO_ACTION_REQUIRED`, and must not include
  raw email addresses, JWTs, private keys, withdrawal tickets, signatures, or
  webhook URLs.

Support case behavior:

- `/docs/support` and dashboard feedback surfaces submit to
  `POST /api/v1/feedback`.
- `billing_support`, `bug_report`, and `docs_issue` are actionable categories:
  Gateway writes the raw row to `synapse_feedback_reports` and creates a
  `synapse_forum_response_tasks` item through the existing forum support
  tables.
- Admin operators review and reply from Admin-front `/forum-support`.
- Admin replies create an in-app notification for the wallet owner and enqueue
  a `support_reply` Gmail row when the owner has a verified email.
- Support Lark cards are triage notifications. Staging cards must include
  `SUPPORT_CASE_CREATED` and `NO_ACTION_REQUIRED`; production should route them
  to a dedicated support/on-call group, not the transaction watch route.

Support case dogfood gate:

```bash
npm run e2e:support-case-dogfood:local
npm run ci:support-case-dogfood-local-evidence
```

The local gate restarts the local Gateway with a fake Lark sink, opens
User-front `/docs/support`, submits a `billing_support` case, verifies the raw
feedback row, support response task, Admin-front `/forum-support` screenshots,
admin reply, user in-app notification, and `support_reply` email outbox row. It
also submits `bug_report`, `docs_issue`, and `product_feedback` API fixtures to
prove only actionable support categories enter the manual queue.

After deploying the new Gateway, Gateway-admin, User-front, and Admin-front to
staging, run:

```bash
export SUPPORT_CASE_DOGFOOD_STAGING_CONFIRM=I_UNDERSTAND_THIS_SENDS_STAGING_SUPPORT_ALERTS
export STAGING_USER_FRONT_URL=https://staging.synapse-network.ai
export STAGING_ADMIN_FRONT_URL=https://admin-staging.synapse-network.ai
export GATEWAY_BASE_URL=https://api-staging.synapse-network.ai
export STAGING_ADMIN_API_URL=https://admin-api-staging.synapse-network.ai
export STAGING_SUPPORT_CASE_POSTGRES_DSN=<Cloud-SQL-Auth-Proxy-localhost-DSN>
export SUPPORT_CASE_E2E_AUTHOR_KEY=<staging-only-user-wallet-private-key>
export STAGING_ADMIN_E2E_PASSWORD=<dedicated-admin-e2e-password>
export STAGING_ADMIN_E2E_OTP_SECRET=<dedicated-admin-e2e-totp-secret>
export STAGING_SUPPORT_CASE_TEST_EMAIL=<verified-staging-test-email>

npm run e2e:support-case-dogfood:staging
npm run ci:support-case-dogfood-staging-evidence
```

Staging sends real support-triage Lark cards and creates staging-only support
cases. If the verified test email is configured, Admin replies must enqueue or
deliver a `support_reply` email. Failed dogfood runs must keep
`bugfix-log.md`; only evidence with `failed.length === 0` is release evidence.

### Cloud SQL Database Topology

Staging uses one Cloud SQL instance and multiple databases/users. Do not create
a second Cloud SQL instance for Gateway-admin unless a future scaling review
explicitly approves it.

| Object                 | Name                            | Created by                 | Purpose                                                                 |
| ---------------------- | ------------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| Cloud SQL instance     | `synapse-staging-postgres`      | Terraform                  | Single staging Postgres instance.                                       |
| Gateway database       | `synapse_gateway_staging`       | Terraform                  | Gateway ledger, outbox, inbox, projections, and runtime data.           |
| Gateway-admin database | `synapse_gateway_admin_staging` | `gcp_staging_bootstrap.sh` | Admin login/session, approval, audit, and control-plane data.           |
| Gateway app user       | `synapse_gateway_app`           | `gcp_staging_bootstrap.sh` | Gateway runtime write user.                                             |
| Gateway migrator user  | `synapse_gateway_migrator`      | `gcp_staging_bootstrap.sh` | Gateway schema migration user.                                          |
| Gateway readonly user  | `synapse_gateway_ro`            | `gcp_staging_bootstrap.sh` | Gateway-admin readonly access to Gateway projections and finance views. |
| Admin app user         | `synapse_admin_app`             | `gcp_staging_bootstrap.sh` | Gateway-admin runtime write user.                                       |
| Admin migrator user    | `synapse_admin_migrator`        | `gcp_staging_bootstrap.sh` | Gateway-admin schema migration user.                                    |

Run bootstrap after Terraform creates the Cloud SQL instance and Secret Manager
placeholders:

```bash
bash scripts/deploy/gcp_staging_bootstrap.sh fabled-archive-494108-k5
```

The script writes generated passwords and full DSN values directly into Secret
Manager. It does not print the passwords, write local files, or store secret
values in Terraform state. Re-running it is idempotent; set
`ROTATE_POSTGRES_PASSWORD=true` only when intentionally rotating generated DB
credentials.

If Lark bots use keyword-only validation, leave `synapse-staging-lark-secret-*`
unset and ensure E2E messages contain the configured keyword.

Local-only optional variable for wallet top-up automation:

| Variable                         | Purpose                                                                                                                             | Used by                                    | Secret | Source                                          | Location                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------ | ----------------------------------------------- | -------------------------------------------- |
| `STAGING_GAS_FUNDER_PRIVATE_KEY` | Optional funded staging wallet used only by the wallet utility to top up deployer/consumer/provider gas before contract deployment. | `npm run staging:arb-sepolia:wallets:fund` | Yes    | Dedicated local-only staging wallet private key | Local shell or local untracked env file only |
| `STAGING_GAS_FUNDER_SECRET_ID`   | Secret Manager id for the gas funder private key when you do not want to export the raw private key locally.                        | `npm run staging:arb-sepolia:wallets:fund` | No     | Fixed secret id string                          | Local shell or local untracked env file only |

Do not inject `STAGING_GAS_FUNDER_PRIVATE_KEY` into Cloud Run runtime, Terraform
variables, or Secret Manager placeholders used by runtime services. It exists
only to save operator time when topping up Arbitrum Sepolia gas locally or in
Cloud Shell.

Recommended upload command:

```bash
printf '%s' '0xYOUR_GAS_FUNDER_PRIVATE_KEY' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-gas-funder-private-key
```

For local contract deploy work, it is normal to export the real staging secrets
into your current shell before running wallet or deployment scripts:

```bash
export ARBITRUM_SEPOLIA_RPC_URL="$(gcloud secrets versions access latest \
  --secret=synapse-staging-arbitrum-sepolia-rpc-url \
  --project=fabled-archive-494108-k5)"
export STAGING_DEPLOYER_PRIVATE_KEY="$(gcloud secrets versions access latest \
  --secret=synapse-staging-deployer-private-key \
  --project=fabled-archive-494108-k5)"
export ARBISCAN_API_KEY="$(gcloud secrets versions access latest \
  --secret=synapse-staging-arbiscan-api-key \
  --project=fabled-archive-494108-k5)"
```

This shell export flow is for local operator use only. It does not change Cloud
Run runtime configuration and does not replace Secret Manager as the source of
truth.

Real `.env.staging` files are local operator convenience files and are ignored
by git. Automated staging deploys must not read secrets from committed env
files. They read non-secret configuration from workflow/Terraform inputs and
inject secret values from Google Secret Manager into Cloud Run with
`--set-secrets` or the Terraform equivalent. The committed source of truth is
the matching `.env.staging.example` file plus the Secret Manager ids in this
document.

### Secret Value Source Guide

Not every staging secret is the same kind of value. Some are plain application
secrets that should be generated with strong randomness. Some must come from a
third-party dashboard. EVM private keys are neither of those: they control
dedicated staging wallets and must be created, funded, and backed up as wallets.

| Secret id                                     | What it controls                                                 | Value class         | Can be randomly generated with `openssl rand` | Source                                                 |
| --------------------------------------------- | ---------------------------------------------------------------- | ------------------- | --------------------------------------------- | ------------------------------------------------------ |
| `synapse-staging-jwt-secret`                  | User-facing Gateway JWT signing and verification.                | Application secret  | Yes                                           | Local secure random generation                         |
| `synapse-staging-auth-secret`                 | Wallet login challenge/session/auth signing.                     | Application secret  | Yes                                           | Local secure random generation                         |
| `synapse-staging-gateway-internal-jwt-secret` | Gateway-admin to Gateway internal service-token signing.         | Application secret  | Yes                                           | Local secure random generation                         |
| `synapse-staging-metrics-bearer-token`        | `/metrics` scrape authorization token.                           | Ops bearer token    | Yes                                           | Local secure random generation                         |
| `synapse-staging-withdraw-signer`             | Gateway EIP-712 withdrawal ticket signer.                        | Cloud KMS key       | Yes                                           | Terraform-managed staging KMS signer                   |
| `synapse-staging-private-key`                 | Legacy withdrawal signer secret. Cleanup only after KMS cutover. | EVM private key     | No                                            | Legacy staging withdraw signer wallet                  |
| `synapse-staging-deployer-private-key`        | Contract deployer for MockUSDC/SynapseCore.                      | EVM private key     | No                                            | Dedicated staging deployer wallet                      |
| `synapse-staging-gas-funder-private-key`      | Optional wallet utility gas funder.                              | EVM private key     | No                                            | Dedicated staging gas funder wallet                    |
| `synapse-staging-e2e-consumer-private-key`    | Consumer-side full-chain E2E wallet.                             | EVM private key     | No                                            | Dedicated staging E2E consumer wallet                  |
| `synapse-staging-e2e-provider-private-key`    | Provider-side full-chain E2E wallet.                             | EVM private key     | No                                            | Dedicated staging E2E provider wallet                  |
| `synapse-staging-admin-e2e-password`          | Admin-front dogfood login password for the test admin account.   | Test credential     | No                                            | Dedicated staging admin test account                   |
| `synapse-staging-admin-e2e-otp-secret`        | Admin-front dogfood TOTP seed for the test admin account.        | Test credential     | No                                            | Dedicated staging admin MFA enrollment                 |
| `synapse-staging-arbitrum-sepolia-rpc-url`    | Arbitrum Sepolia RPC endpoint.                                   | Third-party URL     | No                                            | Alchemy, Infura, QuickNode, or equivalent RPC provider |
| `synapse-staging-arbiscan-api-key`            | Etherscan API V2 source verification for Arbitrum Sepolia.       | Third-party API key | No                                            | Etherscan account                                      |

Use an Etherscan API V2 key from `https://etherscan.io/myapikey` for
`synapse-staging-arbiscan-api-key`. The secret id keeps the old Arbiscan name
for compatibility, but old Arbiscan network-specific API keys will fail with
`Invalid API Key (#err2)`.

Randomly generated application secrets:

```bash
openssl rand -base64 48 | tr -d '\n' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-jwt-secret

openssl rand -base64 48 | tr -d '\n' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-auth-secret

openssl rand -base64 48 | tr -d '\n' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-gateway-internal-jwt-secret

openssl rand -base64 48 | tr -d '\n' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-metrics-bearer-token
```

Third-party values:

```bash
printf '%s' 'https://arb-sepolia.g.alchemy.com/v2/REDACTED' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-arbitrum-sepolia-rpc-url

printf '%s' 'REDACTED_ARBISCAN_API_KEY' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-arbiscan-api-key
```

Wallet private keys:

```bash
printf '%s' '0xREDACTED_STAGING_DEPLOYER_PRIVATE_KEY' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-deployer-private-key

printf '%s' '0xREDACTED_STAGING_E2E_CONSUMER_PRIVATE_KEY' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-e2e-consumer-private-key

printf '%s' '0xREDACTED_STAGING_E2E_PROVIDER_PRIVATE_KEY' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-e2e-provider-private-key
```

Wallet boundaries:

1. `synapse-staging-deployer-private-key` is deploy-only. It deploys MockUSDC
   and SynapseCore, performs staging pre-mint, and should not be injected into
   runtime Gateway services.
2. `synapse-staging-withdraw-signer` is the Gateway withdrawal signer. Derive
   its Ethereum address with `scripts/chain/gcp_kms_derive_eth_address.mjs` and
   require it to equal both `WITHDRAW_SIGNER_ADDRESS` and
   `SynapseCore.platformSigner()` in deployment evidence.
3. `synapse-staging-private-key` is legacy cleanup-only after KMS migration. Do
   not inject it into Gateway services/jobs.
4. The contract owner wallet should be a separate staging wallet address. It
   does not need to be injected into Gateway runtime.
5. Test consumer/provider wallets are for E2E only. They need Arbitrum Sepolia
   ETH gas and pre-minted MockUSDC, but their private keys must not be injected
   into Gateway runtime.
6. Never use a personal wallet, production wallet, or treasury wallet for any
   staging secret.

Admin dogfood credentials:

```bash
printf '%s' 'REDACTED_STAGING_ADMIN_E2E_PASSWORD' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-admin-e2e-password

printf '%s' 'REDACTED_STAGING_ADMIN_E2E_TOTP_SECRET' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-admin-e2e-otp-secret
```

Recommended reset flow:

```bash
bash scripts/deploy/gcp_reset_staging_admin_e2e.sh fabled-archive-494108-k5
```

Read the password only when you need to log in:

```bash
gcloud secrets versions access latest \
  --secret=synapse-staging-admin-e2e-password \
  --project=fabled-archive-494108-k5
```

Read the Google Authenticator manual key only when you need to enroll or
generate a staging E2E OTP:

```bash
gcloud secrets versions access latest \
  --secret=synapse-staging-admin-e2e-otp-secret \
  --project=fabled-archive-494108-k5
```

The E2E-only wallet and admin dogfood secrets are read by local/release
automation when explicitly exported. They are not runtime secrets for Gateway,
Gateway-admin, User-front, Admin-front, or background Cloud Run jobs.

Safe local export helpers for staging validation:

```bash
export PROJECT_ID=fabled-archive-494108-k5
export GATEWAY_E2E_RPC_URL="$(gcloud secrets versions access latest \
  --secret=synapse-staging-arbitrum-sepolia-rpc-url \
  --project="$PROJECT_ID")"
export GATEWAY_E2E_OWNER_KEY="$(gcloud secrets versions access latest \
  --secret=synapse-staging-e2e-consumer-private-key \
  --project="$PROJECT_ID")"
export GATEWAY_E2E_PROVIDER_KEY="$(gcloud secrets versions access latest \
  --secret=synapse-staging-e2e-provider-private-key \
  --project="$PROJECT_ID")"
export STAGING_ADMIN_E2E_PASSWORD="$(gcloud secrets versions access latest \
  --secret=synapse-staging-admin-e2e-password \
  --project="$PROJECT_ID")"
export STAGING_ADMIN_E2E_OTP_SECRET="$(gcloud secrets versions access latest \
  --secret=synapse-staging-admin-e2e-otp-secret \
  --project="$PROJECT_ID")"
```

Combined core dogfood release gate:

```bash
export STAGING_CORE_DOGFOOD_CONFIRM=I_UNDERSTAND_THIS_MUTATES_STAGING
export GATEWAY_E2E_GATEWAY_BASE=https://api-staging.synapse-network.ai
export STAGING_USER_FRONT_URL=https://staging.synapse-network.ai
export STAGING_ADMIN_FRONT_URL=https://admin-staging.synapse-network.ai
export STAGING_ADMIN_API_URL=https://admin-api-staging.synapse-network.ai
export POSTGRES_DSN=<locally-reachable-staging-gateway-postgres-dsn>

npm run e2e:staging-core-dogfood
npm run ci:staging-core-dogfood-evidence
```

This command mutates only staging: it sends MockUSDC on Arbitrum Sepolia,
creates Gateway deposit/withdrawal records, captures User-front/Admin-front
screenshots, and validates DB/chain reconciliation. Do not run it against prod
or from PR CI.

## User-front

Template: `services/user-front/.env.staging.example`.
Local private file: `services/user-front/.env.staging`.

The local private file is ignored by Git and was created with the same public
staging defaults. Rebuild and redeploy `synapse-staging-user-front` after
changing any `NEXT_PUBLIC_*` value because Next.js bakes these values into the
production bundle at build time.

| Variable                                | Staging value                                          | Purpose                                                                                 | Secret | Source                  |
| --------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------ | ----------------------- |
| `NEXT_PUBLIC_GATEWAY_BASE_URL`          | `https://api-staging.synapse-network.ai`               | Browser API base for all user-facing Gateway calls.                                     | No     | Fixed staging domain    |
| `NEXT_PUBLIC_ANALYTICS_ENDPOINT`        | `https://api-staging.synapse-network.ai/api/v1/events` | Browser analytics/event ingestion endpoint. Must point to the same environment Gateway. | No     | Fixed staging domain    |
| `NEXT_PUBLIC_APP_ENV`                   | `staging`                                              | Public UI/runtime environment marker.                                                   | No     | Fixed                   |
| `NEXT_PUBLIC_DOCS_BASE_URL`             | `https://docs-staging.synapse-network.ai`              | Dedicated docs origin used by main-site Docs links and `/docs/*` redirects.             | No     | Fixed staging domain    |
| `NEXT_PUBLIC_TX_EXPLORER_BASE_URL`      | `https://sepolia.arbiscan.io`                          | Arbitrum Sepolia explorer origin used by invoice and transaction links.                 | No     | Fixed staging explorer  |
| `NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS` | `20000`                                                | Service discovery cache TTL.                                                            | No     | Fixed default           |
| `NEXT_PUBLIC_SUPPORT_EMAIL`             | `support@synapse-network.ai`                           | Public support email shown in UI.                                                       | No     | Ops                     |
| `NEXT_PUBLIC_SUPPORT_PORTAL_URL`        | empty or support URL                                   | Optional support portal deep link.                                                      | No     | Ops                     |
| `NEXT_PUBLIC_REOWN_PROJECT_ID`          | empty or project id                                    | Optional Reown wallet integration.                                                      | No     | Reown dashboard         |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`  | empty or project id                                    | Optional WalletConnect project id.                                                      | No     | WalletConnect dashboard |

Do not introduce `NEXT_PUBLIC_API_BASE_URL` unless the frontend code is
intentionally refactored. Current code uses `NEXT_PUBLIC_GATEWAY_BASE_URL`.

## Docs-front

Template and defaults live in `services/docs-front`. Local docs run on
`http://localhost:3100`; staging deploys as `synapse-staging-docs-front` behind
`https://docs-staging.synapse-network.ai`.

Docs-front public env:

| Variable                       | Staging value                                           | Purpose                                                               | Secret |
| ------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------- | ------ |
| `NEXT_PUBLIC_APP_ENV`          | `staging`                                               | Public environment marker.                                            | No     |
| `NEXT_PUBLIC_DOCS_BASE_URL`    | `https://docs-staging.synapse-network.ai`               | Canonical docs origin for metadata, sitemap, robots, and llms assets. | No     |
| `NEXT_PUBLIC_CONSOLE_BASE_URL` | `https://staging.synapse-network.ai/dashboard/overview` | Console CTA target.                                                   | No     |
| `NEXT_PUBLIC_GATEWAY_BASE_URL` | `https://api-staging.synapse-network.ai`                | Request examples and staging-safe API reference base URL.             | No     |

`services/user-front` runs `node scripts/validate_env.mjs` before `yarn dev`
and `yarn build`. Staging/prod builds must fail if any required public env is
missing or invalid, especially the support contact pair:

```text
NEXT_PUBLIC_SUPPORT_EMAIL or NEXT_PUBLIC_SUPPORT_PORTAL_URL
```

This prevents Credits/Billing support panels from shipping with the fallback
operator warning visible to users.

Staging front-end contract config:

| File                                                                    | Purpose                                                                                                                                          | Current staging values                                                                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `services/user-front/src/contract-config.arbitrum-sepolia.example.json` | Canonical Arbitrum Sepolia contract config used to seed staging builds.                                                                          | `SynapseCore=0x0bA1dcE1Cc8d877052ab1C3CE2362830459D8FF4`, `MockUSDC=0xfad31daE42B0046aFA106BCf56ED0dDaCA4463B9` |
| `services/user-front/src/contract-config.json`                          | Runtime file imported by User-front wallet flows. For staging builds, copy the Arbitrum Sepolia config into this path before building the image. | Must match the current verified staging deployment.                                                             |

Recommended staging build prep:

```bash
cp services/user-front/src/contract-config.arbitrum-sepolia.example.json \
  services/user-front/src/contract-config.json
```

## Gateway API

Template: `services/gateway/.env.staging.example`.
Local private file: `services/gateway/.env.staging`.

The local private file is ignored by Git. Cloud Run does not read this file
directly; production-like staging deploys must inject the same values through
Terraform, `gcloud run deploy`, and Secret Manager. Changing runtime env values
on Cloud Run creates a new revision and does not require rebuilding the Gateway
image unless the code changed.

| Variable                                  | Staging value                                              | Purpose                                                                                                                                                                                                          | Secret | Source                                         |
| ----------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------- |
| `ENVIRONMENT`                             | `staging`                                                  | Gateway runtime environment.                                                                                                                                                                                     | No     | Fixed                                          |
| `CORS_ALLOW_ORIGINS`                      | `https://staging.synapse-network.ai`                       | Browser origin allowed to call Gateway.                                                                                                                                                                          | No     | Fixed domain                                   |
| `STORAGE_BACKEND`                         | `postgres`                                                 | Use Postgres-backed storage.                                                                                                                                                                                     | No     | Fixed                                          |
| `POSTGRES_HOST`                           | `/cloudsql/<project>:us-central1:synapse-staging-postgres` | Cloud SQL Unix socket path.                                                                                                                                                                                      | No     | Terraform output                               |
| `POSTGRES_DB`                             | `synapse_gateway_staging`                                  | Gateway database name.                                                                                                                                                                                           | No     | Terraform                                      |
| `POSTGRES_USER`                           | `synapse_gateway_app`                                      | Gateway DB app user.                                                                                                                                                                                             | No     | Bootstrap                                      |
| `POSTGRES_PASSWORD`                       | Secret Manager value                                       | Gateway DB password fallback when `POSTGRES_DSN` is not injected.                                                                                                                                                | Yes    | `synapse-staging-postgres-password`            |
| `POSTGRES_DSN`                            | Secret Manager value                                       | Full Gateway Cloud SQL Unix-socket DSN. Cloud Run staging should inject this rather than relying only on split host/user/db fields; staging E2E may also read it through Secret Manager or Cloud SQL Auth Proxy. | Yes    | `synapse-staging-postgres-dsn`                 |
| `POSTGRES_MIGRATOR_USER`                  | `synapse_gateway_migrator`                                 | DB user used only by `synapse-staging-db-migrate`.                                                                                                                                                               | No     | Bootstrap                                      |
| `POSTGRES_MIGRATOR_PASSWORD`              | Secret Manager value                                       | Migrator password; runtime API services must not receive this.                                                                                                                                                   | Yes    | `synapse-staging-postgres-migrator-password`   |
| `POSTGRES_POOL_MAX`                       | `5`                                                        | Max reusable DB connections per instance.                                                                                                                                                                        | No     | Fixed staging safety limit                     |
| `POSTGRES_CONNECT_TIMEOUT_SEC`            | `5`                                                        | DB connect timeout.                                                                                                                                                                                              | No     | Fixed                                          |
| `POSTGRES_AUTO_INIT`                      | `0`                                                        | Avoid implicit schema creation in staging.                                                                                                                                                                       | No     | Fixed                                          |
| `GATEWAY_DEFAULT_TIMEOUT_MS`              | `15000`                                                    | Default sync timeout for ordinary API services.                                                                                                                                                                  | No     | Runtime guardrail                              |
| `GATEWAY_MAX_TIMEOUT_MS`                  | `60000`                                                    | Maximum sync timeout for ordinary API services.                                                                                                                                                                  | No     | Runtime guardrail                              |
| `GATEWAY_LLM_DEFAULT_TIMEOUT_MS`          | `120000`                                                   | Default sync timeout for `serviceKind=llm` / `priceModel=token_metered`.                                                                                                                                         | No     | Runtime guardrail                              |
| `GATEWAY_LLM_MAX_TIMEOUT_MS`              | `300000`                                                   | Maximum bounded sync timeout for LLM/token-metered services. Longer tasks must use async invocation.                                                                                                             | No     | Runtime guardrail                              |
| `JWT_SECRET`                              | Secret Manager value                                       | User-facing JWT signing secret.                                                                                                                                                                                  | Yes    | `synapse-staging-jwt-secret`                   |
| `AUTH_SECRET`                             | Secret Manager value                                       | Wallet challenge/session secret.                                                                                                                                                                                 | Yes    | `synapse-staging-auth-secret`                  |
| `GATEWAY_INTERNAL_JWT_SECRET`             | Secret Manager value                                       | Validates Gateway-admin internal tokens.                                                                                                                                                                         | Yes    | `synapse-staging-gateway-internal-jwt-secret`  |
| `RPC_URL`                                 | Secret Manager value                                       | Runtime Arbitrum Sepolia RPC URL.                                                                                                                                                                                | Yes    | `synapse-staging-arbitrum-sepolia-rpc-url`     |
| `ROUTER_ADDRESS`                          | `0x0bA1dcE1Cc8d877052ab1C3CE2362830459D8FF4`               | Deployed staging SynapseCore.                                                                                                                                                                                    | No     | `20260424T062942120Z-deploy` contract manifest |
| `USDC_TOKEN_ADDRESS`                      | `0xfad31daE42B0046aFA106BCf56ED0dDaCA4463B9`               | Deployed owner-only staging MockUSDC.                                                                                                                                                                            | No     | `20260424T062942120Z-deploy` contract manifest |
| `WITHDRAW_SIGNER_MODE`                    | `gcp_kms`                                                  | Staging withdrawal ticket signer mode. Raw private-key signing is local-only after KMS migration evidence is green.                                                                                              | No     | Fixed staging guardrail                        |
| `WITHDRAW_SIGNER_GCP_KMS_KEY_NAME`        | `projects/.../cryptoKeyVersions/1`                         | Cloud KMS secp256k1 key version used to sign withdrawal ticket digests.                                                                                                                                          | No     | Terraform KMS signer resource                  |
| `WITHDRAW_SIGNER_ADDRESS`                 | `0x...`                                                    | Ethereum address derived from the KMS public key; Gateway verifies signatures against this address and `SynapseCore.platformSigner()`.                                                                           | No     | `scripts/chain/gcp_kms_derive_eth_address.mjs` |
| `METRICS_BEARER_TOKEN`                    | Secret Manager value                                       | App-layer `/metrics` guard.                                                                                                                                                                                      | Yes    | `synapse-staging-metrics-bearer-token`         |
| `V2_INDEXER_ENABLED`                      | `false`                                                    | Disable API-process indexer; use scheduled job.                                                                                                                                                                  | No     | Fixed Cloud Run staging                        |
| `PROVIDER_WITHDRAW_EXPIRY_REAPER_ENABLED` | `false`                                                    | Disable API-process reaper; use scheduled job.                                                                                                                                                                   | No     | Fixed Cloud Run staging                        |
| `CONSUMER_WITHDRAW_PROCESSOR_ENABLED`     | `false`                                                    | Disable API-process consumer processor; use scheduled job.                                                                                                                                                       | No     | Fixed Cloud Run staging                        |
| `ANALYTICS_TRANSPORT`                     | `outbox`                                                   | Use Postgres outbox instead of Kafka.                                                                                                                                                                            | No     | MVP default                                    |
| `ANALYTICS_STRICT_KAFKA`                  | `false`                                                    | Do not require Kafka in MVP staging.                                                                                                                                                                             | No     | MVP default                                    |
| `REDIS_URL`                               | empty                                                      | Redis disabled for MVP staging.                                                                                                                                                                                  | No     | MVP default                                    |
| `DOWNSTREAM_ADAPTIVE_REDIS_ENABLED`       | `false`                                                    | Disable Redis-backed adaptive routing.                                                                                                                                                                           | No     | MVP default                                    |
| `EMAIL_OUTBOX_ENABLED`                    | `true`                                                     | Persist async email intents.                                                                                                                                                                                     | No     | MVP default                                    |
| `GMAIL_SMTP_USERNAME`                     | Secret Manager value                                       | SMTP sender username.                                                                                                                                                                                            | Yes    | `synapse-staging-gmail-username`               |
| `GMAIL_SMTP_APP_PASSWORD`                 | Secret Manager value                                       | SMTP app password/relay credential.                                                                                                                                                                              | Yes    | `synapse-staging-gmail-app-password`           |

## Admin-front

Template: `services/admin-front/.env.staging.example`.
Local private file: `services/admin-front/.env.staging`.

The local private file is ignored by Git and contains only public staging URLs.
Rebuild and redeploy `synapse-staging-admin-front` after changing
`NEXT_PUBLIC_ADMIN_API_BASE_URL` because Next.js bakes public values into the
production bundle at build time.

| Variable                         | Staging value                                  | Purpose                                    | Secret | Source               |
| -------------------------------- | ---------------------------------------------- | ------------------------------------------ | ------ | -------------------- |
| `NEXT_PUBLIC_ADMIN_API_BASE_URL` | `https://admin-api-staging.synapse-network.ai` | Browser API base for admin console calls.  | No     | Fixed staging domain |
| `ADMIN_API_PROXY_TARGET`         | `https://admin-api-staging.synapse-network.ai` | Next.js rewrite target for `/api/admin/*`. | No     | Fixed staging domain |
| `NEXT_PUBLIC_APP_ENV`            | `staging`                                      | Public UI/runtime environment marker.      | No     | Fixed                |

## Gateway-admin API

Template: `services/gateway-admin/.env.staging.example`.
Local private file: `services/gateway-admin/.env.staging`.

The local private file is ignored by Git. Cloud Run must receive the equivalent
values through runtime env and Secret Manager. Changing Gateway-admin runtime
env creates a new Cloud Run revision; rebuild only when code changes.

| Variable                           | Staging value                              | Purpose                                                                                                                     | Secret                | Source                                         |
| ---------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------- |
| `ENVIRONMENT`                      | `staging`                                  | Admin API environment marker.                                                                                               | No                    | Fixed                                          |
| `ADMIN_GATEWAY_PORT`               | `8000`                                     | Cloud Run container port for Gateway-admin.                                                                                 | No                    | Fixed                                          |
| `ADMIN_GATEWAY_ALLOWED_ORIGINS`    | `https://admin-staging.synapse-network.ai` | Admin-front origin allowed by CORS.                                                                                         | No                    | Fixed staging domain                           |
| `ADMIN_SESSION_COOKIE_SECURE`      | `true`                                     | Send admin session cookie only over HTTPS.                                                                                  | No                    | Fixed                                          |
| `ADMIN_SESSION_COOKIE_SAMESITE`    | `lax`                                      | Admin session CSRF boundary.                                                                                                | No                    | Fixed                                          |
| `ADMIN_SESSION_COOKIE_DOMAIN`      | `.synapse-network.ai`                      | Admin session cookie domain.                                                                                                | No                    | Fixed parent domain                            |
| `ADMIN_LOGIN_LOCK_THRESHOLD`       | `5`                                        | Lock an admin account after five consecutive password or OTP failures. Valid range is `3..10`; invalid values fail startup. | No                    | Fixed                                          |
| `ADMIN_LOGIN_LOCK_HOURS`           | `24`                                       | Temporary account lock duration in hours. Valid range is `1..168`; invalid values fail startup.                             | No                    | Fixed                                          |
| `ADMIN_CSRF_SECRET`                | Secret Manager value                       | CSRF/session signing secret.                                                                                                | Yes                   | `synapse-staging-admin-csrf-secret`            |
| `ADMIN_DATABASE_DSN`               | Secret Manager value                       | Admin control-plane database full DSN.                                                                                      | Yes                   | `synapse-staging-admin-database-dsn`           |
| `ADMIN_DATABASE_MIGRATION_DSN`     | Secret Manager value                       | Admin schema migration full DSN.                                                                                            | Yes                   | `synapse-staging-admin-database-migration-dsn` |
| `GATEWAY_READONLY_DSN`             | Secret Manager value                       | Read Gateway projections without write access.                                                                              | Yes                   | `synapse-staging-gateway-readonly-dsn`         |
| `GATEWAY_FORUM_WRITE_DSN`          | Secret Manager value                       | Write forum/support records into Gateway DB where required.                                                                 | Yes                   | `synapse-staging-gateway-forum-write-dsn`      |
| `GATEWAY_INTERNAL_BASE_URL`        | `https://api-staging.synapse-network.ai`   | Internal admin calls to Gateway.                                                                                            | No                    | Fixed staging domain                           |
| `GATEWAY_INTERNAL_ADMIN_WALLET`    | Secret Manager value or injected address   | Internal admin wallet subject.                                                                                              | Yes/Address-sensitive | `synapse-staging-gateway-admin-wallet`         |
| `GATEWAY_INTERNAL_JWT_SECRET`      | Secret Manager value                       | Signs Gateway-admin service tokens.                                                                                         | Yes                   | `synapse-staging-gateway-internal-jwt-secret`  |
| `GATEWAY_INTERNAL_TOKEN_ISSUER`    | `gateway-admin`                            | Internal JWT issuer.                                                                                                        | No                    | Fixed                                          |
| `GATEWAY_INTERNAL_TOKEN_AUDIENCE`  | `gateway-internal`                         | Internal JWT audience.                                                                                                      | No                    | Fixed                                          |
| `GATEWAY_INTERNAL_SERVICE_SUBJECT` | `service:gateway-admin`                    | Internal JWT subject.                                                                                                       | No                    | Fixed                                          |
| `GATEWAY_INTERNAL_TIMEOUT_SEC`     | `10`                                       | Gateway internal call timeout.                                                                                              | No                    | Fixed                                          |
| `EXECUTION_WORKER_ENABLED`         | `false`                                    | Keep long-running admin worker loops out of the API-serving Cloud Run service for MVP staging.                              | No                    | Fixed                                          |

Gateway-admin persistence needs an admin database/user. If V1 uses the same
Cloud SQL instance, create a separate admin database and least-privilege user;
do not reuse the Gateway write user for admin control-plane writes.

## Arbitrum Sepolia Deployment

These variables are required for `npm run deploy:contracts:arbitrum-sepolia:*`.

| Variable                          | Example                                    | Purpose                                                                                                   | Secret | Source                              | Secret Manager                             |
| --------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------- | ------------------------------------------ |
| `ARBITRUM_SEPOLIA_RPC_URL`        | `https://arb-sepolia.g.alchemy.com/v2/...` | RPC for deployment, verification gate, and live bytecode reads.                                           | Yes    | Alchemy/Infura/other RPC provider   | `synapse-staging-arbitrum-sepolia-rpc-url` |
| `STAGING_DEPLOYER_PRIVATE_KEY`    | `0x...`                                    | Deploys contracts and pre-mints MockUSDC.                                                                 | Yes    | Dedicated staging deployer wallet   | `synapse-staging-deployer-private-key`     |
| `STAGING_CONTRACT_OWNER_ADDRESS`  | `0x...`                                    | Final owner for MockUSDC/SynapseCore.                                                                     | No     | Dedicated owner wallet address      | Not a secret                               |
| `STAGING_WITHDRAW_SIGNER_ADDRESS` | `0x...`                                    | Public address of Gateway withdraw signer for contract deployment.                                        | No     | Derived from staging KMS public key | Not a secret                               |
| `ARBISCAN_API_KEY`                | `...`                                      | Etherscan API V2 source verification for Arbitrum Sepolia. Legacy env name kept for script compatibility. | Yes    | Etherscan account                   | `synapse-staging-arbiscan-api-key`         |
| `STAGING_TEST_CONSUMER_ADDRESS`   | `0x...`                                    | Dedicated consumer wallet for full-chain E2E.                                                             | No     | Staging E2E wallet                  | Not a secret                               |
| `STAGING_TEST_PROVIDER_ADDRESS`   | `0x...`                                    | Dedicated provider wallet for full-chain E2E.                                                             | No     | Staging E2E wallet                  | Not a secret                               |
| `STAGING_MIN_GAS_ETH`             | `0.01`                                     | Minimum ETH gas balance preflight.                                                                        | No     | Fixed default                       | Not a secret                               |
| `STAGING_TEST_MOCK_USDC_PREMINT`  | `100000`                                   | MockUSDC amount pre-minted to E2E wallets.                                                                | No     | Fixed default                       | Not a secret                               |

Required boundaries:

1. Deployer, owner, withdraw signer, consumer, and provider roles must be
   separate unless a risk acceptance explicitly says otherwise.
2. Deployer, consumer, and provider wallets must have Arbitrum Sepolia ETH before
   dry-run.
3. `STAGING_WITHDRAW_SIGNER_ADDRESS` must match the address derived from the
   staging KMS public key and must equal `SynapseCore.platformSigner()`.
4. Staging and production use KMS-backed signing; raw withdrawal signer private
   keys are local-only after staging KMS evidence is green.
5. Staging uses owner-only `MockUSDC`, not production USDC.

## Lark

| Runtime variable               | Secret id                                     | Purpose                                                               | Required                          |
| ------------------------------ | --------------------------------------------- | --------------------------------------------------------------------- | --------------------------------- |
| `LARK_WEBHOOK_P0_WAR_ROOM`     | `synapse-staging-lark-webhook-p0`             | P0 war-room delivery.                                                 | Yes for Lark E2E                  |
| `LARK_WEBHOOK_PROD_ALERTS`     | `synapse-staging-lark-webhook-prod-alerts`    | Prod-alerts style route delivery.                                     | Yes for Lark E2E                  |
| `LARK_WEBHOOK_STAGING_DRILL`   | `synapse-staging-lark-webhook-staging-drill`  | Drill-only delivery.                                                  | Yes for Lark E2E                  |
| `LARK_SECRET_P0_WAR_ROOM`      | `synapse-staging-lark-secret-p0`              | Optional Lark signing secret.                                         | Only if bot signing is enabled    |
| `LARK_SECRET_PROD_ALERTS`      | `synapse-staging-lark-secret-prod-alerts`     | Optional Lark signing secret.                                         | Only if bot signing is enabled    |
| `LARK_SECRET_STAGING_DRILL`    | `synapse-staging-lark-secret-staging-drill`   | Optional Lark signing secret.                                         | Only if bot signing is enabled    |
| `TRANSACTION_LARK_WEBHOOK_URL` | `synapse-staging-lark-webhook-staging-drill`  | Gateway transaction watch cards for staging receipts and withdrawals. | Yes for staging transaction watch |
| `TRANSACTION_LARK_SECRET`      | `synapse-staging-lark-secret-staging-drill`   | Optional Gateway transaction-watch signing secret.                    | Only if bot signing is enabled    |
| `TRANSACTION_LARK_ENABLED`     | `true` in staging, `false` in prod by default | Enables Gateway transaction-watch cards.                              | Staging only                      |
| `GCP_ALERT_RECEIVER_ENABLED`   | `true`                                        | Enables gateway-admin `/api/v1/ops/webhooks/gcp-alert-receiver`.      | Yes for GCP alert webhook         |
| `GCP_ALERT_RECEIVER_TOKEN`     | `synapse-staging-gcp-alert-receiver-token`    | Shared token required from GCP Monitoring.                            | Yes                               |
| `GCP_ALERT_RECEIVER_USERNAME`  | `synapse-gcp-alert`                           | HTTP Basic username for the GCP webhook channel.                      | Yes                               |
| `GCP_ALERT_DEFAULT_ROUTE`      | `staging-drill`                               | Default route when the GCP payload has no Lark route label.           | Yes                               |

If using keyword-only validation, configure the keyword in Lark and leave the
`LARK_SECRET_*` variables unset.

## Gateway Alert Drills

| Runtime variable                     | Secret id / value                   | Purpose                                                                                                            | Required            |
| ------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `STAGING_ALERT_DRILL_ENABLED`        | `true`                              | Enables the controlled Gateway 500 drill endpoint in staging. Production refuses this endpoint even if configured. | Yes for alert drill |
| `STAGING_ALERT_DRILL_TOKEN`          | `synapse-staging-alert-drill-token` | Header token for `GET /api/v1/ops/drills/http-500`.                                                                | Yes for alert drill |
| `WITHDRAWAL_TIMEOUT_ALERT_AFTER_SEC` | `900`                               | Existing withdrawal workers log `WITHDRAWAL_TIMEOUT` when pending work exceeds this age.                           | Yes                 |

## Cloud Run Jobs

Cloud Run staging keeps long-running work out of API serving instances.
These jobs are separate Cloud Run execution units, but they intentionally use
the same Gateway Docker image as `synapse-staging-gateway`. The worker entrypoint
is `python -m src.worker <job> --once`, so Gateway API and jobs share `src.core`,
`src.storage`, domain models, money utilities, and settlement state-machine code.

| Job                           | Command                                                   | Schedule                 | Lock key                      | Purpose                                                            |
| ----------------------------- | --------------------------------------------------------- | ------------------------ | ----------------------------- | ------------------------------------------------------------------ |
| DB migration                  | `bash scripts/deploy/migrate_db.sh staging`               | Manual release step only | n/a                           | Apply shared schema/reference migrations before API image rollout. |
| Deposit indexer               | `python -m src.worker deposit-indexer --once`             | Every minute             | `deposit-indexer`             | Credit confirmed deposits.                                         |
| Provider withdrawal reaper    | `python -m src.worker provider-withdraw-reaper --once`    | Every minute             | `provider-withdraw-reaper`    | Expire provider withdrawal tickets safely.                         |
| Consumer withdrawal processor | `python -m src.worker consumer-withdraw-processor --once` | Every minute             | `consumer-withdraw-processor` | Process consumer withdrawal lifecycle.                             |
| Notification outbox drain     | `python -m src.worker notification-outbox --once`         | Every minute             | `notification-outbox-drain`   | Send async Gmail notifications.                                    |
| In-app notification cleanup   | `python -m src.worker in-app-cleanup --once`              | Daily                    | `in-app-notification-cleanup` | Delete expired/old inbox rows.                                     |

Each money-sensitive job must use `task_count=1`, `parallelism=1`, and the
Postgres advisory lock. A lock skip logs `JOB_SKIPPED_ALREADY_RUNNING` and exits
successfully unless repeated skips breach alert thresholds.

When deploy scope includes `gateway`, the staging deploy workflow must update
the Gateway service and all Gateway jobs to the same immutable Gateway image
digest. Updating a job image does not execute the job; Cloud Scheduler still
controls execution. This prevents the dangerous split-brain state where the API
writes new ledger/storage shapes while old indexer, processor, or outbox code
continues to run.

Manual drift repair uses the same job list as the workflow:

```bash
bash scripts/deploy/gcp_sync_staging_jobs.sh \
  --project fabled-archive-494108-k5 \
  --region us-central1 \
  --service gateway \
  --image us-central1-docker.pkg.dev/fabled-archive-494108-k5/synapse-staging/gateway@sha256:<digest>
```

Use the manual script only for emergency drift repair, rollback alignment, or
Terraform apply follow-up. Normal releases should update jobs through
`.github/workflows/deploy-staging.yml` and record job digests in the release
manifest.

Cloud Run Job monitoring is separate from Gateway `/readiness`:

- `/readiness` reports only workers running inside the Gateway API process.
  In staging, scheduled workers intentionally run as Cloud Run Jobs, so
  `enabled=false` for deposit indexer, withdrawal processors, or cleanup inside
  `/readiness` is expected.
- GCP Monitoring alerts on any Cloud Run Job execution whose
  `run.googleapis.com/job/completed_execution_count` result is not `succeeded`.
- GCP Monitoring also alerts when scheduled jobs stop producing successful
  executions: 10 minutes for every-minute jobs. The daily cleanup job is
  covered by failed-execution alerting and Scheduler-enabled checks; V1 does
  not use freshness for it because GCP `conditionAbsent` rejects durations
  above 23h30m, which would false-positive before a 24h cadence.
- Deployment/manual migration jobs are covered by failed-execution alerts, but
  not freshness alerts because they are not periodic runtime jobs.

Useful checks:

```bash
gcloud scheduler jobs list \
  --project fabled-archive-494108-k5 \
  --location us-central1 \
  --format='table(name.basename(),schedule,state,httpTarget.uri)'

gcloud logging read \
  'resource.type="cloud_run_job" AND resource.labels.job_name="synapse-staging-deposit-indexer"' \
  --project fabled-archive-494108-k5 \
  --freshness=30m \
  --limit=20 \
  --format='table(timestamp,severity,textPayload)'
```

## Migration And Seed Rules

Schema is one global blueprint. Local, staging, and production all execute the
same Git-tracked Gateway schema SQL:

```bash
bash scripts/deploy/migrate_db.sh local
bash scripts/deploy/migrate_db.sh staging
SYNAPSE_MIGRATION_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PROD \
  bash scripts/deploy/migrate_db.sh prod
```

Execution target is environment-specific through the migrator DSN:

- Local may use a bootstrap/superuser DSN against `localhost`.
- Staging must use the staging migrator user and staging Cloud SQL database.
- Production must use the production migrator user and requires the explicit
  confirmation variable above.
- The migration runner grants runtime table/sequence privileges to
  `POSTGRES_USER` after applying schema, so API containers can stay
  least-privilege and avoid DDL rights.

Gateway and Gateway-admin runtime services must run with `POSTGRES_AUTO_INIT=0`.
They validate schema at startup but do not create or mutate tables. The release
sequence is:

1. Resolve the selected branch/tag/commit into an immutable commit SHA.
2. Resolve deploy scope (`auto`, one service, or `all`).
3. Build only affected service images in Cloud Build.
4. Run the Gateway DB migration job before every Gateway API rollout. This is
   intentional even when no migration file changed: the migration job also runs
   schema contract validation against the real staging Cloud SQL database and
   catches drifted constraints.
5. If Gateway is affected, update all Gateway jobs to the same Gateway image digest.
6. Deploy affected Cloud Run services by immutable image digest when available.
7. Run HTTP smoke tests only for affected services. For User-front, do not
   treat a listening port or Cloud Run `Ready=True` as sufficient; verify a real
   page such as `/dashboard/account/settings` or `/` responds successfully.
8. If Gateway is affected, run the staging drift guard against live Cloud Run,
   Secret Manager, Provider discovery, and Gateway job digests.
9. Write `release-manifest.json` and upload it to the staging evidence bucket.

Branch-based staging deploy is allowed, but the workflow freezes the branch HEAD
at dispatch time. Release evidence must record `sourceRefType`, `sourceRef`,
`resolvedCommitSha`, image tags/digests, Cloud Run revisions, job image digests,
job drift status, smoke status, and the evidence URI. Do not treat a moving
branch name as the deployed version.

Artifact Registry tags use Docker-safe UTC timestamps:
`staging-<safe-branch>-<short-sha>-<yyyy-MM-dd-HHmmss>`. The release manifest
also includes a human display timestamp in `yyyy-MM-dd HH:mm:ss` with
`timestampTimezone=UTC`; UI layers may convert that ISO source time to local
operator time for display.

### Drift Guard Release Gate

The staging deploy workflow runs `npm run ci:staging-drift-guard` whenever the
Gateway deploy scope is active. This gate is deliberately live-environment
focused; it prevents the exact drift classes that previously broke staging:

- Free services are a product contract. `costUsdc=0.000000` is valid and
  negative prices are invalid. The Gateway schema contract requires
  `synapse_service_quotes.quoted_price_usdc >= 0`; an older `> 0` constraint
  fails release validation.
- `synapse-staging-provider-signature-secret`,
  `synapse-staging-gcp-alert-receiver-token`, and
  `synapse-staging-alert-drill-token` must be non-empty, non-placeholder, and
  newline-free.
- Gateway and Provider must both inject
  `GATEWAY_PROVIDER_SIGNATURE_SECRET` from
  `synapse-staging-provider-signature-secret`.
- Provider runtime must mount
  `fabled-archive-494108-k5:us-central1:synapse-staging-postgres` whenever it
  uses the Cloud SQL DSN secret.
- Provider services must remain discoverable through Gateway and must not drift
  back to old `api-staging.../api/v1/gateway/generate` style endpoints. The
  expected staging prefix is
  `https://provider-staging.synapse-network.ai/provider-services/`.
- Gateway service and Gateway jobs must share the same immutable image digest.

The drift guard writes its result into `release-manifest.json` under
`driftGuard`. A failed drift guard fails the deployment and the Growing
DeploymentRecord should show the failed phase plus the remediation hint from
the workflow logs.

GitHub Actions authenticates to Google Cloud through Workload Identity
Federation, not a long-lived service account JSON key. The staging workflow must
have all of these repository secrets configured before dispatch:

```text
GCP_WORKLOAD_IDENTITY_PROVIDER
GCP_DEPLOY_SERVICE_ACCOUNT
STAGING_GCP_PROJECT_ID
STAGING_GCP_REGION
STAGING_ARTIFACT_REGISTRY_REPOSITORY
STAGING_EVIDENCE_BUCKET
```

`GCP_WORKLOAD_IDENTITY_PROVIDER` must use the full provider resource name:

```text
projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/<POOL_ID>/providers/<PROVIDER_ID>
```

The provider should trust only `SynapseNetworkAI/Synapse-Network` and the
workflow-dispatch ref used for deploy orchestration. The deploy service account
is staging-only and may build images, push to the staging Artifact Registry,
deploy whitelisted Cloud Run staging services, run staging migration jobs, and
write deployment evidence. It must not have production deploy or rollback
authority.

The automated workflow supports:

```text
deploy_scope=auto | gateway | gateway-admin | user-front | admin-front | docs-front | all
```

`auto` uses `scripts/deploy/resolve_deploy_scope.mjs` to infer affected services.
Docs-only changes become `no_deploy` records and do not trigger Cloud Build.

Seed data is not migration data:

- Reference data such as system roles, permissions, and default config may run
  in every environment, but it must be idempotent with `ON CONFLICT`.
- Test seed, dogfood seed, fake users, fake services, fake balances, and E2E
  fixture data are forbidden in production.
- Local seed scripts may only target localhost resources.
- Staging seed/evidence data must carry a run id, dedicated test wallet, or test
  tenant so it can be excluded from real reconciliation.

Production migration logs must include:

```text
PROD detected: schema/reference migration only; test seed skipped.
```

## Smoke Tests

Run after DNS/TLS and Cloud Run deploy:

The full staging validation sequence is maintained in
`docs/ops/18_Staging_Validation_Runbook.md`. This section keeps only the
configuration-specific commands and contract-address update examples.

Update Gateway and Gateway-admin runtime env to point at the verified staging
contracts:

```bash
gcloud run services update synapse-staging-gateway \
  --project fabled-archive-494108-k5 \
  --region us-central1 \
  --update-env-vars ROUTER_ADDRESS=0x0bA1dcE1Cc8d877052ab1C3CE2362830459D8FF4,USDC_TOKEN_ADDRESS=0xfad31daE42B0046aFA106BCf56ED0dDaCA4463B9

gcloud run services update synapse-staging-gateway-admin \
  --project fabled-archive-494108-k5 \
  --region us-central1 \
  --update-env-vars ROUTER_ADDRESS=0x0bA1dcE1Cc8d877052ab1C3CE2362830459D8FF4,USDC_TOKEN_ADDRESS=0xfad31daE42B0046aFA106BCf56ED0dDaCA4463B9

gcloud run jobs update synapse-staging-deposit-indexer \
  --project fabled-archive-494108-k5 \
  --region us-central1 \
  --update-env-vars ROUTER_ADDRESS=0x0bA1dcE1Cc8d877052ab1C3CE2362830459D8FF4,USDC_TOKEN_ADDRESS=0xfad31daE42B0046aFA106BCf56ED0dDaCA4463B9

gcloud run jobs update synapse-staging-provider-withdraw-reaper \
  --project fabled-archive-494108-k5 \
  --region us-central1 \
  --update-env-vars ROUTER_ADDRESS=0x0bA1dcE1Cc8d877052ab1C3CE2362830459D8FF4,USDC_TOKEN_ADDRESS=0xfad31daE42B0046aFA106BCf56ED0dDaCA4463B9

gcloud run jobs update synapse-staging-consumer-withdraw-processor \
  --project fabled-archive-494108-k5 \
  --region us-central1 \
  --update-env-vars ROUTER_ADDRESS=0x0bA1dcE1Cc8d877052ab1C3CE2362830459D8FF4,USDC_TOKEN_ADDRESS=0xfad31daE42B0046aFA106BCf56ED0dDaCA4463B9
```

If Terraform owns Cloud Run env for this deployment, set the same values in
local private `infra/terraform/gcp-staging/terraform.tfvars` under
`common_runtime_env` instead of hand-updating Cloud Run. Do not commit private
`terraform.tfvars`.

```bash
curl https://staging.synapse-network.ai
curl https://api-staging.synapse-network.ai/health
curl https://admin-staging.synapse-network.ai
curl https://admin-api-staging.synapse-network.ai/health
```

Then run release evidence:

```bash
npm run e2e:staging-smoke
npm run ci:staging-smoke-evidence

npm run deploy:contracts:arbitrum-sepolia:dry-run
npm run deploy:contracts:arbitrum-sepolia
npm run ci:contract-deployment-evidence

GATEWAY_RELEASE_E2E_PROFILE=mvp-postgres npm run release:evidence:gateway-fullchain:staging
GATEWAY_RELEASE_E2E_REQUIRED_ENV=staging npm run ci:gateway-release-e2e-evidence

npm run e2e:staging-ui-dogfood
npm run e2e:lark-alerts
npm run ci:lark-alert-e2e-evidence
```
