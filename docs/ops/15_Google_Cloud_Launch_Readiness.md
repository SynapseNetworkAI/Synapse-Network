---
title: Google Cloud Launch Readiness
status: active
owner: ops
last_reviewed: 2026-04-22
---

# Google Cloud Launch Readiness

This document is the Google Cloud staging/prod readiness plan for Synapse
Network. It defines the tooling, staging topology, email setup, production
blockers, and evidence required before launch.

## Tooling Decision

Use Google Cloud official tooling, but keep production control inside Synapse
release gates:

1. `Cloud Shell` for first setup and one-off operations.
2. `gcloud CLI` for project, IAM, Cloud Run, Cloud SQL, API, and Secret
   Manager operations.
3. Terraform for reproducible infrastructure.
4. Gemini CLI / Cloud Assist only as an assistant for command generation and
   troubleshooting; do not let it bypass evidence gates.
5. Gmail SMTP or Google Workspace SMTP relay for outbound notification email,
   delivered through the async notification outbox worker.

Official references:

1. <https://docs.cloud.google.com/sdk/gcloud>
2. <https://docs.cloud.google.com/shell/docs/use-cloud-shell-terminal>
3. <https://docs.cloud.google.com/docs/terraform>
4. <https://docs.cloud.google.com/gemini/docs/codeassist/gemini-cli>
5. <https://support.google.com/a/answer/176600>
6. <https://support.google.com/a/answer/166852>
7. <https://support.google.com/a/answer/2956491>

## MVP Low-Cost Runtime Shape

The MVP launch path is Cloud Run + Cloud SQL first. Do **not** buy a 4c32g
single VM and do **not** deploy Kafka, ClickHouse, Redis, Prometheus, Grafana,
or Alertmanager as staging blockers.

V1 keeps only the components needed to protect money movement and release
evidence:

1. Gateway
2. Gateway-admin
3. User-front
4. Admin-front
5. Cloud SQL Postgres
6. Secret Manager
7. Artifact Registry
8. Cloud Run services and lightweight jobs
9. Cloud Scheduler for periodic jobs
10. Cloud Logging / Cloud Monitoring
11. Lark webhooks
12. Gmail SMTP / Google Workspace relay
13. Arbitrum Sepolia staging contracts

V1 explicitly defers:

1. Redis
2. Kafka
3. ClickHouse
4. self-hosted Prometheus / Grafana / Alertmanager
5. single-VM Docker Compose all-in-one staging
6. GKE
7. multi-region Cloud Run
8. Cloud Spanner / BigQuery

Replacement rules:

1. Redis use cases are handled by Postgres durable idempotency, unique
   constraints, row locks, and conservative low-traffic application limits.
2. Kafka use cases are handled by the Postgres transactional outbox.
3. ClickHouse use cases are handled by Postgres projections and summary tables.
4. Prometheus/Grafana use cases are handled by Cloud Monitoring dashboards,
   logs-based metrics, and Lark alert delivery evidence.

The old GCE + Docker Compose staging plan is retained only as an emergency
fallback in `docs/ops/09_Staging_First_GCE_Rollout.md`.

Terraform scaffold:

```bash
cd infra/terraform/gcp-staging
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
```

Preflight:

```bash
bash scripts/deploy/gcp_preflight.sh <gcp-project-id>
```

The preflight verifies `gcloud`, Terraform, project access, billing, and required
GCP APIs. It may enable missing APIs. Run it from Cloud Shell or a trusted local
machine.

Canonical staging configuration lives in
`docs/ops/17_Staging_Environment_Configuration.md`. Use that document as the
single checklist for staging DNS, Cloud Run env, Secret Manager ids, frontend
URLs, Gateway/Gateway-admin settings, Gmail, Lark, and Arbitrum Sepolia
deployment variables.

## Staging Cloud Resources

Staging resources:

1. Cloud Run services:
   - `synapse-staging-gateway`
   - `synapse-staging-gateway-admin`
   - `synapse-staging-user-front`
   - `synapse-staging-admin-front`
2. Cloud Run jobs or Scheduler-triggered endpoints:
   - `notification-outbox-drain-staging`
   - `withdrawal-reaper-staging`
   - `in-app-notification-cleanup-staging`
   - `backup-restore-drill-staging`
3. Cloud SQL Postgres:
   - `synapse-staging-postgres`
4. Secret Manager:
   - `synapse-staging-*`
5. Artifact Registry:
   - `synapse-staging`
6. Cloud Monitoring:
   - Gateway 5xx
   - Cloud Run errors
   - Cloud SQL CPU, storage, and connections
   - job failures
   - Lark relay failures

Staging Cloud SQL starts small:

```hcl
tier               = "db-f1-micro"
availability_type  = "ZONAL"
disk_type          = "PD_SSD"
disk_size          = 20
disk_autoresize    = true
```

Staging backup policy:

```hcl
backup_configuration {
  enabled                        = true
  start_time                     = "19:00" # UTC; equals 03:00 Asia/Kuala_Lumpur
  point_in_time_recovery_enabled = true
  transaction_log_retention_days = 1
}
```

If full-chain E2E, admin finance views, or Gateway API latency becomes unstable,
upgrade staging to:

```hcl
tier = "db-g1-small"
```

## Production Cloud Resources

Production uses the same simplified shape, but every boundary is isolated from
staging:

1. Separate Cloud SQL instance.
2. Separate secrets.
3. Separate Lark routes.
4. Separate Gmail sender.
5. Separate contract addresses.
6. Separate owner and signer wallets.
7. Separate domain.
8. Separate evidence directory.

Production Cloud SQL minimum:

```hcl
tier                = "db-g1-small"
deletion_protection = true
```

Production backup policy:

```hcl
backup_configuration {
  enabled                        = true
  start_time                     = "19:00" # UTC; equals 03:00 Asia/Kuala_Lumpur
  point_in_time_recovery_enabled = true
  transaction_log_retention_days = 7
}
```

Production must not launch until small-value chain rehearsal, withdrawal caps,
manual approval thresholds, P0 Lark routing, restore evidence, and owner risk
acceptance are attached.

## Google Cloud Infrastructure Checklist

Before staging evidence:

1. GCP project exists and billing is enabled.
2. Required APIs are enabled:
   - Cloud Run
   - Cloud SQL Admin
   - Cloud Scheduler
   - Secret Manager
   - Artifact Registry
   - Cloud Resource Manager
   - IAM
   - Logging
   - Monitoring
   - Cloud Storage
3. Cloud SQL staging instance is created by Terraform.
4. Artifact Registry exists.
5. Secret Manager placeholders exist; real values are added out-of-band.
6. Cloud Run runtime service account has only required roles.
7. Gateway and Gateway-admin deploy with Cloud SQL connection limits.
8. No Postgres port is publicly exposed.
9. DNS points staging domains to Cloud Run or a managed load balancer.
10. TLS is managed by Cloud Run/custom domains or load balancer.
11. GCS staging buckets exist:
    - `synapse-staging-static-assets-fabled-archive-494108-k5`
    - `synapse-staging-backups-fabled-archive-494108-k5`
    - `synapse-staging-evidence-fabled-archive-494108-k5`
    - `synapse-terraform-state-fabled-archive-494108-k5`
12. Cloud Monitoring alerts exist for Cloud Run, Cloud SQL, and jobs.

## Staging Configuration Checklist

Use this section as the staging setup source of truth. Values marked as
`secret` must be stored in Secret Manager, not in Terraform variables, git,
screenshots, Slack/Lark, or evidence reports.

### Local Terraform Input

Create `infra/terraform/gcp-staging/terraform.tfvars` locally. Do not commit it.

Required:

```hcl
project_id         = "<gcp-project-id>"
backup_bucket_name = "synapse-staging-backups-fabled-archive-494108-k5"
```

Recommended staging defaults:

```hcl
region                        = "us-central1"
environment                   = "staging"
artifact_registry_repository  = "synapse-staging"
cloud_sql_tier                = "db-f1-micro"
cloud_sql_backup_start_time   = "19:00" # UTC; 03:00 Asia/Kuala_Lumpur
cloud_sql_transaction_log_retention_days = 1
cloud_sql_retained_backups    = 3
cloud_sql_deletion_protection = false
```

Optional image inputs. Leave them empty for substrate-first apply; set them once
Artifact Registry images exist:

```hcl
gateway_image       = "us-central1-docker.pkg.dev/<project>/synapse-staging/gateway:<tag>"
gateway_admin_image = "us-central1-docker.pkg.dev/<project>/synapse-staging/gateway-admin:<tag>"
user_front_image    = "us-central1-docker.pkg.dev/<project>/synapse-staging/user-front:<tag>"
admin_front_image   = "us-central1-docker.pkg.dev/<project>/synapse-staging/admin-front:<tag>"
```

Non-secret runtime overrides belong in `common_runtime_env` or
`frontend_runtime_env`. Do not put passwords, private keys, JWT secrets, webhook
URLs, or RPC API keys in these maps.

### Cloud SQL

Terraform creates the Cloud SQL instance and database. The application database
user and password are created outside Terraform so the password does not enter
Terraform state:

```bash
gcloud sql users create synapse_gateway_app \
  --instance=synapse-staging-postgres \
  --password='<strong-generated-password>'
```

Store the generated password in Secret Manager:

```bash
printf '%s' '<strong-generated-password>' | \
  gcloud secrets versions add synapse-staging-postgres-password --data-file=-
```

Required Gateway database runtime values:

```bash
POSTGRES_HOST="/cloudsql/<project>:us-central1:synapse-staging-postgres"
POSTGRES_DB="synapse_gateway_staging"
POSTGRES_USER="synapse_gateway_app"
POSTGRES_PASSWORD="<from Secret Manager>"
POSTGRES_POOL_MAX=5
POSTGRES_CONNECT_TIMEOUT_SEC=5
```

### Secret Manager Values

Terraform creates secret placeholders only. Add values out-of-band with
`gcloud secrets versions add`.

Required staging secrets:

| Secret id | Meaning | Used by |
| --- | --- | --- |
| `synapse-staging-postgres-password` | Cloud SQL Gateway app user password | Gateway, Gateway jobs |
| `synapse-staging-admin-postgres-password` | Gateway-admin control-plane DB password | Gateway-admin |
| `synapse-staging-jwt-secret` | User-facing JWT signing/verification secret | Gateway |
| `synapse-staging-auth-secret` | App auth/session secret material | Gateway/User auth |
| `synapse-staging-private-key` | Staging withdraw signer private key | Gateway ticket signing only |
| `synapse-staging-gateway-internal-jwt-secret` | Gateway-admin to Gateway internal auth | Gateway, Gateway-admin |
| `synapse-staging-admin-csrf-secret` | Gateway-admin CSRF/session protection secret | Gateway-admin |
| `synapse-staging-gateway-admin-wallet` | Internal admin wallet subject/allow-list identity | Gateway, Gateway-admin |
| `synapse-staging-gmail-app-password` | Gmail app password or SMTP relay credential | Notification outbox worker |
| `synapse-staging-lark-webhook-p0` | P0 Lark group robot webhook URL | Lark relay / alert jobs |
| `synapse-staging-lark-webhook-prod-alerts` | Staging/prod alert hall webhook for non-P0 route tests | Lark relay / alert jobs |
| `synapse-staging-lark-webhook-staging-drill` | Drill-only Lark webhook URL | Drill alerts |
| `synapse-staging-lark-secret-p0` | Optional P0 Lark signing secret | Lark relay / alert jobs |
| `synapse-staging-lark-secret-prod-alerts` | Optional prod-alerts Lark signing secret | Lark relay / alert jobs |
| `synapse-staging-lark-secret-staging-drill` | Optional staging drill Lark signing secret | Lark relay / alert jobs |

Recommended additional secrets before release evidence:

| Secret id | Meaning |
| --- | --- |
| `synapse-staging-arbitrum-sepolia-rpc-url` | Alchemy/Infura/other Arbitrum Sepolia RPC URL |
| `synapse-staging-arbiscan-api-key` | Arbiscan verification API key |
| `synapse-staging-deployer-private-key` | Staging contract deployer key, used only during deploy |
| `synapse-staging-gmail-username` | Gmail/Workspace sender username |
| `synapse-staging-metrics-bearer-token` | Optional metrics/readiness scrape token |

Use a newline-free write pattern:

```bash
printf '%s' '<secret-value>' | \
  gcloud secrets versions add <secret-id> --data-file=-
```

Never use `echo` for private keys or passwords; shell-dependent newline behavior
creates invisible auth failures.

### Cloud Run Runtime Environment

Staging and production run in Postgres-first mode. The Gateway service and jobs
should receive these non-secret values:

```bash
ENVIRONMENT=staging
STORAGE_BACKEND=postgres
ANALYTICS_TRANSPORT=outbox
ANALYTICS_STRICT_KAFKA=false
ANALYTICS_KAFKA_BOOTSTRAP_SERVERS=

REDIS_URL=
DOWNSTREAM_ADAPTIVE_REDIS_ENABLED=false

EMAIL_OUTBOX_ENABLED=true
IN_APP_NOTIFICATION_CLEANUP_ENABLED=false
V2_INDEXER_ENABLED=false
PROVIDER_WITHDRAW_EXPIRY_REAPER_ENABLED=false
CONSUMER_WITHDRAW_PROCESSOR_ENABLED=false
POSTGRES_AUTO_INIT=0

CHAIN_POLL_INTERVAL_SEC=15
REAPER_POLL_INTERVAL_SEC=60
GATEWAY_RELEASE_E2E_MAX_RPC_CONCURRENCY=3
```

The Gateway API process must not run long loops in staging. Deposit indexing,
withdrawal reaping, email outbox draining, and notification cleanup run through
Cloud Run Jobs triggered by Cloud Scheduler.

### Database Migration And Seed Boundary

Database schema changes use one shared target-state SQL blueprint across local,
staging, and production. Do not create separate `prod_migration` or
`staging_migration` folders. The environment split is the target DSN and the
seed policy, not the schema file.

Run migrations explicitly before deploying API revisions:

```bash
bash scripts/deploy/migrate_db.sh local
bash scripts/deploy/migrate_db.sh staging
SYNAPSE_MIGRATION_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PROD \
  bash scripts/deploy/migrate_db.sh prod
```

Release order:

1. Build images.
2. Push images to Artifact Registry.
3. Run `synapse-staging-db-migrate` / `synapse-prod-db-migrate`.
4. Stop if migration or schema contract validation fails.
5. Deploy Gateway and Gateway-admin services.
6. Deploy frontends and background jobs.
7. Run smoke tests and release evidence.

Runtime services must use `POSTGRES_AUTO_INIT=0`. API containers validate schema
but must not create tables, apply DDL, or run seed data. The migrator user is
separate from the app user:

- App user: runtime reads/writes only.
- Migrator user: release-time DDL and reference data.
- The migration runner grants runtime table/sequence privileges back to the app
  user after applying schema, keeping API containers out of DDL territory.
- Secret ids:
  - `synapse-staging-postgres-password`
  - `synapse-staging-postgres-migrator-password`
  - `synapse-prod-postgres-password`
  - `synapse-prod-postgres-migrator-password`

Seed policy:

- Reference data such as roles, permissions, and default config is allowed in
  every environment if it is idempotent with `ON CONFLICT`.
- Test seed, dogfood seed, fake users, fake services, fake balances, and E2E
  fixture data are forbidden in production.
- Local seed scripts may only target localhost resources.
- Staging evidence seed must include `runId`, dedicated test wallets, or a test
  tenant and must be excluded from real finance reconciliation.

Production migration logs must say:

```text
PROD detected: schema/reference migration only; test seed skipped.
```

After Arbitrum Sepolia deployment evidence passes, inject:

```bash
RPC_URL="<from synapse-staging-arbitrum-sepolia-rpc-url>"
ROUTER_ADDRESS="<SynapseCore from contract-manifest.json>"
USDC_TOKEN_ADDRESS="<MockUSDC from contract-manifest.json>"
PRIVATE_KEY="<from synapse-staging-private-key>"
```

### Arbitrum Sepolia Contract Deployment

Required local/deploy environment for staging contracts:

```bash
ARBITRUM_SEPOLIA_RPC_URL="<rpc-url>"
STAGING_DEPLOYER_PRIVATE_KEY="<deployer-private-key>"
STAGING_CONTRACT_OWNER_ADDRESS="<owner-address>"
STAGING_WITHDRAW_SIGNER_ADDRESS="<withdraw-signer-address>"
STAGING_TEST_CONSUMER_ADDRESS="<consumer-e2e-wallet>"
STAGING_TEST_PROVIDER_ADDRESS="<provider-e2e-wallet>"
ARBISCAN_API_KEY="<arbiscan-key>"
```

Preconditions:

1. Deployer has enough Arbitrum Sepolia ETH for deployment.
2. Consumer and provider test wallets each have at least `0.01 ETH` for gas.
3. Owner, withdraw signer, deployer, consumer, and provider are separate roles.
4. Deployment script pre-mints owner-only MockUSDC to the consumer/provider test
   wallets.

Run:

```bash
npm run deploy:contracts:arbitrum-sepolia:dry-run
npm run deploy:contracts:arbitrum-sepolia
npm run ci:contract-deployment-evidence
```

### Lark and Gmail

Lark route secrets:

```bash
LARK_WEBHOOK_P0_WAR_ROOM="<from Secret Manager>"
LARK_WEBHOOK_PROD_ALERTS="<from Secret Manager>"
LARK_WEBHOOK_STAGING_DRILL="<from Secret Manager>"
```

If the Lark bot uses signature verification, also configure matching
`LARK_SECRET_*` values. If the bot uses keyword-only verification, leave the
secret value unset and ensure messages include the configured keyword such as
`LARK_E2E_TEST` during E2E.

Gmail/SMTP route secrets:

```bash
GMAIL_SMTP_USERNAME="<sender-email>"
GMAIL_SMTP_APP_PASSWORD="<from Secret Manager>"
EMAIL_FROM="Synapse Network Staging <sender-email>"
EMAIL_REPLY_TO="<ops-or-support-email>"
```

Run evidence after deployment:

```bash
npm run e2e:lark-alerts
npm run ci:lark-alert-e2e-evidence
```

### Staging Smoke and Evidence

Minimum smoke:

```bash
curl https://api-staging.synapse-network.ai/health
curl https://admin-api-staging.synapse-network.ai/health
curl https://staging.synapse-network.ai/
curl https://admin-staging.synapse-network.ai/
```

Release evidence:

```bash
npm run release:evidence:gateway-fullchain:staging
GATEWAY_RELEASE_E2E_REQUIRED_ENV=staging npm run ci:gateway-release-e2e-evidence

npm run e2e:withdrawal-one-ticket-evidence
npm run ci:withdrawal-one-ticket-evidence

npm run e2e:in-app-notifications
npm run ci:in-app-notifications-evidence
```

## Secret Manager Default Encryption

V1 uses Secret Manager as the application secret store with Google-managed
default encryption at rest. Do **not** enable Cloud KMS / CMEK for MVP staging.

This keeps the launch path simple:

1. Terraform creates Secret Manager secret placeholders.
2. `gcp_staging_bootstrap.sh` creates the Cloud SQL app user and writes the
   generated password to Secret Manager.
3. `gcp_put_secret.sh` writes third-party credentials and wallet material from
   stdin into Secret Manager.
4. Cloud Run reads secrets through Secret Manager IAM.

Why no CMEK in V1:

1. Secret Manager already encrypts secrets at rest by default.
2. CMEK adds key lifecycle and IAM complexity that can break all secrets if the
   key is disabled or misconfigured.
3. CMEK is a future compliance option, not an MVP staging blocker.
4. Gateway should not call KMS directly or receive KMS IAM roles.

Only revisit CMEK when enterprise customers, formal compliance, or explicit
customer-managed-key ownership becomes a real requirement.

### Bootstrap Script

After Terraform creates Cloud SQL and Secret Manager placeholders, run:

```bash
bash scripts/deploy/gcp_staging_bootstrap.sh <gcp-project-id>
```

The bootstrap script:

1. Verifies the active `gcloud` project matches `<gcp-project-id>`.
2. Verifies billing access and required APIs.
3. Verifies Terraform-created Cloud SQL and Secret Manager resources exist.
4. Generates a random Cloud SQL password with `openssl rand -base64 32`.
5. Creates or updates the `synapse_gateway_app` Cloud SQL user.
6. Writes the generated password to `synapse-staging-postgres-password`.
7. Prints the remaining secret ids that still need user-provided values.

It does not print the generated password, write it to disk, put it in Terraform
state, or call any KMS/CMEK command.

### Secret Writer Script

Write user-provided secret values through stdin:

```bash
printf '%s' '<secret-value>' | \
  bash scripts/deploy/gcp_put_secret.sh synapse-staging-jwt-secret
```

The secret writer:

1. Only accepts secret ids beginning with `synapse-staging-`.
2. Rejects secret values passed as CLI arguments.
3. Rejects empty stdin.
4. Verifies the Secret Manager placeholder exists.
5. Adds a new secret version without printing the value.

Use this for Lark webhooks, Gmail credentials, JWT secrets, Arbitrum RPC URLs,
Arbiscan API keys, and staging private keys.

### Cloud Run Access Pattern

Grant the Cloud Run runtime service account access to Secret Manager:

```bash
gcloud secrets add-iam-policy-binding synapse-staging-jwt-secret \
  --project="<gcp-project-id>" \
  --member="serviceAccount:synapse-staging-runtime@<gcp-project-id>.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Then deploy with secret injection:

```bash
gcloud run deploy synapse-staging-gateway \
  --region="us-central1" \
  --set-secrets="JWT_SECRET=synapse-staging-jwt-secret:latest,POSTGRES_PASSWORD=synapse-staging-postgres-password:latest"
```

Cloud Run uses Secret Manager to resolve the secret. Secret Manager applies
Google-managed default encryption at rest. The Gateway process never receives
KMS credentials and never calls `cloudkms.googleapis.com`.

## Cloud SQL Connection Guard

If staging/prod uses Cloud SQL Postgres, do not append SQLAlchemy-style
connection pool parameters such as `?pool_size=5&max_overflow=2` to
`POSTGRES_DSN`. Gateway uses `psycopg` plus its own `DatabaseManager`, so the
effective pool control is the explicit environment variable below:

```bash
POSTGRES_POOL_MAX=5
POSTGRES_CONNECT_TIMEOUT_SEC=5
```

For small Cloud SQL staging instances such as `db-f1-micro`, keep Gateway
`POSTGRES_POOL_MAX=5` and cap Cloud Run to at most two instances. Total possible
Gateway database connections are roughly:

```text
Cloud Run max instances * POSTGRES_POOL_MAX
```

Gateway enforces `POSTGRES_POOL_MAX` as a fail-closed safety boundary. Valid
values are `1..10`. Values above `10`, zero, or non-integer values must stop
startup with `DB-CONFIG-001` instead of silently falling back. This is deliberate:
on `db-f1-micro`, excessive open connections can cause memory exhaustion that is
harder to diagnose than a clean startup failure.

Recommended MVP Cloud Run limits:

1. Staging Gateway: `--concurrency=20 --max-instances=2 --min-instances=0`.
2. Production Gateway: `--concurrency=40 --max-instances=3 --min-instances=1`.
3. Gateway-admin: `POSTGRES_POOL_MAX=3` because admin traffic is lower and
   queries can be heavier.

Production `synapse-gateway` keeps `min-instances=1`. Treat this as payment
entrypoint availability insurance, not a performance luxury: the first real
deposit, invoke, or withdrawal request should not pay a cold-start penalty.
Staging and non-critical admin/front services may keep `min-instances=0` to
preserve the low-cost profile.

Upgrade staging Cloud SQL from `db-f1-micro` to `db-g1-small` if any of these
signals appear:

1. Gateway logs contain `too many connections`.
2. Full-chain E2E fails due to DB latency or connection timeout.
3. Cloud SQL CPU stays above 70%.
4. Cloud SQL active connections approach the instance limit.
5. Finance/admin views show repeated p95 latency spikes.

Alerting must include a P1 route for Cloud SQL connections above 80% of the
instance limit for five minutes, and for Gateway `too many connections` log
matches. The Lark action should tell the operator to reduce Cloud Run
max-instances/concurrency or upgrade Cloud SQL tier.

Deposit indexing alerts:

1. P2: deposit indexing delay above two minutes.
2. P1: deposit indexing delay above five minutes.
3. P1: scheduled job failures above threshold.
4. P1: `JOB_SKIPPED_ALREADY_RUNNING` repeats for more than five minutes.

Release evidence should record `indexed_at`, `credited_at`, delay seconds, and
the scheduled job lock skip summary. `alreadyRunningSkipped` may be non-zero,
but it must not coincide with duplicate credits, duplicate withdrawal release,
or ledger/vault unexplained delta.

## Email Readiness

V1 email uses Gmail SMTP or Google Workspace SMTP relay.

Required:

1. Dedicated staging sender mailbox.
2. Dedicated production sender mailbox.
3. App password or SMTP relay configured outside git.
4. SPF, DKIM, and DMARC configured.
5. Gmail daily quota alert enabled.
6. `notification-outbox` worker deployed.
7. Test email evidence generated.

Environment variables are documented in
`docs/ops/14_Gmail_Email_Notifications.md` and gateway `.env.*.example` files.

Email is not a P0 incident channel. P0 incidents use Lark alerts backed by
Cloud Monitoring.

## Gateway Runtime Configuration

Staging and production run in Postgres-first mode:

```bash
STORAGE_BACKEND=postgres
ANALYTICS_TRANSPORT=outbox
ANALYTICS_STRICT_KAFKA=false
ANALYTICS_KAFKA_BOOTSTRAP_SERVERS=

REDIS_URL=
DOWNSTREAM_ADAPTIVE_REDIS_ENABLED=false

EMAIL_OUTBOX_ENABLED=true
IN_APP_NOTIFICATION_CLEANUP_ENABLED=false
V2_INDEXER_ENABLED=false
PROVIDER_WITHDRAW_EXPIRY_REAPER_ENABLED=false
CONSUMER_WITHDRAW_PROCESSOR_ENABLED=false

RPC_URL=<arbitrum-rpc-url>
ROUTER_ADDRESS=<SynapseCore>
USDC_TOKEN_ADDRESS=<MockUSDC for staging or real USDC for production>
PRIVATE_KEY=<withdraw signer private key>
```

API requests must not wait on Gmail, analytics publishing, notification cleanup,
deposit indexing, or long reaper loops. Long-running work runs as Cloud Run jobs
triggered by Cloud Scheduler. Money state transitions stay inside Gateway and
Postgres transaction boundaries.

Cloud Scheduler has a hard one-minute practical floor. MVP accepts that deposit
credits can take roughly 1-2 minutes to appear after on-chain confirmation; the
User-front deposit modal must say this clearly instead of adding high-frequency
RPC polling.

Every money-sensitive scheduled job uses two layers of overlap protection:

1. Cloud Run Job template sets `task_count=1` and `parallelism=1`.
2. The worker takes a Postgres advisory lock at startup. If the previous
   execution is still running, it logs `JOB_SKIPPED_ALREADY_RUNNING` and exits
   successfully. This skip is not an incident by itself; repeated skips for more
   than five minutes are a P1 because they indicate a stuck worker or slow RPC.

Scheduled job defaults:

| Job | Command | Schedule | Retry | Lock key |
| --- | --- | --- | --- | --- |
| DB migration | `bash scripts/deploy/migrate_db.sh staging\|prod` | manual release step only | 0 | n/a |
| Deposit indexer | `python -m src.worker deposit-indexer --once` | every 1 minute | 0 | `deposit-indexer` |
| Provider withdrawal reaper | `python -m src.worker provider-withdraw-reaper --once` | every 1 minute | 0 | `provider-withdraw-reaper` |
| Consumer withdrawal processor | `python -m src.worker consumer-withdraw-processor --once` | every 1 minute | 0 | `consumer-withdraw-processor` |
| Gmail outbox drain | `python -m src.worker notification-outbox --once` | every 1 minute | 1 | `notification-outbox-drain` |
| In-app notification cleanup | `python -m src.worker in-app-cleanup --once` | daily | 0 | `in-app-notification-cleanup` |

## Staging Chain Readiness

Staging contracts are deployed to Arbitrum Sepolia (`chainId=421614`) with a
self-deployed owner-only `MockUSDC`. This is the required chain target for
Gateway staging evidence.

Required commands:

```bash
npm run deploy:contracts:arbitrum-sepolia:dry-run
npm run deploy:contracts:arbitrum-sepolia
npm run ci:contract-deployment-evidence
```

The deployment evidence lives under:

```text
docs/evidence/release/contracts/arbitrum-sepolia/<timestamp>-deploy/
```

The evidence must prove:

1. `chainId === 421614`.
2. `MockUSDC` and `SynapseCore` bytecode exists on Arbitrum Sepolia.
3. ABI, bytecode, and constructor arg hashes match local artifacts.
4. Arbiscan source verification succeeded or was already verified.
5. Deployer, contract owner, and withdraw signer are separate roles.
6. Dedicated staging consumer/provider wallets have gas.
7. Dedicated staging consumer/provider wallets received preallocated MockUSDC.

After the gate passes, inject the manifest addresses into Gateway staging:

```bash
RPC_URL="$ARBITRUM_SEPOLIA_RPC_URL"
ROUTER_ADDRESS="<SynapseCore from contract-manifest.json>"
USDC_TOKEN_ADDRESS="<MockUSDC from contract-manifest.json>"
PRIVATE_KEY="<staging withdraw signer private key>"
```

Details: `docs/ops/16_Arbitrum_Sepolia_Staging_Contracts.md`.

## Current Production NO-GO Blockers

Production is still `NO-GO` until all items below have evidence:

1. Gateway full-chain staging E2E:
   - `npm run release:evidence:gateway-fullchain:staging`
   - `GATEWAY_RELEASE_E2E_REQUIRED_ENV=staging npm run ci:gateway-release-e2e-evidence`
   - Required artifacts include `trace.jsonl`; `report.json.traceDigest` must
     equal the SHA-256 of that trace file. The trace stores sanitized request,
     response, expected-vs-actual, reconciliation, ticket, and tx checkpoints for
     every core scenario.
2. One-ticket withdrawal 10-scenario evidence:
   - `npm run e2e:withdrawal-one-ticket-evidence`
   - `npm run ci:withdrawal-one-ticket-evidence`
3. Contract release evidence:
   - Arbitrum Sepolia staging dry-run and deployment evidence
   - `npm run ci:contract-deployment-evidence`
   - fork test output
   - deployment dry-run
   - ABI hash
   - bytecode hash
   - source verification link
   - constructor args verification
   - production release manifest
   - small-value chain rehearsal tx hashes
4. Production-grade load and concurrency evidence:
   - invoke
   - balance
   - withdrawal
   - deposit confirm
   - provider health
   - admin finance views
   - high-concurrency money safety
5. Ledger/vault reconciliation report.
6. Monitoring and alert evidence:
   - dashboards
   - alert drill screenshots
   - `/metrics` proxy allowlist proof
   - on-call route
   - escalation policy
   - incident template
   - customer communication template
   - postmortem template
7. Backup/restore drill:
   - `SYNAPSE_DRILL_ENV=staging SYNAPSE_DRILL_CONFIRM=I_UNDERSTAND_THIS_CHANGES_STAGING npm run drill:backup-restore:staging`
   - `npm run ci:backup-restore-evidence`
8. Production config review:
   - contract addresses
   - chain id and RPC endpoints
   - USDC address
   - CORS allowlist
   - JWT/TOTP/internal token handling
   - DB TLS and least privilege
   - backup retention
   - secret storage proof
   - owner/multisig/signer proof
9. Sign-off from engineering, security, finance/ledger, and operations owners.

## Recommended Execution Order

1. Create GCP staging infrastructure through Terraform.
2. Push images to Artifact Registry.
3. Configure Cloud SQL connection caps and Secret Manager values.
4. Run DB migration job.
5. Deploy Cloud Run services with low max-instance limits.
6. Configure Lark alert routes and run Lark E2E evidence.
7. Configure Gmail sender and run email notification evidence.
8. Configure Cloud Monitoring alert policies and drill alerts.
9. Run Arbitrum Sepolia contract deployment evidence.
10. Run Gateway full-chain release E2E in staging.
11. Run one-ticket withdrawal 10-scenario evidence.
12. Run local and staging load/reconciliation evidence.
13. Run backup/restore drill.
14. Attach all evidence to production validation.
15. Only then prepare production infrastructure and small-value rehearsal.

## Hard Rules

1. Do not use local CI as production evidence.
2. Do not put secrets in Terraform variables, git, screenshots, or evidence.
3. Do not expose Postgres or `/metrics` publicly.
4. Do not run destructive restore against production.
5. Do not represent internal audit as third-party audit.
6. Do not launch production while validation remains `NO-GO`.
7. Do not reintroduce Redis, Kafka, or ClickHouse as MVP launch blockers without
   a new cost/risk review.
