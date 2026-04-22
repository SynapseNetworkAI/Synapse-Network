output "runtime_service_account_email" {
  description = "Service account used by Cloud Run runtime services."
  value       = google_service_account.runtime.email
}

output "cloud_sql_instance_name" {
  description = "Cloud SQL Postgres instance name."
  value       = google_sql_database_instance.postgres.name
}

output "cloud_sql_connection_name" {
  description = "Cloud SQL connection name used by Cloud Run connectors."
  value       = google_sql_database_instance.postgres.connection_name
}

output "cloud_sql_database_name" {
  description = "Gateway database name."
  value       = google_sql_database.gateway.name
}

output "backup_bucket_name" {
  description = "GCS bucket for backup/restore drill artifacts."
  value       = google_storage_bucket.backups.name
}

output "artifact_registry_repository" {
  description = "Artifact Registry Docker repository."
  value       = google_artifact_registry_repository.docker.name
}

output "cloud_run_service_urls" {
  description = "URLs for Cloud Run services created by Terraform. Empty when image variables are not set."
  value = {
    for key, service in google_cloud_run_v2_service.services : key => service.uri
  }
}
