variable "project_id" {
  description = "Google Cloud project id used for Synapse production."
  type        = string
}

variable "region" {
  description = "Google Cloud region for the production Cloud Run + Cloud SQL stack."
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment label."
  type        = string
  default     = "prod"
}

variable "backup_bucket_name" {
  description = "Globally unique GCS bucket name for production backup and restore artifacts."
  type        = string
}

variable "backup_bucket_retention_days" {
  description = "Retention for production backup drill artifacts in the GCS bucket."
  type        = number
  default     = 30
}

variable "artifact_registry_repository" {
  description = "Docker Artifact Registry repository name for image pushes."
  type        = string
  default     = "synapse-prod"
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
  default     = "synapse_gateway_prod"
}

variable "admin_cloud_sql_database_name" {
  description = "Gateway-admin Postgres database name."
  type        = string
  default     = "synapse_gateway_admin_prod"
}

variable "cloud_sql_tier" {
  description = "Initial production Cloud SQL tier."
  type        = string
  default     = "db-g1-small"
}

variable "cloud_sql_edition" {
  description = "Cloud SQL edition."
  type        = string
  default     = "ENTERPRISE"
}

variable "cloud_sql_availability_type" {
  description = "Cloud SQL availability type for production."
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
  description = "Deletion protection for the production Cloud SQL instance."
  type        = bool
  default     = true
}

variable "cloud_sql_backup_start_time" {
  description = "Cloud SQL backup start time in UTC. 19:00 UTC equals 03:00 Asia/Kuala_Lumpur."
  type        = string
  default     = "19:00"
}

variable "cloud_sql_transaction_log_retention_days" {
  description = "Cloud SQL PITR transaction log retention days."
  type        = number
  default     = 7
}

variable "cloud_sql_retained_backups" {
  description = "Number of automated backups retained."
  type        = number
  default     = 7
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
  description = "Ethereum address derived from the production Cloud KMS withdrawal signer public key. Must match SynapseCore.platformSigner before Gateway KMS signing is enabled."
  type        = string
  default     = ""
}

variable "withdraw_signer_kms_key_version" {
  description = "Cloud KMS cryptoKeyVersion number used by Gateway withdrawal ticket signing."
  type        = string
  default     = "1"
}

variable "legacy_withdraw_private_key_secret_enabled" {
  description = "Set false for production. Raw withdraw signer private keys are local-only after KMS rollout."
  type        = bool
  default     = false
}

variable "admin_invoker_group_email" {
  description = "Optional Google Group email for legacy private admin-front mode. Leave empty when admin-front is public and protected at the application layer."
  type        = string
  default     = ""
}

variable "gateway_admin_breakglass_group_email" {
  description = "Optional Google Group email for legacy private gateway-admin break-glass invocation. Leave empty when gateway-admin is public and protected at the application layer."
  type        = string
  default     = ""
}

variable "vpc_network_name" {
  description = "Dedicated VPC network name for production private Cloud SQL and Cloud Run egress."
  type        = string
  default     = "synapse-prod-vpc"
}

variable "vpc_subnet_name" {
  description = "Subnetwork name used by Cloud Run VPC egress and private Cloud SQL."
  type        = string
  default     = "synapse-prod-subnet"
}

variable "vpc_subnet_cidr" {
  description = "CIDR range for the production VPC subnet."
  type        = string
  default     = "10.30.0.0/24"
}

variable "vpc_connector_name" {
  description = "Serverless VPC Access connector name for Cloud Run services and jobs."
  type        = string
  default     = "syn-prod-vpcconn"
}

variable "vpc_connector_cidr" {
  description = "CIDR range reserved for the Serverless VPC Access connector."
  type        = string
  default     = "10.30.8.0/28"
}

variable "private_service_range_name" {
  description = "Name for the reserved service networking range used by private Cloud SQL."
  type        = string
  default     = "synapse-prod-sql-private-range"
}

variable "private_service_range_prefix_length" {
  description = "Prefix length for the service networking reserved range."
  type        = number
  default     = 16
}

variable "secret_ids" {
  description = "Secret Manager secret placeholders. Values must be added out-of-band, never via Terraform variables."
  type        = set(string)
  default = [
    "synapse-prod-postgres-password",
    "synapse-prod-postgres-dsn",
    "synapse-prod-postgres-migrator-password",
    "synapse-prod-admin-postgres-password",
    "synapse-prod-admin-database-dsn",
    "synapse-prod-admin-database-migration-dsn",
    "synapse-prod-admin-totp-secret-encryption-key",
    "synapse-prod-gateway-readonly-dsn",
    "synapse-prod-gateway-forum-write-dsn",
    "synapse-prod-jwt-secret",
    "synapse-prod-auth-secret",
    "synapse-prod-gateway-internal-jwt-secret",
    "synapse-prod-internal-trigger-secret",
    "synapse-prod-admin-csrf-secret",
    "synapse-prod-gateway-admin-wallet",
    "synapse-prod-gmail-app-password",
    "synapse-prod-gmail-username",
    "synapse-prod-lark-webhook-p0",
    "synapse-prod-lark-webhook-prod-alerts",
    "synapse-prod-lark-webhook-staging-drill",
    "synapse-prod-lark-secret-p0",
    "synapse-prod-lark-secret-prod-alerts",
    "synapse-prod-lark-secret-staging-drill",
    "synapse-prod-gcp-alert-receiver-token",
    "synapse-prod-alert-drill-token",
    "synapse-prod-arbitrum-one-rpc-url",
    "synapse-prod-arbiscan-api-key",
    "synapse-prod-deployer-private-key",
    "synapse-prod-metrics-basic-username",
    "synapse-prod-metrics-basic-password",
    "synapse-prod-metrics-bearer-token",
    "synapse-prod-provider-signature-secret",
    "synapse-prod-provider-postgres-dsn",
    "synapse-prod-provider-onboarding-owner-private-key",
    "synapse-prod-provider-etherscan-api-key",
    "synapse-prod-provider-twitter-x-api-key",
    "synapse-prod-provider-twitter-x-api-secret",
    "synapse-prod-provider-twitter-x-bearer-token",
    "synapse-prod-provider-deepseek-api-key",
    "synapse-prod-provider-minio-access-key",
    "synapse-prod-provider-minio-secret-key",
  ]
}

variable "labels" {
  description = "Additional labels applied to GCP resources."
  type        = map(string)
  default     = {}
}
