output "runtime_service_account_emails" {
  description = "Service accounts used by production Cloud Run services."
  value = {
    gateway       = google_service_account.gateway_runtime.email
    gateway_admin = google_service_account.gateway_admin_runtime.email
    frontend      = google_service_account.frontend_runtime.email
    admin_front   = google_service_account.admin_front_runtime.email
    scheduler     = google_service_account.scheduler.email
  }
}

output "cloud_sql_instance_name" {
  description = "Production Cloud SQL Postgres instance name."
  value       = google_sql_database_instance.postgres.name
}

output "cloud_sql_private_ip" {
  description = "Private IP address used by Cloud Run services/jobs for Postgres connectivity."
  value       = google_sql_database_instance.postgres.private_ip_address
}

output "cloud_sql_database_names" {
  description = "Gateway and Gateway-admin database names."
  value = {
    gateway       = google_sql_database.gateway.name
    gateway_admin = google_sql_database.gateway_admin.name
  }
}

output "backup_bucket_name" {
  description = "GCS bucket for production backup/restore drill artifacts."
  value       = google_storage_bucket.backups.name
}

output "artifact_registry_repository" {
  description = "Artifact Registry Docker repository."
  value       = google_artifact_registry_repository.docker.name
}

output "vpc_connector_name" {
  description = "Serverless VPC Access connector used by private Cloud SQL clients."
  value       = google_vpc_access_connector.cloud_run.name
}

output "cloud_run_service_urls" {
  description = "URLs for Cloud Run services created by Terraform. Empty when image variables are not set."
  value = {
    for key, service in google_cloud_run_v2_service.services : key => service.uri
  }
}
