variable "project_id" {
  description = "Google Cloud project id used for Synapse staging."
  type        = string
}

variable "region" {
  description = "Google Cloud region for staging."
  type        = string
  default     = "asia-southeast1"
}

variable "zone" {
  description = "Google Cloud zone for the staging VM."
  type        = string
  default     = "asia-southeast1-a"
}

variable "environment" {
  description = "Environment label."
  type        = string
  default     = "staging"
}

variable "machine_type" {
  description = "GCE machine type for the single-VM staging stack."
  type        = string
  default     = "e2-standard-4"
}

variable "boot_disk_size_gb" {
  description = "Boot disk size for Docker volumes, logs, and staging data."
  type        = number
  default     = 200
}

variable "ssh_source_ranges" {
  description = "CIDR ranges allowed to SSH directly. Prefer IAP and keep this empty when possible."
  type        = list(string)
  default     = []
}

variable "enable_iap_ssh" {
  description = "Allow Google IAP TCP forwarding source range for SSH."
  type        = bool
  default     = true
}

variable "backup_bucket_name" {
  description = "Globally unique GCS bucket name for staging backup drill artifacts."
  type        = string
}

variable "artifact_registry_repository" {
  description = "Docker Artifact Registry repository name for future image pushes."
  type        = string
  default     = "synapse-staging"
}

variable "secret_ids" {
  description = "Secret Manager secret placeholders. Values must be added out-of-band, never via Terraform variables."
  type        = set(string)
  default = [
    "synapse-staging-postgres-password",
    "synapse-staging-jwt-secret",
    "synapse-staging-auth-secret",
    "synapse-staging-private-key",
    "synapse-staging-gateway-internal-jwt-secret",
    "synapse-staging-gmail-app-password",
    "synapse-staging-lark-webhook-p0",
    "synapse-staging-lark-webhook-prod-alerts",
    "synapse-staging-lark-webhook-staging-drill",
  ]
}

variable "labels" {
  description = "Additional labels applied to GCP resources."
  type        = map(string)
  default     = {}
}
