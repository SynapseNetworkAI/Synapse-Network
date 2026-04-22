locals {
  name_prefix   = "synapse-${var.environment}"
  is_production = contains(["prod", "production"], lower(var.environment))
  labels = merge(
    {
      app         = "synapse-network"
      environment = var.environment
      managed_by  = "terraform"
      runtime     = "cloud-run"
    },
    var.labels,
  )
  runtime_env = merge(
    {
      ENVIRONMENT                         = var.environment
      STORAGE_BACKEND                     = "postgres"
      POSTGRES_HOST                       = "/cloudsql/${google_sql_database_instance.postgres.connection_name}"
      POSTGRES_DB                         = var.cloud_sql_database_name
      POSTGRES_CONNECT_TIMEOUT_SEC        = "5"
      POSTGRES_POOL_MAX                   = "5"
      ANALYTICS_TRANSPORT                 = "outbox"
      ANALYTICS_STRICT_KAFKA              = "false"
      DOWNSTREAM_ADAPTIVE_REDIS_ENABLED   = "false"
      EMAIL_OUTBOX_ENABLED                = "true"
      IN_APP_NOTIFICATION_CLEANUP_ENABLED = "false"
    },
    var.common_runtime_env,
  )
  cloud_run_services = {
    gateway = {
      name          = "${local.name_prefix}-gateway"
      image         = var.gateway_image
      port          = 8000
      concurrency   = local.is_production ? 40 : 20
      min_instances = local.is_production ? 1 : 0
      max_instances = local.is_production ? 3 : 2
      env           = local.runtime_env
    }
    gateway_admin = {
      name          = "${local.name_prefix}-gateway-admin"
      image         = var.gateway_admin_image
      port          = 8000
      concurrency   = 10
      min_instances = 0
      max_instances = 1
      env = merge(
        local.runtime_env,
        {
          POSTGRES_POOL_MAX = "3"
        },
      )
    }
    user_front = {
      name          = "${local.name_prefix}-user-front"
      image         = var.user_front_image
      port          = 3000
      concurrency   = 40
      min_instances = 0
      max_instances = 2
      env           = var.frontend_runtime_env
    }
    admin_front = {
      name          = "${local.name_prefix}-admin-front"
      image         = var.admin_front_image
      port          = 3000
      concurrency   = 20
      min_instances = 0
      max_instances = 1
      env           = var.frontend_runtime_env
    }
  }
  enabled_cloud_run_services = {
    for key, service in local.cloud_run_services : key => service
    if trimspace(service.image) != ""
  }
}

resource "google_artifact_registry_repository" "docker" {
  location      = var.region
  repository_id = var.artifact_registry_repository
  description   = "Synapse ${var.environment} Docker images"
  format        = "DOCKER"
  labels        = local.labels
}

resource "google_storage_bucket" "backups" {
  name                        = var.backup_bucket_name
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false
  labels                      = local.labels

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = var.backup_bucket_retention_days
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_secret_manager_secret" "placeholders" {
  for_each  = var.secret_ids
  secret_id = each.value
  labels    = local.labels

  replication {
    auto {}
  }
}

resource "google_service_account" "runtime" {
  account_id   = "${local.name_prefix}-runtime"
  display_name = "Synapse ${var.environment} Cloud Run runtime"
}

resource "google_project_iam_member" "runtime_logging_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "runtime_monitoring_writer" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "runtime_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "runtime_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_sql_database_instance" "postgres" {
  name                = "${local.name_prefix}-postgres"
  region              = var.region
  database_version    = var.cloud_sql_database_version
  deletion_protection = var.cloud_sql_deletion_protection

  settings {
    tier              = var.cloud_sql_tier
    availability_type = var.cloud_sql_availability_type
    disk_type         = var.cloud_sql_disk_type
    disk_size         = var.cloud_sql_disk_size_gb
    disk_autoresize   = var.cloud_sql_disk_autoresize
    user_labels       = local.labels

    backup_configuration {
      enabled                        = true
      start_time                     = var.cloud_sql_backup_start_time
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = var.cloud_sql_transaction_log_retention_days

      backup_retention_settings {
        retained_backups = var.cloud_sql_retained_backups
        retention_unit   = "COUNT"
      }
    }

    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = true
      record_client_address   = false
    }
  }
}

resource "google_sql_database" "gateway" {
  name     = var.cloud_sql_database_name
  instance = google_sql_database_instance.postgres.name
}

resource "google_cloud_run_v2_service" "services" {
  for_each = local.enabled_cloud_run_services

  name     = each.value.name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  labels   = local.labels

  template {
    service_account                  = google_service_account.runtime.email
    max_instance_request_concurrency = each.value.concurrency

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.postgres.connection_name]
      }
    }

    scaling {
      min_instance_count = each.value.min_instances
      max_instance_count = each.value.max_instances
    }

    containers {
      image = each.value.image

      ports {
        container_port = each.value.port
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      dynamic "env" {
        for_each = each.value.env
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  depends_on = [
    google_project_iam_member.runtime_cloudsql_client,
    google_project_iam_member.runtime_logging_writer,
    google_project_iam_member.runtime_monitoring_writer,
    google_project_iam_member.runtime_secret_accessor,
    google_sql_database.gateway,
  ]
}
