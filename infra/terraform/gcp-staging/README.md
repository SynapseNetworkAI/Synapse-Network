# GCP Staging Terraform

This module provisions the MVP staging substrate for the low-cost Cloud Run and
Cloud SQL architecture described in
`docs/ops/15_Google_Cloud_Launch_Readiness.md`.

The canonical staging environment matrix for DNS, Cloud Run env, Secret
Manager ids, frontend URLs, Gateway/Gateway-admin settings, Gmail, Lark, and
Arbitrum Sepolia deployment variables lives in
`docs/ops/17_Staging_Environment_Configuration.md`.

It intentionally does not provision the old single-VM Docker Compose stack.
That path remains an emergency fallback only.

## Creates

- Artifact Registry repository for Docker images
- Cloud SQL Postgres instance and Gateway database
- Cloud SQL backups with PITR enabled
- GCS backup/evidence bucket
- Secret Manager secret placeholders
- Cloud Run runtime service account
- IAM grants for logging, monitoring, Secret Manager access, and Cloud SQL
- Optional Cloud Run services when image variables are provided

## Does Not Create

- Redis
- Kafka
- ClickHouse
- GKE
- single GCE VM
- real secret values
- production resources

## Cloud Shell Usage

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

bash scripts/deploy/gcp_preflight.sh YOUR_PROJECT_ID

cd infra/terraform/gcp-staging
cp terraform.tfvars.example terraform.tfvars
# edit project_id, backup_bucket_name, and optional image/env values
terraform init
terraform plan
terraform apply
```

If `terraform apply` reports that the backup bucket already exists and you own
it, that is expected when `scripts/deploy/gcp_create_staging_buckets.sh` was run
before Terraform. Import the already-created bucket into Terraform state instead
of deleting or recreating it:

```bash
terraform import \
  google_storage_bucket.backups \
  synapse-staging-backups-fabled-archive-494108-k5
```

Then rerun:

```bash
terraform plan
terraform apply
```

Staging Cloud SQL intentionally uses `cloud_sql_edition = "ENTERPRISE"` with
`cloud_sql_tier = "db-f1-micro"`. Do not use `ENTERPRISE_PLUS` for this MVP
staging tier; Enterprise Plus requires the newer performance-optimized machine
families and will reject `db-f1-micro`.

After apply, add secret **values** outside Terraform, for example:

```bash
printf '%s' 'real-secret-value' | \
  gcloud secrets versions add synapse-staging-jwt-secret --data-file=-
```

Do not commit `terraform.tfvars`, `.terraform/`, or real secret values.

Create database users/passwords outside Terraform as well, so passwords do not
land in Terraform state. Store the resulting password in Secret Manager and
inject it into Cloud Run at deploy time.

## Secret Manager And Withdrawal Signer KMS

Staging secrets live in Secret Manager with Google-managed default encryption at
rest. MVP staging still does not use Cloud KMS / CMEK for Secret Manager
envelope encryption.

Gateway withdrawal ticket signing is a separate custody boundary. This module
creates a dedicated asymmetric Cloud KMS signer:

- key ring: `synapse-staging`
- crypto key: `synapse-staging-withdraw-signer`
- algorithm: `EC_SIGN_SECP256K1_SHA256`
- purpose: `ASYMMETRIC_SIGN`
- protection level: `SOFTWARE` for staging rehearsal

Only the Gateway runtime service account receives
`roles/cloudkms.signerVerifier` on that crypto key. The application never
receives the raw withdrawal signer private key.

Recommended flow:

1. Let Terraform create Secret Manager placeholders.
2. Run `scripts/deploy/gcp_staging_bootstrap.sh` to generate the Cloud SQL app
   password, create/update the database user, and write the password to Secret
   Manager.
3. Use `scripts/deploy/gcp_put_secret.sh` to add user-provided secret values
   from stdin.
4. Verify every Cloud Run referenced secret has an enabled version:
   `bash scripts/deploy/gcp_check_staging_cloud_run_secret_versions.sh <project-id>`.
5. Grant Cloud Run service accounts access only to the secrets they need. Gateway
   currently uses the shared runtime account; Provider runtime and Provider
   onboarding use separate service accounts with per-secret IAM bindings.
6. Keep plain config in repo-root private `env.staging` / `env.prod` and map it
   into Terraform `common_runtime_env` / `frontend_runtime_env`. Never use these
   env files for DSNs, passwords, API keys, signing secrets, or private keys.
7. Inject secrets into Cloud Run with Terraform `secret_env` or, for an
   emergency manual repair, `gcloud run ... --update-secrets`.
8. Derive the KMS Ethereum signer address with
   `node scripts/chain/gcp_kms_derive_eth_address.mjs <cryptoKeyVersion>` and
   set Terraform variable `withdraw_signer_address` only after
   `SynapseCore.platformSigner()` has been rotated to that address.

Cloud Run resolves `secret:latest` while creating revisions/jobs. A Secret
Manager placeholder without an enabled version is not deployable and will fail
`terraform apply` after other resources may already have changed.

Gateway-backed services and jobs inject `GMAIL_SMTP_USERNAME` from plain
`env.staging` / `common_runtime_env`, while `GMAIL_SMTP_APP_PASSWORD` stays in
Secret Manager. Secret Manager having a password value is not enough: the Cloud
Run service/job must also list both SMTP environment variables.
Use `docs/ops/17_Staging_Environment_Configuration.md` for the full write,
runtime-injection, and verification commands.

Terraform also creates E2E-only Secret Manager placeholders:

- `synapse-staging-e2e-consumer-private-key`
- `synapse-staging-e2e-provider-private-key`
- `synapse-staging-admin-e2e-password`
- `synapse-staging-admin-e2e-otp-secret`

These values are consumed only by explicit staging dogfood/full-chain E2E
runners. They must not be injected into Gateway, Gateway-admin, frontend, or
background Cloud Run runtime services.

Provider secrets are split by physical role:

- `synapse-staging-provider-signature-secret` and runtime upstream/API secrets
  are available only to `synapse-staging-provider-runtime`.
- `synapse-staging-provider-onboarding-owner-private-key` is available only to
  the manual `synapse-staging-provider-onboarding` Cloud Run Job.
- The public Provider runtime must never receive Owner private keys, wallet
  seeds, admin JWTs, or onboarding credentials.

The application should not receive broad KMS IAM roles. The only exception in
staging is sign/verify access for the Gateway runtime service account on the
dedicated withdrawal signer key above. Cloud Run reads all other secret values
through Secret Manager; Secret Manager handles default encryption at rest.

Cloud Run jobs in this staging module set `deletion_protection = false`.
Jobs are replaceable orchestration shells; keeping deletion protection on can
trap a failed job after a bad secret reference. Core stateful resources such as
Cloud SQL continue to keep their own deletion protection rules.

Full staging checklist and commands live in
`docs/ops/15_Google_Cloud_Launch_Readiness.md` and
`docs/ops/17_Staging_Environment_Configuration.md`.

The service list, billing model, and monthly staging cost estimate are tracked
in `docs/ops/15_Google_Cloud_Launch_Readiness.md` under "Staging Enabled
Services and Cost Estimate". Keep that section updated whenever this module
adds a new managed resource or scheduled job.

## First Deployment Strategy

If container image names are not ready, keep `gateway_image`,
`gateway_admin_image`, `user_front_image`, `admin_front_image`, and
`provider_image` empty.
These variables are Docker/OCI image URLs for Cloud Run, not website PNG/JPG
assets. Terraform will create the durable substrate first. Then deploy the first
containers manually:

```bash
gcloud run deploy synapse-staging-gateway \
  --region us-central1 \
  --image us-central1-docker.pkg.dev/PROJECT/synapse-staging/gateway:TAG \
  --concurrency 20 \
  --max-instances 2 \
  --min-instances 0
```

Once staging is stable, set the image variables and let Terraform own the Cloud
Run services.

The staging buckets were created in project `fabled-archive-494108-k5` on
2026-04-23:

- `synapse-staging-static-assets-fabled-archive-494108-k5`
- `synapse-staging-backups-fabled-archive-494108-k5`
- `synapse-staging-evidence-fabled-archive-494108-k5`
- `synapse-terraform-state-fabled-archive-494108-k5`

Use `synapse-terraform-state-fabled-archive-494108-k5` for Terraform remote
state and `synapse-staging-backups-fabled-archive-494108-k5` as
`backup_bucket_name`.

The backend is configured in `versions.tf`. After pulling this change or after
creating the bucket for the first time, run:

```bash
terraform init -reconfigure
```

The static-assets bucket is optional for future CDN-hosted website assets. It is
not required for Cloud Run front-end deploys because files under each Next.js
`public/` directory are shipped inside the front-end container image.

```bash
scripts/deploy/gcp_create_staging_buckets.sh <gcp-project-id>
```

## Cloud Run Scaling Guard

The Gateway service uses environment-aware scaling defaults:

- `environment=staging`: `concurrency=20`, `max_instances=2`, `min_instances=0`.
- `environment=prod` or `production`: `concurrency=40`, `max_instances=3`,
  `min_instances=1`.

The production `min_instances=1` guard applies only to the Gateway payment
entrypoint. Gateway-admin and front-end services stay at `min_instances=0`
unless production evidence shows they need a warm instance.

## DB Migration Job

This module creates a manual Cloud Run Job named
`synapse-staging-db-migrate` when `gateway_image` is set. It is intentionally
not attached to Cloud Scheduler. Run it as a release step before updating API
services:

```bash
gcloud run jobs execute synapse-staging-db-migrate \
  --region us-central1 \
  --wait
```

The job runs:

```bash
bash scripts/deploy/migrate_db.sh staging
```

The Gateway image must include `services/gateway/scripts/deploy/migrate_db.sh`,
`services/gateway/migrations/postgres/001_synapse_schema.sql`, and
`postgresql-client`. The service-local runner uses the canonical repo SQL when
available and falls back to the packaged SQL inside the container image.

Runtime services should use `POSTGRES_AUTO_INIT=0`. Schema changes are applied
only by the migration job or by `bash scripts/deploy/migrate_db.sh <env>` from a
controlled release shell.

Seed data is never part of Terraform or Gateway runtime migrations. Local/dogfood
seed scripts should use `scripts/e2e/seed_env_guard.mjs`. Production seed
execution is forbidden.

## Automated Branch Deploys

The staging GitHub workflow deploys a selected branch/tag/commit by freezing it
to a resolved commit SHA, then building only affected services. Terraform remains
the substrate owner; routine image rollouts use Cloud Build plus `gcloud run
deploy` so one user-front change does not rebuild and redeploy all four services.

Supported deploy scopes:

```text
auto | gateway | gateway-admin | user-front | admin-front | all
```

`auto` is resolved by `scripts/deploy/resolve_deploy_scope.mjs`. It records
docs-only changes as `no_deploy`, runs the migration job before API rollout when
schema files changed, and writes deployment evidence to:

```text
gs://synapse-staging-evidence-fabled-archive-494108-k5/deployments/
```
