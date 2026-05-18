# GCP Production Terraform

This module provisions the production Google Cloud substrate for Synapse:

- Cloud Run services and jobs
- private-only Cloud SQL Postgres
- Secret Manager placeholders
- Artifact Registry
- Cloud Storage backup bucket
- Cloud KMS withdrawal signer
- dedicated VPC + Serverless VPC Access Connector
- IAM baseline for Gateway, Gateway-admin, Admin-front, and Scheduler

The production shape is intentionally isolated from staging:

1. separate GCP project
2. separate Cloud SQL instance and databases
3. separate Secret Manager namespace
4. separate Artifact Registry repository
5. separate service accounts
6. separate Scheduler jobs
7. separate domains
8. separate contract addresses, Safe, and signer authority

## Admin Access Model

Production admin does **not** use IAP/LB in this MVP substrate.

- `synapse-prod-admin-front` is a public login entrypoint
- `synapse-prod-gateway-admin` is a public API entrypoint
- browser and API security stays in the application layer: session cookie,
  CSRF, TOTP step-up, RBAC, lockout, and audit
- `admin-front` keeps same-origin `/api/admin/*` rewrites pointed at
  `https://admin-api.synapse-network.ai`
- protected business routes must fail with application `401/403`, not Google
  Frontend `403`

## Private Cloud SQL

Production Cloud SQL is **private-only**:

- `ipv4_enabled = false`
- no authorized public networks
- private service networking enabled
- Cloud Run services/jobs use the shared Serverless VPC Access Connector

This includes `gateway`, `gateway-admin`, and the DB migration jobs. Do not
assume Cloud Run Jobs can reach private Postgres without explicit VPC egress.

## Usage

```bash
bash scripts/deploy/gcp_preflight.sh --env prod --project YOUR_PROJECT_ID

cd infra/terraform/gcp-prod
cp terraform.tfvars.example terraform.tfvars
# edit project_id, backup_bucket_name, public runtime env values, and image values
terraform init
terraform plan
terraform apply
```

After apply:

1. add real Secret Manager values out of band
2. confirm KMS-derived signer address
3. deploy Cloud Run images
4. run explicit migration jobs
5. attach production release manifest and small-value rehearsal evidence

Do not commit `terraform.tfvars`, `.terraform/`, or real secret values.
