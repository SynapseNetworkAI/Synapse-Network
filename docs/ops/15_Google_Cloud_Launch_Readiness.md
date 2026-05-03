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

Canonical staging validation lives in
`docs/ops/18_Staging_Validation_Runbook.md`. Use it after deployment to verify
DNS/TLS, Cloud Run health, CORS, Arbitrum Sepolia contracts, Gateway full-chain
behavior, UI dogfood, notifications, and recovery evidence.

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
edition            = "ENTERPRISE"
availability_type  = "ZONAL"
disk_type          = "PD_SSD"
disk_size          = 20
disk_autoresize    = true
```

Staging must use Cloud SQL `ENTERPRISE` edition for shared-core tiers such as
`db-f1-micro`. `ENTERPRISE_PLUS` requires performance-optimized tiers and will
reject `db-f1-micro`.

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

## Staging Enabled Services and Cost Estimate

Terraform and the staging preflight enable only the MVP cloud-native substrate.
API enablement itself is not the cost center; the bill comes from provisioned
resources, stored data, job executions, request processing, log ingestion, and
network egress.

Required APIs enabled by `scripts/deploy/gcp_preflight.sh`:

1. `run.googleapis.com`
2. `sqladmin.googleapis.com`
3. `cloudscheduler.googleapis.com`
4. `secretmanager.googleapis.com`
5. `artifactregistry.googleapis.com`
6. `cloudresourcemanager.googleapis.com`
7. `iam.googleapis.com`
8. `logging.googleapis.com`
9. `monitoring.googleapis.com`
10. `storage.googleapis.com`

Terraform-created billable resources:

| Service                                   | Terraform resource                                                                  | What it is used for                                                                  | Billing model                                                                               | Staging default                                                                                                                                         | Monthly estimate                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Cloud SQL for PostgreSQL                  | `google_sql_database_instance.postgres`, `google_sql_database.gateway`              | Source of truth for ledger, idempotency, outbox, inbox, admin projections, and jobs  | Instance hours, storage, backups, network egress                                            | `db-f1-micro`, `ENTERPRISE`, zonal, 20 GB SSD, PITR 1 day                                                                                               | `$12-$18`                             |
| Cloud Run services                        | `google_cloud_run_v2_service.*`                                                     | Gateway, Gateway-admin, User-front, Admin-front                                      | Request/instance time, vCPU, memory, requests, outbound egress, min instances if configured | Staging `min_instances=0`; services created only when image variables are non-empty                                                                     | `$0-$10` for low traffic              |
| Cloud Run jobs                            | `google_cloud_run_v2_job.*`                                                         | Deposit indexer, withdrawal processors, notification drain, cleanup, DB migration    | Job execution CPU/memory time, container startup time, outbound egress                      | Jobs created only when `gateway_image` is set; money jobs run every minute                                                                              | `$0-$5`                               |
| Cloud Scheduler                           | `google_cloud_scheduler_job.jobs`                                                   | Triggers periodic Cloud Run jobs                                                     | Per scheduler job per month; first 3 jobs are free per billing account                      | 5 scheduled jobs when `gateway_image` is set                                                                                                            | `$0.20-$1`                            |
| Artifact Registry                         | `google_artifact_registry_repository.docker`                                        | Stores Docker images for Cloud Run deploys                                           | Artifact storage over free tier, data transfer, optional vulnerability scanning             | Regional repo `synapse-staging`; cleanup deletes untagged images after 7 days, staging tags after 45 days, and keeps the 10 newest versions per package | `$0.20-$3` depending on image history |
| Cloud Storage buckets                     | `google_storage_bucket.backups` plus manually created static/evidence/state buckets | Cloud SQL backups/export artifacts, evidence archive, static assets, Terraform state | GB-month storage, operations, retrieval, egress                                             | Four `us-central1` buckets with lifecycle policy; evidence release records 365 days, debug/failed evidence 30 days, Terraform noncurrent state 365 days | `$0-$5` for tens of GB                |
| Secret Manager                            | `google_secret_manager_secret.placeholders`                                         | Runtime secrets, private keys, webhook URLs, SMTP credentials, RPC keys              | Active secret versions and access operations                                                | About 20 staging secret placeholders, values added out-of-band                                                                                          | `$1-$3`                               |
| Cloud Logging / Cloud Monitoring          | Google-managed service usage from Cloud Run, Cloud SQL, jobs, alerts                | Logs, metrics, alerting, dashboards, uptime/monitoring features                      | Log ingestion/storage and chargeable custom metrics or checks beyond free allotments        | Use low-volume structured logs and avoid noisy debug logs                                                                                               | `$0-$5` initially                     |
| IAM / service accounts / Resource Manager | `google_service_account.*`, IAM bindings                                            | Runtime identity and least-privilege access                                          | No direct monthly charge for IAM bindings                                                   | Runtime and Scheduler service accounts                                                                                                                  | `$0`                                  |

Current staging estimate:

| Deployment phase                                       | Expected monthly cost | Notes                                                                                         |
| ------------------------------------------------------ | --------------------: | --------------------------------------------------------------------------------------------- |
| Substrate only, before Cloud Run images are set        |             `$15-$25` | Cloud SQL, buckets, secrets, Artifact Registry, and low/no Scheduler usage dominate.          |
| MVP staging with Cloud Run services and scheduled jobs |             `$25-$45` | Assumes low traffic, `min_instances=0`, small logs, small image retention, and `db-f1-micro`. |
| Staging after Cloud SQL upgrade to `db-g1-small`       |             `$40-$70` | Use only if E2E/admin views show DB pressure, connection pressure, or latency instability.    |

Cost guardrails:

1. Keep all staging Cloud Run services at `min_instances=0`; production Gateway
   is the only MVP service that should use `min_instances=1`.
2. Keep `POSTGRES_POOL_MAX=5` for Gateway and `POSTGRES_POOL_MAX=3` for
   Gateway-admin so Cloud SQL does not get crushed by connection count.
3. Do not set Cloud Run image variables until images are ready. Empty image
   variables let Terraform create the durable substrate without starting
   services/jobs.
4. Keep Artifact Registry retention short. Delete stale image tags after
   release evidence is captured.
5. Prefer Cloud Build for staging image builds on Apple Silicon laptops. Local
   Docker `linux/amd64` builds emulate x86 and can OOM during Next.js builds;
   Cloud Build shifts the heavy work to an ephemeral Google builder and pushes
   directly to Artifact Registry.
6. Keep Cloud Logging at `INFO` for staging and avoid per-request debug body
   logs. Debug logs can quietly become the real tax monster.
7. Configure a Billing Budget for staging at `$50/month` with alerts at
   `50%`, `80%`, and `100%`.
8. If monthly staging cost exceeds `$50` before real traffic, inspect Cloud SQL,
   Cloud Run min instances, log ingestion, image retention, and egress before
   increasing infrastructure size.

Pricing references:

1. Cloud Run: <https://cloud.google.com/run/pricing>
2. Cloud SQL for PostgreSQL: <https://cloud.google.com/sql/docs/postgres/pricing>
3. Cloud Scheduler: <https://cloud.google.com/scheduler/pricing>
4. Artifact Registry: <https://cloud.google.com/artifact-registry/pricing>
5. Cloud Storage: <https://cloud.google.com/storage/pricing>
6. Secret Manager: <https://cloud.google.com/secret-manager/pricing>
7. Google Cloud Observability: <https://cloud.google.com/stackdriver/pricing>

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
cloud_sql_edition             = "ENTERPRISE"
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

Before deploying or updating any Cloud Run service/job that references
Secret Manager, every referenced placeholder must already have at least one
enabled version:

```bash
bash scripts/deploy/gcp_check_staging_cloud_run_secret_versions.sh fabled-archive-494108-k5
```

This check is mandatory before `terraform apply` updates Cloud Run images,
env vars, jobs, or Scheduler-backed workers. A placeholder alone is not enough:
Cloud Run validates `secret:latest` during revision/job creation, and a missing
enabled version can fail the apply after unrelated resources were already
updated.

Required staging secrets:

| Secret id                                     | Meaning                                                | Used by                                      |
| --------------------------------------------- | ------------------------------------------------------ | -------------------------------------------- |
| `synapse-staging-postgres-password`           | Cloud SQL Gateway app user password                    | Gateway, Gateway jobs                        |
| `synapse-staging-admin-postgres-password`     | Gateway-admin control-plane DB password                | Gateway-admin                                |
| `synapse-staging-jwt-secret`                  | User-facing JWT signing/verification secret            | Gateway                                      |
| `synapse-staging-auth-secret`                 | App auth/session secret material                       | Gateway/User auth                            |
| `synapse-staging-withdraw-signer`             | Dedicated staging Cloud KMS asymmetric signer          | Gateway withdrawal ticket signing only       |
| `synapse-staging-private-key`                 | Legacy staging withdraw signer private key             | Cleanup only after KMS withdrawal E2E passes |
| `synapse-staging-gateway-internal-jwt-secret` | Gateway-admin to Gateway internal auth                 | Gateway, Gateway-admin                       |
| `synapse-staging-admin-csrf-secret`           | Gateway-admin CSRF/session protection secret           | Gateway-admin                                |
| `synapse-staging-gateway-admin-wallet`        | Internal admin wallet subject/allow-list identity      | Gateway, Gateway-admin                       |
| `synapse-staging-gmail-app-password`          | Gmail app password or SMTP relay credential            | Notification outbox worker                   |
| `synapse-staging-lark-webhook-p0`             | P0 Lark group robot webhook URL                        | Lark relay / alert jobs                      |
| `synapse-staging-lark-webhook-prod-alerts`    | Staging/prod alert hall webhook for non-P0 route tests | Lark relay / alert jobs                      |
| `synapse-staging-lark-webhook-staging-drill`  | Drill-only Lark webhook URL                            | Drill alerts                                 |
| `synapse-staging-lark-secret-p0`              | Optional P0 Lark signing secret                        | Lark relay / alert jobs                      |
| `synapse-staging-lark-secret-prod-alerts`     | Optional prod-alerts Lark signing secret               | Lark relay / alert jobs                      |
| `synapse-staging-lark-secret-staging-drill`   | Optional staging drill Lark signing secret             | Lark relay / alert jobs                      |

Recommended additional secrets before release evidence:

| Secret id                                  | Meaning                                                |
| ------------------------------------------ | ------------------------------------------------------ |
| `synapse-staging-arbitrum-sepolia-rpc-url` | Alchemy/Infura/other Arbitrum Sepolia RPC URL          |
| `synapse-staging-arbiscan-api-key`         | Arbiscan verification API key                          |
| `synapse-staging-deployer-private-key`     | Staging contract deployer key, used only during deploy |
| `synapse-staging-gmail-username`           | Gmail/Workspace sender username                        |
| `synapse-staging-metrics-bearer-token`     | Optional metrics/readiness scrape token                |

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
3. Run Gateway schema migration for every Gateway rollout:
   `synapse-staging-db-migrate` /
   `synapse-prod-db-migrate`.
4. Run Gateway-admin schema migration before any Gateway-admin rollout:
   `synapse-staging-gateway-admin-db-migrate` /
   `synapse-prod-gateway-admin-db-migrate`.
5. Stop if either migration or schema contract validation fails.
6. If Gateway changed, update all Gateway Cloud Run Jobs to the same Gateway
   image digest before the API rollout.
7. Deploy Gateway and Gateway-admin services.
8. Deploy frontends.
9. Run smoke tests and release evidence.

For staging, Gateway releases also run the live drift guard after smoke tests.
The guard checks free-service schema semantics (`quoted_price_usdc >= 0`),
signature secret newline/placeholder lint, Gateway/Provider shared secret ids,
Provider Cloud SQL attachment, Provider endpoint prefix, Provider discovery, and
Gateway service/job image digest alignment. Production promotion must either
reuse the same gate against production resources or provide equivalent manifest
evidence before GO.

Gateway jobs are separate Cloud Run Jobs but not separate code packages. They run
`python -m src.worker <job> --once` from the same Gateway image used by the API.
Do not let `synapse-staging-gateway` and the Gateway scheduled jobs drift to
different digests during normal releases; the release manifest must record the
service digest, job digests, and `jobImageDrift=false`.

Gateway-admin is not allowed to rely on runtime auto-init. Its admin database
must already contain the admin users, sessions, MFA, audit, config, and
projection tables before the Cloud Run revision starts. This is release
critical: staging already proved that deploying Gateway-admin before its schema
exists turns login and withdrawal review into 500s. Production must run the
admin migration job first, then deploy `synapse-prod-gateway-admin`.

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
WITHDRAW_SIGNER_MODE="gcp_kms"
WITHDRAW_SIGNER_GCP_KMS_KEY_NAME="projects/fabled-archive-494108-k5/locations/us-central1/keyRings/synapse-staging/cryptoKeys/synapse-staging-withdraw-signer/cryptoKeyVersions/1"
WITHDRAW_SIGNER_ADDRESS="<kms-derived Ethereum address>"
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

## Secret Manager And KMS Boundary

V1 uses Secret Manager as the application secret store with Google-managed
default encryption at rest. Do **not** enable Cloud KMS / CMEK for MVP staging
Secret Manager envelope encryption.

Withdrawal-ticket signing is a separate custody boundary. Staging uses a
dedicated Cloud KMS secp256k1 signer named `synapse-staging-withdraw-signer`;
production must use its own separate KMS/HSM signer.

This keeps the launch path simple:

1. Terraform creates Secret Manager secret placeholders.
2. `gcp_staging_bootstrap.sh` creates the Cloud SQL app user and writes the
   generated password to Secret Manager.
3. `gcp_put_secret.sh` writes third-party credentials and deployment-only wallet
   material from stdin into Secret Manager.
4. Cloud Run reads staging secrets through Secret Manager IAM.
5. Gateway signs withdrawal tickets through Cloud KMS; it does not receive a raw
   withdrawal signer `PRIVATE_KEY`.

Why no CMEK in V1:

1. Secret Manager already encrypts secrets at rest by default.
2. CMEK adds key lifecycle and IAM complexity that can break all secrets if the
   key is disabled or misconfigured.
3. CMEK is a future compliance option, not an MVP staging blocker.
4. Staging no longer uses a runtime Secret Manager private key for
   withdrawal-ticket signing after the KMS migration. The old
   `synapse-staging-private-key` secret is cleanup-only and must not be injected
   into Gateway services or jobs.

Only revisit CMEK when enterprise customers, formal compliance, or explicit
customer-managed-key ownership becomes a real requirement.

Production withdrawal-ticket signing is a separate custody boundary:

1. Staging and production must use `WITHDRAW_SIGNER_MODE=gcp_kms` or an
   equivalent HSM-backed signer. Raw `PRIVATE_KEY` ticket signing is local-only
   after staging KMS evidence is green.
2. The Gateway runtime service account may receive sign-only access to one
   configured KMS key resource for withdrawal-ticket signing.
3. The Gateway must derive/recover the Ethereum signer address from every KMS
   signature and fail closed if it does not match `SynapseCore.platformSigner()`.
4. Gateway-admin, frontends, local laptops, and deploy jobs must not receive
   default KMS sign access.
5. Staging and production must not share the same KMS signer key. Prefer
   separate GCP projects; otherwise use distinct key rings / crypto keys such as
   `synapse-staging-withdraw-signer` and `synapse-prod-withdraw-signer`, with IAM
   scoped so each Gateway service account can sign only its own environment key.

Staging KMS migration evidence:

```bash
gcloud auth login
gcloud config set project fabled-archive-494108-k5

bash scripts/deploy/gcp_audit_staging_security_config.sh fabled-archive-494108-k5

node scripts/chain/gcp_kms_derive_eth_address.mjs \
  projects/fabled-archive-494108-k5/locations/us-central1/keyRings/synapse-staging/cryptoKeys/synapse-staging-withdraw-signer/cryptoKeyVersions/1
```

Only after Gateway runs with `WITHDRAW_SIGNER_MODE=gcp_kms`, on-chain
`SynapseCore.platformSigner()` equals the derived address, and a small-value
withdrawal E2E passes may the legacy `synapse-staging-private-key` secret be
deleted with `scripts/deploy/gcp_cleanup_staging_security_config.sh`.

### Bootstrap Script

After Terraform creates Cloud SQL and Secret Manager placeholders, run:

```bash
bash scripts/deploy/gcp_staging_bootstrap.sh <gcp-project-id>
```

The bootstrap script:

1. Verifies the active `gcloud` project matches `<gcp-project-id>`.
2. Verifies billing when the Billing API returns a clear answer.
   - `billingEnabled=true`: continue.
   - `billingEnabled=false`: fail closed.
   - Billing API visibility/permission mismatch: warn and continue, because
     Terraform-created Cloud SQL / Secret Manager resources already prove the
     project is accessible.
3. Verifies Terraform-created Cloud SQL and Secret Manager resources exist.
4. Generates a random Cloud SQL password with `openssl rand -base64 32`.
5. Creates or updates the `synapse_gateway_app` Cloud SQL user.
6. Writes the generated password to `synapse-staging-postgres-password`.
7. Prints the remaining secret ids that still need user-provided values.

It does not print the generated password, write it to disk, put it in Terraform
state, or call any CMEK command. Production KMS signer setup is a separate
custody task, not part of staging bootstrap.

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
Google-managed default encryption at rest. In staging, the Gateway process does
not need Cloud KMS roles. In production, grant the Gateway runtime service
account only the minimal KMS asymmetric-sign permission for the configured
withdrawal signer key.

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
WITHDRAW_SIGNER_MODE=gcp_kms
WITHDRAW_SIGNER_GCP_KMS_KEY_NAME=<staging kms key version resource>
WITHDRAW_SIGNER_ADDRESS=<kms-derived Ethereum address>
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

| Job                           | Command                                                   | Schedule                 | Retry | Lock key                      |
| ----------------------------- | --------------------------------------------------------- | ------------------------ | ----- | ----------------------------- |
| DB migration                  | `bash scripts/deploy/migrate_db.sh staging\|prod`         | manual release step only | 0     | n/a                           |
| Deposit indexer               | `python -m src.worker deposit-indexer --once`             | every 1 minute           | 0     | `deposit-indexer`             |
| Provider withdrawal reaper    | `python -m src.worker provider-withdraw-reaper --once`    | every 1 minute           | 0     | `provider-withdraw-reaper`    |
| Consumer withdrawal processor | `python -m src.worker consumer-withdraw-processor --once` | every 1 minute           | 0     | `consumer-withdraw-processor` |
| Gmail outbox drain            | `python -m src.worker notification-outbox --once`         | every 1 minute           | 1     | `notification-outbox-drain`   |
| In-app notification cleanup   | `python -m src.worker in-app-cleanup --once`              | daily                    | 0     | `in-app-notification-cleanup` |

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
WITHDRAW_SIGNER_MODE="gcp_kms"
WITHDRAW_SIGNER_GCP_KMS_KEY_NAME="<staging kms key version resource>"
WITHDRAW_SIGNER_ADDRESS="<kms-derived Ethereum address>"
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
4. Run Gateway DB migration job.
5. Run Gateway-admin DB migration job.
6. Sync Gateway scheduled jobs to the same Gateway image digest.
7. Deploy Cloud Run services with low max-instance limits.
8. Configure Lark alert routes and run Lark E2E evidence.
9. Configure Gmail sender and run email notification evidence.
10. Configure Cloud Monitoring alert policies and drill alerts.
11. Run Arbitrum Sepolia contract deployment evidence.
12. Run Gateway full-chain release E2E in staging.
13. Run one-ticket withdrawal 10-scenario evidence.
14. Run local and staging load/reconciliation evidence.
15. Run backup/restore drill.
16. Attach all evidence to production validation.
17. Only then prepare production infrastructure and small-value rehearsal.

## Hard Rules

1. Do not use local CI as production evidence.
2. Do not put secrets in Terraform variables, git, screenshots, or evidence.
3. Do not expose Postgres or `/metrics` publicly.
4. Do not run destructive restore against production.
5. Do not represent internal audit as third-party audit.
6. Do not launch production while validation remains `NO-GO`.
7. Do not reintroduce Redis, Kafka, or ClickHouse as MVP launch blockers without
   a new cost/risk review.
