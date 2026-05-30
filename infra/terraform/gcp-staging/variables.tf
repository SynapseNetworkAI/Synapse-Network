variable "project_id" {
  description = "Google Cloud project id used for Synapse staging."
  type        = string
}

variable "region" {
  description = "Google Cloud region for the low-cost Cloud Run + Cloud SQL staging stack."
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment label."
  type        = string
  default     = "staging"
}

variable "backup_bucket_name" {
  description = "Globally unique GCS bucket name for staging backup drill artifacts."
  type        = string
}

variable "backup_bucket_retention_days" {
  description = "Retention for staging backup drill artifacts in the GCS bucket."
  type        = number
  default     = 30
}

variable "artifact_registry_repository" {
  description = "Docker Artifact Registry repository name for image pushes."
  type        = string
  default     = "synapse-staging"
}

variable "artifact_registry_cleanup_policy_dry_run" {
  description = "When true, Artifact Registry cleanup policies only report candidates and do not delete image versions."
  type        = bool
  default     = false
}

variable "cloud_sql_database_version" {
  description = "Cloud SQL Postgres database version."
  type        = string
  default     = "POSTGRES_16"
}

variable "cloud_sql_database_name" {
  description = "Gateway Postgres database name."
  type        = string
  default     = "synapse_gateway_staging"
}

variable "cloud_sql_tier" {
  description = "Initial Cloud SQL tier. Upgrade from db-f1-micro to db-g1-small when evidence shows pressure."
  type        = string
  default     = "db-f1-micro"
}

variable "cloud_sql_edition" {
  description = "Cloud SQL edition. Staging must use ENTERPRISE for shared-core tiers such as db-f1-micro; ENTERPRISE_PLUS requires db-perf-optimized tiers."
  type        = string
  default     = "ENTERPRISE"
}

variable "cloud_sql_availability_type" {
  description = "Cloud SQL availability type. Staging starts ZONAL; production should evaluate REGIONAL separately."
  type        = string
  default     = "ZONAL"
}

variable "cloud_sql_disk_type" {
  description = "Cloud SQL disk type."
  type        = string
  default     = "PD_SSD"
}

variable "cloud_sql_disk_size_gb" {
  description = "Cloud SQL disk size in GB."
  type        = number
  default     = 20
}

variable "cloud_sql_disk_autoresize" {
  description = "Enable Cloud SQL disk autoresize."
  type        = bool
  default     = true
}

variable "cloud_sql_deletion_protection" {
  description = "Deletion protection for the staging Cloud SQL instance. Production must keep this true."
  type        = bool
  default     = false
}

variable "cloud_sql_backup_start_time" {
  description = "Cloud SQL backup start time in UTC. 19:00 UTC equals 03:00 Asia/Kuala_Lumpur."
  type        = string
  default     = "19:00"
}

variable "cloud_sql_transaction_log_retention_days" {
  description = "Cloud SQL PITR transaction log retention days. Staging defaults to 1; production should use 7."
  type        = number
  default     = 1
}

variable "cloud_sql_retained_backups" {
  description = "Number of automated backups retained."
  type        = number
  default     = 3
}

variable "gateway_image" {
  description = "Optional Gateway container image. Leave empty to provision substrate first and deploy with gcloud run deploy."
  type        = string
  default     = ""
}

variable "gateway_admin_image" {
  description = "Optional Gateway-admin container image. Leave empty to provision substrate first."
  type        = string
  default     = ""
}

variable "user_front_image" {
  description = "Optional User-front container image. Leave empty to provision substrate first."
  type        = string
  default     = ""
}

variable "admin_front_image" {
  description = "Optional Admin-front container image. Leave empty to provision substrate first."
  type        = string
  default     = ""
}

variable "docs_front_image" {
  description = "Optional Docs-front container image. Leave empty to provision substrate first."
  type        = string
  default     = ""
}

variable "provider_image" {
  description = "Optional Provider runtime container image. Leave empty to skip Provider Cloud Run resources."
  type        = string
  default     = ""
}

variable "common_runtime_env" {
  description = "Non-secret environment variables merged into Gateway and Gateway-admin Cloud Run services."
  type        = map(string)
  default     = {}
}

variable "frontend_runtime_env" {
  description = "Non-secret environment variables used by front-end Cloud Run services."
  type        = map(string)
  default     = {}
}

variable "scheduler_time_zone" {
  description = "Cloud Scheduler timezone for background jobs. Keep UTC for deterministic release evidence."
  type        = string
  default     = "Etc/UTC"
}

variable "withdraw_signer_address" {
  description = "Ethereum address derived from the staging Cloud KMS withdrawal signer public key. Must match SynapseCore.platformSigner before Gateway KMS signing is enabled."
  type        = string
  default     = ""
}

variable "withdraw_signer_kms_key_version" {
  description = "Cloud KMS cryptoKeyVersion number used by Gateway withdrawal ticket signing."
  type        = string
  default     = "1"
}

variable "legacy_withdraw_private_key_secret_enabled" {
  description = "Keep the old synapse-staging-private-key placeholder managed while staging KMS signer migration evidence is pending. Set false only after KMS withdrawal E2E passes."
  type        = bool
  default     = true
}

variable "secret_ids" {
  description = "Secret Manager secret placeholders. Values must be added out-of-band, never via Terraform variables."
  type        = set(string)
  default = [
    "synapse-staging-postgres-password",
    "synapse-staging-postgres-dsn",
    "synapse-staging-postgres-migrator-password",
    "synapse-staging-admin-postgres-password",
    "synapse-staging-admin-database-dsn",
    "synapse-staging-admin-database-migration-dsn",
    "synapse-staging-admin-totp-secret-encryption-key",
    "synapse-staging-gateway-readonly-dsn",
    "synapse-staging-gateway-forum-write-dsn",
    "synapse-staging-jwt-secret",
    "synapse-staging-auth-secret",
    "synapse-staging-gateway-internal-jwt-secret",
    "synapse-staging-internal-trigger-secret",
    "synapse-staging-admin-csrf-secret",
    "synapse-staging-gmail-app-password",
    "synapse-staging-lark-webhook-p0",
    "synapse-staging-lark-webhook-prod-alerts",
    "synapse-staging-lark-webhook-staging-drill",
    "synapse-staging-lark-secret-p0",
    "synapse-staging-lark-secret-prod-alerts",
    "synapse-staging-lark-secret-staging-drill",
    "synapse-staging-gcp-alert-receiver-token",
    "synapse-staging-alert-drill-token",
    "synapse-staging-arbitrum-sepolia-rpc-url",
    "synapse-staging-arbiscan-api-key",
    "synapse-staging-deployer-private-key",
    "synapse-staging-gas-funder-private-key",
    "synapse-staging-e2e-consumer-private-key",
    "synapse-staging-e2e-provider-private-key",
    "synapse-staging-admin-e2e-password",
    "synapse-staging-admin-e2e-otp-secret",
    "synapse-staging-metrics-bearer-token",
    "synapse-staging-provider-signature-secret",
    "synapse-staging-provider-postgres-dsn",
    "synapse-staging-provider-onboarding-owner-private-key",
    "synapse-staging-provider-etherscan-api-key",
    "synapse-staging-provider-twitter-x-api-key",
    "synapse-staging-provider-twitter-x-api-secret",
    "synapse-staging-provider-twitter-x-bearer-token",
    "synapse-staging-provider-deepseek-api-key",
    "synapse-staging-provider-minio-access-key",
    "synapse-staging-provider-minio-secret-key",
  ]
}

variable "labels" {
  description = "Additional labels applied to GCP resources."
  type        = map(string)
  default     = {}
}
