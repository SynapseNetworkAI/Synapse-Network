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

| Service | Public URL | Purpose |
| --- | --- | --- |
| User-front | `https://staging.synapse-network.ai` | Consumer/provider web app. |
| Gateway API | `https://api-staging.synapse-network.ai` | User-facing Gateway API. |
| Admin-front | `https://admin-staging.synapse-network.ai` | Operations/admin web console. |
| Gateway-admin API | `https://admin-api-staging.synapse-network.ai` | Admin/control-plane API. |

DNS and TLS are configured outside the repo through Google Cloud custom domains
or a managed HTTPS load balancer. Do not point frontend code at bare hostnames
such as `api-staging.synapse-network.ai`; always use the full HTTPS URL.

## Google Cloud Storage Buckets

Staging uses separate buckets by data sensitivity and lifecycle. Do not put
website assets, backup artifacts, release evidence, and Terraform state into one
bucket. Mixed buckets create IAM, public-access, retention, and incident-response
confusion.

Current staging project bucket names:

| Bucket | Purpose | Public access | Versioning | Lifecycle | Notes |
| --- | --- | --- | --- | --- | --- |
| `synapse-staging-static-assets-fabled-archive-494108-k5` | Optional public static assets bucket for future CDN-hosted website assets. | Private by default; can be made public/CDN-backed later. | Enabled | Old versions may be cleaned after 90 days. | Not required for Cloud Run front-end deploys. |
| `synapse-staging-backups-fabled-archive-494108-k5` | Staging backup and restore drill artifacts. | Public access prevention enabled. | Optional | Delete staging objects after 30 days. | Never store public website assets here. |
| `synapse-staging-evidence-fabled-archive-494108-k5` | Release evidence, E2E reports, traces, and audit proof. | Public access prevention enabled. | Optional | Retain staging evidence up to 365 days. | Contains private operational evidence; do not make public. |
| `synapse-terraform-state-fabled-archive-494108-k5` | Terraform remote state. | Public access prevention enabled. | Enabled | No short TTL. | Highest-sensitivity infra state bucket; runtime services should not access it. |

Creation status:

- Created in project `fabled-archive-494108-k5` on 2026-04-23.
- Created through `scripts/deploy/gcp_create_staging_buckets.sh`.
- Safety settings applied: uniform bucket-level access, public access prevention
  for private buckets, versioning where required, and lifecycle policies.
- These buckets are not secrets, but `backups`, `evidence`, and
  `terraform-state` must remain private forever.

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
   - Leave `gateway_image`, `gateway_admin_image`, `user_front_image`, and
     `admin_front_image` empty for the first substrate-only apply.
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
   - Arbitrum Sepolia RPC URL and Arbiscan API key.
   - Staging deployer and withdraw signer private keys.
6. Build and push container images to Artifact Registry.
   - Then set the four `*_image` Terraform variables or deploy through
     `gcloud run deploy` for the first smoke.
7. Configure DNS and TLS.
   - `staging.synapse-network.ai`.
   - `api-staging.synapse-network.ai`.
   - `admin-staging.synapse-network.ai`.
   - `admin-api-staging.synapse-network.ai`.
8. Deploy Arbitrum Sepolia staging contracts.
   - Run dry-run first.
   - Deploy owner-only `MockUSDC` and `SynapseCore`.
   - Produce contract deployment evidence.
9. Inject deployed contract addresses into Gateway staging.
   - `ROUTER_ADDRESS`.
   - `USDC_TOKEN_ADDRESS`.
10. Run smoke and release evidence.
    - Health checks.
    - Lark E2E.
    - One-ticket withdrawal evidence.
    - Gateway full-chain staging evidence.

## Terraform Inputs

Local file: `infra/terraform/gcp-staging/terraform.tfvars`. Do not commit it.

| Variable | Example | Purpose | Secret | Source | Location |
| --- | --- | --- | --- | --- | --- |
| `project_id` | `synapse-staging-123` | Google Cloud project id. | No | GCP project | Terraform tfvars |
| `region` | `us-central1` | Cloud Run, Cloud SQL, Artifact Registry region. | No | Ops decision | Terraform tfvars |
| `environment` | `staging` | Resource name/env label. | No | Fixed | Terraform tfvars |
| `backup_bucket_name` | `synapse-staging-backups-<unique>` | GCS bucket for backup/evidence artifacts. | No | Ops-created globally unique name | Terraform tfvars |
| `artifact_registry_repository` | `synapse-staging` | Docker image repository. | No | Fixed | Terraform tfvars |
| `cloud_sql_tier` | `db-f1-micro` | Low-cost Cloud SQL starting tier. | No | Ops decision | Terraform tfvars |
| `cloud_sql_database_name` | `synapse_gateway_staging` | Gateway database name. | No | Fixed | Terraform tfvars |
| `cloud_sql_backup_start_time` | `19:00` | UTC backup time; equals 03:00 Asia/Kuala_Lumpur. | No | Fixed | Terraform tfvars |
| `cloud_sql_transaction_log_retention_days` | `1` | Staging PITR log retention. | No | Fixed | Terraform tfvars |
| `gateway_image` | `us-central1-docker.pkg.dev/<project>/synapse-staging/gateway:<tag>` | Gateway Cloud Run image. | No | Artifact Registry | Terraform tfvars |
| `gateway_admin_image` | `us-central1-docker.pkg.dev/<project>/synapse-staging/gateway-admin:<tag>` | Gateway-admin Cloud Run image. | No | Artifact Registry | Terraform tfvars |
| `user_front_image` | `us-central1-docker.pkg.dev/<project>/synapse-staging/user-front:<tag>` | User-front Cloud Run image. | No | Artifact Registry | Terraform tfvars |
| `admin_front_image` | `us-central1-docker.pkg.dev/<project>/synapse-staging/admin-front:<tag>` | Admin-front Cloud Run image. | No | Artifact Registry | Terraform tfvars |

Leave image variables empty for the first substrate-only Terraform apply. Set
them once images are pushed to Artifact Registry.

These `*_image` values are Docker/OCI container image URLs for Cloud Run. They
are not PNG/JPG/SVG website images.

## Secret Manager

V1 uses Google Cloud Secret Manager with default Google-managed encryption at
rest. Staging does not use Cloud KMS / CMEK.

Write secret values with:

```bash
printf '%s' '<secret-value>' | \
  bash scripts/deploy/gcp_put_secret.sh <synapse-staging-secret-id>
```

Never put secret values in Terraform variables, git, screenshots, evidence, or
shell command arguments.

| Secret id | Purpose | Used by | Source | Required before |
| --- | --- | --- | --- | --- |
| `synapse-staging-postgres-password` | Cloud SQL Gateway app user password. | Gateway, Gateway jobs | Auto-generated by `gcp_staging_bootstrap.sh` | Gateway deploy |
| `synapse-staging-postgres-migrator-password` | Cloud SQL Gateway migrator user password. | DB migration job / release deploy shell | Auto-generated by `gcp_staging_bootstrap.sh` | DB migration |
| `synapse-staging-admin-postgres-password` | Gateway-admin control-plane DB password. | Gateway-admin | User-generated strong password | Gateway-admin deploy |
| `synapse-staging-jwt-secret` | Signs/verifies user-facing Gateway JWTs. | Gateway | User-generated 32+ byte secret | Gateway deploy |
| `synapse-staging-auth-secret` | Wallet challenge/session auth secret. | Gateway | User-generated 32+ byte secret | Gateway deploy |
| `synapse-staging-private-key` | Gateway withdrawal ticket signer private key. | Gateway | Dedicated staging withdraw signer wallet | Withdrawal ticket tests |
| `synapse-staging-gateway-internal-jwt-secret` | Gateway-admin to Gateway internal service-token secret. | Gateway, Gateway-admin | User-generated 32+ byte secret | Admin actions |
| `synapse-staging-admin-csrf-secret` | Gateway-admin CSRF/session protection secret. | Gateway-admin | User-generated 32+ byte secret | Admin login |
| `synapse-staging-gateway-admin-wallet` | Internal admin wallet subject/allow-list identity. | Gateway, Gateway-admin | Dedicated staging admin wallet address | Admin actions |
| `synapse-staging-gmail-username` | Gmail/Workspace sender username. | Email worker | Google Workspace mailbox | Email E2E |
| `synapse-staging-gmail-app-password` | Gmail app password or SMTP relay credential. | Email worker | Google Workspace | Email E2E |
| `synapse-staging-lark-webhook-p0` | P0 Lark war-room webhook URL. | Lark E2E / alert relay | Lark bot | Lark E2E |
| `synapse-staging-lark-webhook-prod-alerts` | Production-alert-hall style webhook used for staging route tests. | Lark E2E / alert relay | Lark bot | Lark E2E |
| `synapse-staging-lark-webhook-staging-drill` | Drill-only Lark webhook URL. | Lark E2E / alert relay | Lark bot | Lark E2E |
| `synapse-staging-lark-secret-p0` | Optional P0 Lark signing secret. | Lark relay | Lark bot config | Only if signing is enabled |
| `synapse-staging-lark-secret-prod-alerts` | Optional prod-alerts Lark signing secret. | Lark relay | Lark bot config | Only if signing is enabled |
| `synapse-staging-lark-secret-staging-drill` | Optional drill Lark signing secret. | Lark relay | Lark bot config | Only if signing is enabled |
| `synapse-staging-arbitrum-sepolia-rpc-url` | Arbitrum Sepolia RPC URL. | Gateway, Hardhat deploy/evidence | Alchemy/Infura/other RPC provider | Contract deploy |
| `synapse-staging-arbiscan-api-key` | Arbiscan source verification API key. | Hardhat verify | Arbiscan account | Contract deploy |
| `synapse-staging-deployer-private-key` | Staging contract deployer private key. | Contract deploy only | Dedicated staging deployer wallet | Contract deploy |
| `synapse-staging-metrics-bearer-token` | Internal `/metrics` scrape bearer token. | Gateway, Gateway-admin | User-generated token | Monitoring |

If Lark bots use keyword-only validation, leave `synapse-staging-lark-secret-*`
unset and ensure E2E messages contain the configured keyword.

## User-front

File: `services/user-front/.env.staging.example`.

| Variable | Staging value | Purpose | Secret | Source |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_GATEWAY_BASE_URL` | `https://api-staging.synapse-network.ai` | Browser API base for all user-facing Gateway calls. | No | Fixed staging domain |
| `NEXT_PUBLIC_APP_ENV` | `staging` | Public UI/runtime environment marker. | No | Fixed |
| `NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS` | `20000` | Service discovery cache TTL. | No | Fixed default |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | `support@synapse-network.ai` | Public support email shown in UI. | No | Ops |
| `NEXT_PUBLIC_SUPPORT_PORTAL_URL` | empty or support URL | Optional support portal deep link. | No | Ops |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | empty or project id | Optional Reown wallet integration. | No | Reown dashboard |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | empty or project id | Optional WalletConnect project id. | No | WalletConnect dashboard |

Do not introduce `NEXT_PUBLIC_API_BASE_URL` unless the frontend code is
intentionally refactored. Current code uses `NEXT_PUBLIC_GATEWAY_BASE_URL`.

## Gateway API

File: `services/gateway/.env.staging.example`.

| Variable | Staging value | Purpose | Secret | Source |
| --- | --- | --- | --- | --- |
| `ENVIRONMENT` | `staging` | Gateway runtime environment. | No | Fixed |
| `CORS_ALLOW_ORIGINS` | `https://staging.synapse-network.ai` | Browser origin allowed to call Gateway. | No | Fixed domain |
| `STORAGE_BACKEND` | `postgres` | Use Postgres-backed storage. | No | Fixed |
| `POSTGRES_HOST` | `/cloudsql/<project>:us-central1:synapse-staging-postgres` | Cloud SQL Unix socket path. | No | Terraform output |
| `POSTGRES_DB` | `synapse_gateway_staging` | Gateway database name. | No | Terraform |
| `POSTGRES_USER` | `synapse_gateway_app` | Gateway DB app user. | No | Bootstrap |
| `POSTGRES_PASSWORD` | Secret Manager value | Gateway DB password. | Yes | `synapse-staging-postgres-password` |
| `POSTGRES_DSN` | empty | Leave empty when split Cloud SQL fields are used. | No | Fixed |
| `POSTGRES_MIGRATOR_USER` | `synapse_gateway_migrator` | DB user used only by `synapse-staging-db-migrate`. | No | Bootstrap |
| `POSTGRES_MIGRATOR_PASSWORD` | Secret Manager value | Migrator password; runtime API services must not receive this. | Yes | `synapse-staging-postgres-migrator-password` |
| `POSTGRES_POOL_MAX` | `5` | Max reusable DB connections per instance. | No | Fixed staging safety limit |
| `POSTGRES_CONNECT_TIMEOUT_SEC` | `5` | DB connect timeout. | No | Fixed |
| `POSTGRES_AUTO_INIT` | `0` | Avoid implicit schema creation in staging. | No | Fixed |
| `JWT_SECRET` | Secret Manager value | User-facing JWT signing secret. | Yes | `synapse-staging-jwt-secret` |
| `AUTH_SECRET` | Secret Manager value | Wallet challenge/session secret. | Yes | `synapse-staging-auth-secret` |
| `GATEWAY_INTERNAL_JWT_SECRET` | Secret Manager value | Validates Gateway-admin internal tokens. | Yes | `synapse-staging-gateway-internal-jwt-secret` |
| `RPC_URL` | Secret Manager value | Runtime Arbitrum Sepolia RPC URL. | Yes | `synapse-staging-arbitrum-sepolia-rpc-url` |
| `ROUTER_ADDRESS` | SynapseCore address | Deployed staging SynapseCore. | No | Contract manifest |
| `USDC_TOKEN_ADDRESS` | MockUSDC address | Deployed owner-only staging MockUSDC. | No | Contract manifest |
| `PRIVATE_KEY` | Secret Manager value | Withdraw ticket signer private key. | Yes | `synapse-staging-private-key` |
| `METRICS_BEARER_TOKEN` | Secret Manager value | App-layer `/metrics` guard. | Yes | `synapse-staging-metrics-bearer-token` |
| `V2_INDEXER_ENABLED` | `false` | Disable API-process indexer; use scheduled job. | No | Fixed Cloud Run staging |
| `PROVIDER_WITHDRAW_EXPIRY_REAPER_ENABLED` | `false` | Disable API-process reaper; use scheduled job. | No | Fixed Cloud Run staging |
| `CONSUMER_WITHDRAW_PROCESSOR_ENABLED` | `false` | Disable API-process consumer processor; use scheduled job. | No | Fixed Cloud Run staging |
| `ANALYTICS_TRANSPORT` | `outbox` | Use Postgres outbox instead of Kafka. | No | MVP default |
| `ANALYTICS_STRICT_KAFKA` | `false` | Do not require Kafka in MVP staging. | No | MVP default |
| `REDIS_URL` | empty | Redis disabled for MVP staging. | No | MVP default |
| `DOWNSTREAM_ADAPTIVE_REDIS_ENABLED` | `false` | Disable Redis-backed adaptive routing. | No | MVP default |
| `EMAIL_OUTBOX_ENABLED` | `true` | Persist async email intents. | No | MVP default |
| `GMAIL_SMTP_USERNAME` | Secret Manager value | SMTP sender username. | Yes | `synapse-staging-gmail-username` |
| `GMAIL_SMTP_APP_PASSWORD` | Secret Manager value | SMTP app password/relay credential. | Yes | `synapse-staging-gmail-app-password` |

## Admin-front

File: `services/admin-front/.env.staging.example`.

| Variable | Staging value | Purpose | Secret | Source |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_ADMIN_API_BASE_URL` | `https://admin-api-staging.synapse-network.ai` | Browser API base for admin console calls. | No | Fixed staging domain |
| `ADMIN_API_PROXY_TARGET` | `https://admin-api-staging.synapse-network.ai` | Next.js rewrite target for `/api/admin/*`. | No | Fixed staging domain |
| `NEXT_PUBLIC_APP_ENV` | `staging` | Public UI/runtime environment marker. | No | Fixed |

## Gateway-admin API

File: `services/gateway-admin/.env.staging.example`.

| Variable | Staging value | Purpose | Secret | Source |
| --- | --- | --- | --- | --- |
| `environment` | `staging` | Admin API environment marker. | No | Fixed |
| `ADMIN_GATEWAY_ALLOWED_ORIGINS` | `https://admin-staging.synapse-network.ai` | Admin-front origin allowed by CORS. | No | Fixed staging domain |
| `ADMIN_SESSION_COOKIE_SECURE` | `true` | Send admin session cookie only over HTTPS. | No | Fixed |
| `ADMIN_SESSION_COOKIE_SAMESITE` | `lax` | Admin session CSRF boundary. | No | Fixed |
| `ADMIN_SESSION_COOKIE_DOMAIN` | `.synapse-network.ai` | Admin session cookie domain. | No | Fixed parent domain |
| `ADMIN_CSRF_SECRET` | Secret Manager value | CSRF/session signing secret. | Yes | `synapse-staging-admin-csrf-secret` |
| `ADMIN_DATABASE_DSN` | Staging admin DB DSN | Admin control-plane database. | Yes | `synapse-staging-admin-postgres-password` |
| `ADMIN_DATABASE_MIGRATION_DSN` | Staging admin migrator DSN | Admin schema migrations. | Yes | Admin DB credential |
| `GATEWAY_READONLY_DSN` | Gateway readonly DSN | Read Gateway projections without write access. | Yes | DB readonly credential |
| `GATEWAY_INTERNAL_BASE_URL` | `https://api-staging.synapse-network.ai` | Internal admin calls to Gateway. | No | Fixed staging domain |
| `GATEWAY_INTERNAL_ADMIN_WALLET` | Secret Manager value or injected address | Internal admin wallet subject. | Yes/Address-sensitive | `synapse-staging-gateway-admin-wallet` |
| `GATEWAY_INTERNAL_JWT_SECRET` | Secret Manager value | Signs Gateway-admin service tokens. | Yes | `synapse-staging-gateway-internal-jwt-secret` |
| `GATEWAY_INTERNAL_TOKEN_ISSUER` | `gateway-admin` | Internal JWT issuer. | No | Fixed |
| `GATEWAY_INTERNAL_TOKEN_AUDIENCE` | `gateway-internal` | Internal JWT audience. | No | Fixed |
| `GATEWAY_INTERNAL_SERVICE_SUBJECT` | `service:gateway-admin` | Internal JWT subject. | No | Fixed |
| `GATEWAY_INTERNAL_TIMEOUT_SEC` | `10` | Gateway internal call timeout. | No | Fixed |
| `EXECUTION_WORKER_ENABLED` | `true` | Enable admin execution worker. | No | Fixed staging default |

Gateway-admin persistence needs an admin database/user. If V1 uses the same
Cloud SQL instance, create a separate admin database and least-privilege user;
do not reuse the Gateway write user for admin control-plane writes.

## Arbitrum Sepolia Deployment

These variables are required for `npm run deploy:contracts:arbitrum-sepolia:*`.

| Variable | Example | Purpose | Secret | Source | Secret Manager |
| --- | --- | --- | --- | --- | --- |
| `ARBITRUM_SEPOLIA_RPC_URL` | `https://arb-sepolia.g.alchemy.com/v2/...` | RPC for deployment, verification gate, and live bytecode reads. | Yes | Alchemy/Infura/other RPC provider | `synapse-staging-arbitrum-sepolia-rpc-url` |
| `STAGING_DEPLOYER_PRIVATE_KEY` | `0x...` | Deploys contracts and pre-mints MockUSDC. | Yes | Dedicated staging deployer wallet | `synapse-staging-deployer-private-key` |
| `STAGING_CONTRACT_OWNER_ADDRESS` | `0x...` | Final owner for MockUSDC/SynapseCore. | No | Dedicated owner wallet address | Not a secret |
| `STAGING_WITHDRAW_SIGNER_ADDRESS` | `0x...` | Public address of Gateway withdraw signer. | No | Derived from `synapse-staging-private-key` | Not a secret |
| `ARBISCAN_API_KEY` | `...` | Arbiscan source verification. | Yes | Arbiscan account | `synapse-staging-arbiscan-api-key` |
| `STAGING_TEST_CONSUMER_ADDRESS` | `0x...` | Dedicated consumer wallet for full-chain E2E. | No | Staging E2E wallet | Not a secret |
| `STAGING_TEST_PROVIDER_ADDRESS` | `0x...` | Dedicated provider wallet for full-chain E2E. | No | Staging E2E wallet | Not a secret |
| `STAGING_MIN_GAS_ETH` | `0.01` | Minimum ETH gas balance preflight. | No | Fixed default | Not a secret |
| `STAGING_TEST_MOCK_USDC_PREMINT` | `100000` | MockUSDC amount pre-minted to E2E wallets. | No | Fixed default | Not a secret |

Required boundaries:

1. Deployer, owner, withdraw signer, consumer, and provider roles must be
   separate unless a risk acceptance explicitly says otherwise.
2. Deployer, consumer, and provider wallets must have Arbitrum Sepolia ETH before
   dry-run.
3. `STAGING_WITHDRAW_SIGNER_ADDRESS` must match the address derived from
   `synapse-staging-private-key`.
4. Staging uses owner-only `MockUSDC`, not production USDC.

## Lark

| Runtime variable | Secret id | Purpose | Required |
| --- | --- | --- | --- |
| `LARK_WEBHOOK_P0_WAR_ROOM` | `synapse-staging-lark-webhook-p0` | P0 war-room delivery. | Yes for Lark E2E |
| `LARK_WEBHOOK_PROD_ALERTS` | `synapse-staging-lark-webhook-prod-alerts` | Prod-alerts style route delivery. | Yes for Lark E2E |
| `LARK_WEBHOOK_STAGING_DRILL` | `synapse-staging-lark-webhook-staging-drill` | Drill-only delivery. | Yes for Lark E2E |
| `LARK_SECRET_P0_WAR_ROOM` | `synapse-staging-lark-secret-p0` | Optional Lark signing secret. | Only if bot signing is enabled |
| `LARK_SECRET_PROD_ALERTS` | `synapse-staging-lark-secret-prod-alerts` | Optional Lark signing secret. | Only if bot signing is enabled |
| `LARK_SECRET_STAGING_DRILL` | `synapse-staging-lark-secret-staging-drill` | Optional Lark signing secret. | Only if bot signing is enabled |

If using keyword-only validation, configure the keyword in Lark and leave the
`LARK_SECRET_*` variables unset.

## Cloud Run Jobs

Cloud Run staging keeps long-running work out of API serving instances.

| Job | Command | Schedule | Lock key | Purpose |
| --- | --- | --- | --- | --- |
| DB migration | `bash scripts/deploy/migrate_db.sh staging` | Manual release step only | n/a | Apply shared schema/reference migrations before API image rollout. |
| Deposit indexer | `python -m src.worker deposit-indexer --once` | Every minute | `deposit-indexer` | Credit confirmed deposits. |
| Provider withdrawal reaper | `python -m src.worker provider-withdraw-reaper --once` | Every minute | `provider-withdraw-reaper` | Expire provider withdrawal tickets safely. |
| Consumer withdrawal processor | `python -m src.worker consumer-withdraw-processor --once` | Every minute | `consumer-withdraw-processor` | Process consumer withdrawal lifecycle. |
| Notification outbox drain | `python -m src.worker notification-outbox --once` | Every minute | `notification-outbox-drain` | Send async Gmail notifications. |
| In-app notification cleanup | `python -m src.worker in-app-cleanup --once` | Daily | `in-app-notification-cleanup` | Delete expired/old inbox rows. |

Each money-sensitive job must use `task_count=1`, `parallelism=1`, and the
Postgres advisory lock. A lock skip logs `JOB_SKIPPED_ALREADY_RUNNING` and exits
successfully unless repeated skips breach alert thresholds.

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

1. Build image.
2. Push Artifact Registry image.
3. Run the DB migration job.
4. Deploy Gateway and Gateway-admin images only after migration succeeds.
5. Deploy frontends and scheduled jobs.
6. Run smoke tests and release evidence.

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

```bash
curl https://staging.synapse-network.ai
curl https://api-staging.synapse-network.ai/health
curl https://admin-staging.synapse-network.ai
curl https://admin-api-staging.synapse-network.ai/health
```

Then run release evidence:

```bash
npm run deploy:contracts:arbitrum-sepolia:dry-run
npm run deploy:contracts:arbitrum-sepolia
npm run ci:contract-deployment-evidence

npm run release:evidence:gateway-fullchain:staging
GATEWAY_RELEASE_E2E_REQUIRED_ENV=staging npm run ci:gateway-release-e2e-evidence

npm run e2e:lark-alerts
npm run ci:lark-alert-e2e-evidence
```
