output "staging_static_ip" {
  description = "External IP address to point staging DNS at."
  value       = google_compute_address.staging.address
}

output "staging_vm_name" {
  description = "GCE VM name."
  value       = google_compute_instance.staging.name
}

output "staging_service_account_email" {
  description = "Service account attached to the staging VM."
  value       = google_service_account.staging_vm.email
}

output "backup_bucket_name" {
  description = "GCS bucket for backup/restore drill artifacts."
  value       = google_storage_bucket.backups.name
}

output "artifact_registry_repository" {
  description = "Artifact Registry Docker repository."
  value       = google_artifact_registry_repository.docker.name
}
