# GCP Staging Terraform

This Terraform module provisions the minimum Google Cloud substrate for the
single-VM staging rollout described in `docs/ops/09_Staging_First_GCE_Rollout.md`
and `docs/ops/15_Google_Cloud_Launch_Readiness.md`.

It intentionally creates infrastructure only. It does **not** store secret
values, deploy application containers, or run production evidence tests.

## Creates

- VPC and subnet
- reserved external static IP
- firewall rules for HTTP/HTTPS and restricted SSH/IAP
- staging service account
- GCE VM with Docker and Ops Agent bootstrap
- GCS backup bucket
- Secret Manager secret placeholders

## Cloud Shell Usage

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

bash scripts/deploy/gcp_preflight.sh YOUR_PROJECT_ID

cd infra/terraform/gcp-staging
cp terraform.tfvars.example terraform.tfvars
# edit project_id, ssh_source_ranges, backup_bucket_name, and labels
terraform init
terraform plan
terraform apply
```

After apply, set secret **values** outside Terraform, for example:

```bash
printf '%s' 'real-secret-value' | \
  gcloud secrets versions add synapse-staging-jwt-secret --data-file=-
```

Do not commit `terraform.tfvars`, `.terraform/`, or real secret values.
