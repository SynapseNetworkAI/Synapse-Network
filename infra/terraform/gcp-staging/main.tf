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
      ENVIRONMENT                             = var.environment
      STORAGE_BACKEND                         = "postgres"
      POSTGRES_HOST                           = "/cloudsql/${google_sql_database_instance.postgres.connection_name}"
      POSTGRES_DB                             = var.cloud_sql_database_name
      POSTGRES_USER                           = "synapse_gateway_app"
      POSTGRES_MIGRATOR_USER                  = "synapse_gateway_migrator"
      POSTGRES_CONNECT_TIMEOUT_SEC            = "5"
      POSTGRES_POOL_MAX                       = "5"
      POSTGRES_AUTO_INIT                      = "0"
      CORS_ALLOW_ORIGINS                      = "https://staging.synapse-network.ai"
      ROUTER_ADDRESS                          = "0x0bA1dcE1Cc8d877052ab1C3CE2362830459D8FF4"
      USDC_TOKEN_ADDRESS                      = "0xfad31daE42B0046aFA106BCf56ED0dDaCA4463B9"
      V2_INDEXER_ENABLED                      = "false"
      PROVIDER_WITHDRAW_EXPIRY_REAPER_ENABLED = "false"
      CONSUMER_WITHDRAW_PROCESSOR_ENABLED     = "false"
      ANALYTICS_TRANSPORT                     = "outbox"
      ANALYTICS_STRICT_KAFKA                  = "false"
      ANALYTICS_KAFKA_BOOTSTRAP_SERVERS       = ""
      DOWNSTREAM_ADAPTIVE_REDIS_ENABLED       = "false"
      REDIS_URL                               = ""
      EMAIL_OUTBOX_ENABLED                    = "true"
      EMAIL_TRANSPORT                         = "gmail_smtp"
      GMAIL_SMTP_HOST                         = "smtp.gmail.com"
      GMAIL_SMTP_PORT                         = "587"
      EMAIL_FROM                              = "Synapse Network Staging <staging-alerts@synapse-network.ai>"
      EMAIL_REPLY_TO                          = "support@synapse-network.ai"
      IN_APP_NOTIFICATION_CLEANUP_ENABLED     = "false"
      WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC       = "1.000000"
      WITHDRAWAL_TIMEOUT_ALERT_AFTER_SEC      = "900"
      STAGING_ALERT_DRILL_ENABLED             = local.is_production ? "false" : "true"
    },
    var.common_runtime_env,
  )
  gateway_secret_env = {
    POSTGRES_DSN                = "synapse-staging-postgres-dsn"
    POSTGRES_PASSWORD           = "synapse-staging-postgres-password"
    JWT_SECRET                  = "synapse-staging-jwt-secret"
    AUTH_SECRET                 = "synapse-staging-auth-secret"
    PRIVATE_KEY                 = "synapse-staging-private-key"
    METRICS_BEARER_TOKEN        = "synapse-staging-metrics-bearer-token"
    GATEWAY_INTERNAL_JWT_SECRET = "synapse-staging-gateway-internal-jwt-secret"
    RPC_URL                     = "synapse-staging-arbitrum-sepolia-rpc-url"
    GMAIL_SMTP_USERNAME         = "synapse-staging-gmail-username"
    GMAIL_SMTP_APP_PASSWORD     = "synapse-staging-gmail-app-password"
    STAGING_ALERT_DRILL_TOKEN   = "synapse-staging-alert-drill-token"
    PLATFORM_FEE_ADMIN_WALLETS  = "synapse-staging-gateway-admin-wallet"
    INDEXER_ADMIN_WALLETS       = "synapse-staging-gateway-admin-wallet"
  }
  gateway_migration_secret_env = merge(
    local.gateway_secret_env,
    {
      POSTGRES_MIGRATOR_PASSWORD = "synapse-staging-postgres-migrator-password"
    },
  )
  gateway_admin_secret_env = {
    METRICS_BEARER_TOKEN          = "synapse-staging-metrics-bearer-token"
    ADMIN_CSRF_SECRET             = "synapse-staging-admin-csrf-secret"
    ADMIN_DATABASE_DSN            = "synapse-staging-admin-database-dsn"
    ADMIN_DATABASE_MIGRATION_DSN  = "synapse-staging-admin-database-migration-dsn"
    GATEWAY_READONLY_DSN          = "synapse-staging-gateway-readonly-dsn"
    GATEWAY_FORUM_WRITE_DSN       = "synapse-staging-gateway-forum-write-dsn"
    GATEWAY_INTERNAL_ADMIN_WALLET = "synapse-staging-gateway-admin-wallet"
    GATEWAY_INTERNAL_JWT_SECRET   = "synapse-staging-gateway-internal-jwt-secret"
    GCP_ALERT_RECEIVER_TOKEN      = "synapse-staging-gcp-alert-receiver-token"
    LARK_WEBHOOK_STAGING_DRILL    = "synapse-staging-lark-webhook-staging-drill"
    LARK_SECRET_STAGING_DRILL     = "synapse-staging-lark-secret-staging-drill"
    LARK_WEBHOOK_P0_WAR_ROOM      = "synapse-staging-lark-webhook-p0"
    LARK_SECRET_P0_WAR_ROOM       = "synapse-staging-lark-secret-p0"
    LARK_WEBHOOK_PROD_ALERTS      = "synapse-staging-lark-webhook-prod-alerts"
    LARK_SECRET_PROD_ALERTS       = "synapse-staging-lark-secret-prod-alerts"
  }
  provider_runtime_env = {
    PROVIDER_ENV                           = var.environment
    PROVIDER_RUNTIME_ROLE                  = "runtime"
    PROVIDER_PUBLIC_BASE_URL               = "https://provider-staging.synapse-network.ai"
    PROVIDER_GATEWAY_REGISTRATION_EXPECTED = "true"
    PROVIDER_PUBLIC_DOCS_ENABLED           = "false"
    PROVIDER_STAGING_ENABLED_SERVICES_JSON = "[\"web3-sentiment-index\",\"protocol-fundamental-brief\",\"oss-security-healthcheck\"]"
    PROVIDER_MAX_BODY_BYTES                = "131072"
    PROVIDER_MAX_RESPONSE_BYTES            = "1048576"
    PROVIDER_GLOBAL_QPS                    = "5"
    PROVIDER_SERVICE_QPS_JSON              = "{\"web3-sentiment-index\":2,\"protocol-fundamental-brief\":1,\"oss-security-healthcheck\":1}"
    GATEWAY_PROVIDER_SIGNATURE_ENABLED     = "true"
    GATEWAY_PROVIDER_SIGNATURE_MAX_SKEW_S  = "300"
    SENTIMENT_REPOSITORY_BACKEND           = "postgres"
    SENTIMENT_SCHEDULER_ENABLED            = "false"
    SENTIMENT_PROXY_POOL_ENABLED           = "false"
    SENTIMENT_PROXY_POOL_URLS_JSON         = "[]"
    SENTIMENT_PROXY_TIMEOUT_FLOOR_S        = "8"
    VIDEO_STORAGE_BACKEND                  = "minio"
    VIDEO_STORAGE_MINIO_ENDPOINT           = ""
    VIDEO_STORAGE_MINIO_BUCKET             = "synapse-provider-assets-staging"
    VIDEO_STORAGE_MINIO_SECURE             = "true"
    SYNAPSE_ENV                            = var.environment
    SYNAPSE_GATEWAY                        = "https://api-staging.synapse-network.ai"
  }
  provider_runtime_secret_env = {
    GATEWAY_PROVIDER_SIGNATURE_SECRET = "synapse-staging-provider-signature-secret"
    PROVIDER_SERVICE_POSTGRES_DSN     = "synapse-staging-provider-postgres-dsn"
    ETHERSCAN_API_KEY                 = "synapse-staging-provider-etherscan-api-key"
    TWITTER_X_API_KEY                 = "synapse-staging-provider-twitter-x-api-key"
    TWITTER_X_API_SECRET              = "synapse-staging-provider-twitter-x-api-secret"
    TWITTER_X_API_BEARER_TOKEN        = "synapse-staging-provider-twitter-x-bearer-token"
    VIDEO_STORAGE_MINIO_ACCESS_KEY    = "synapse-staging-provider-minio-access-key"
    VIDEO_STORAGE_MINIO_SECRET_KEY    = "synapse-staging-provider-minio-secret-key"
  }
  provider_onboarding_env = merge(
    local.provider_runtime_env,
    {
      PROVIDER_RUNTIME_ROLE = "onboarding"
    },
  )
  provider_onboarding_secret_env = {
    SYNAPSE_PROVIDER_OWNER_PRIVATE_KEY = "synapse-staging-provider-onboarding-owner-private-key"
  }
  cloud_run_services = {
    gateway = {
      name            = "${local.name_prefix}-gateway"
      image           = var.gateway_image
      port            = 8000
      concurrency     = local.is_production ? 40 : 20
      min_instances   = local.is_production ? 1 : 0
      max_instances   = local.is_production ? 3 : 2
      env             = local.runtime_env
      secret_env      = local.gateway_secret_env
      service_account = google_service_account.runtime.email
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
          POSTGRES_POOL_MAX             = "3"
          EXECUTION_WORKER_ENABLED      = "false"
          ADMIN_GATEWAY_PORT            = "8000"
          ADMIN_GATEWAY_ALLOWED_ORIGINS = "https://admin-staging.synapse-network.ai"
          ADMIN_SESSION_COOKIE_SECURE   = "true"
          ADMIN_SESSION_COOKIE_SAMESITE = "lax"
          ADMIN_SESSION_COOKIE_DOMAIN   = ".synapse-network.ai"
          ADMIN_LOGIN_LOCK_THRESHOLD    = "5"
          ADMIN_LOGIN_LOCK_HOURS        = "24"
          GATEWAY_INTERNAL_BASE_URL     = "https://api-staging.synapse-network.ai"
          GCP_ALERT_RECEIVER_ENABLED    = "true"
          GCP_ALERT_RECEIVER_USERNAME   = "synapse-gcp-alert"
          GCP_ALERT_DEFAULT_ROUTE       = "staging-drill"
        },
      )
      secret_env      = local.gateway_admin_secret_env
      service_account = google_service_account.runtime.email
    }
    user_front = {
      name            = "${local.name_prefix}-user-front"
      image           = var.user_front_image
      port            = 3000
      concurrency     = 40
      min_instances   = 0
      max_instances   = 2
      env             = var.frontend_runtime_env
      secret_env      = {}
      service_account = google_service_account.runtime.email
    }
    admin_front = {
      name            = "${local.name_prefix}-admin-front"
      image           = var.admin_front_image
      port            = 3000
      concurrency     = 20
      min_instances   = 0
      max_instances   = 1
      env             = var.frontend_runtime_env
      secret_env      = {}
      service_account = google_service_account.runtime.email
    }
    provider = {
      name            = "${local.name_prefix}-provider"
      image           = var.provider_image
      port            = 8100
      concurrency     = 10
      min_instances   = 0
      max_instances   = 2
      env             = local.provider_runtime_env
      secret_env      = local.provider_runtime_secret_env
      service_account = google_service_account.provider_runtime.email
    }
  }
  enabled_cloud_run_services = {
    for key, service in local.cloud_run_services : key => service
    if trimspace(service.image) != ""
  }
  cloud_run_jobs = {
    deposit_indexer = {
      name            = "${local.name_prefix}-deposit-indexer"
      image           = var.gateway_image
      command         = ["python", "-m", "src.worker"]
      args            = ["deposit-indexer", "--once"]
      schedule        = "* * * * *"
      timeout         = "50s"
      max_retries     = 0
      retry_count     = 0
      env             = local.runtime_env
      secret_env      = local.gateway_secret_env
      service_account = google_service_account.runtime.email
    }
    provider_withdraw_reaper = {
      name            = "${local.name_prefix}-provider-withdraw-reaper"
      image           = var.gateway_image
      command         = ["python", "-m", "src.worker"]
      args            = ["provider-withdraw-reaper", "--once"]
      schedule        = "* * * * *"
      timeout         = "50s"
      max_retries     = 0
      retry_count     = 0
      env             = local.runtime_env
      secret_env      = local.gateway_secret_env
      service_account = google_service_account.runtime.email
    }
    consumer_withdraw_processor = {
      name            = "${local.name_prefix}-consumer-withdraw-processor"
      image           = var.gateway_image
      command         = ["python", "-m", "src.worker"]
      args            = ["consumer-withdraw-processor", "--once"]
      schedule        = "* * * * *"
      timeout         = "50s"
      max_retries     = 0
      retry_count     = 0
      env             = local.runtime_env
      secret_env      = local.gateway_secret_env
      service_account = google_service_account.runtime.email
    }
    notification_outbox_drain = {
      name            = "${local.name_prefix}-notification-outbox-drain"
      image           = var.gateway_image
      command         = ["python", "-m", "src.worker"]
      args            = ["notification-outbox", "--once"]
      schedule        = "* * * * *"
      timeout         = "50s"
      max_retries     = 1
      retry_count     = 1
      env             = local.runtime_env
      secret_env      = local.gateway_secret_env
      service_account = google_service_account.runtime.email
    }
    in_app_notification_cleanup = {
      name            = "${local.name_prefix}-in-app-notification-cleanup"
      image           = var.gateway_image
      command         = ["python", "-m", "src.worker"]
      args            = ["in-app-cleanup", "--once"]
      schedule        = "0 19 * * *"
      timeout         = "600s"
      max_retries     = 0
      retry_count     = 0
      env             = merge(local.runtime_env, { IN_APP_NOTIFICATION_CLEANUP_ENABLED = "true" })
      secret_env      = local.gateway_secret_env
      service_account = google_service_account.runtime.email
    }
    db_migrate = {
      name            = "${local.name_prefix}-db-migrate"
      image           = var.gateway_image
      command         = ["bash", "scripts/deploy/migrate_db.sh"]
      args            = [var.environment]
      schedule        = ""
      timeout         = "600s"
      max_retries     = 0
      retry_count     = 0
      env             = merge(local.runtime_env, { POSTGRES_AUTO_INIT = "0" })
      secret_env      = local.gateway_migration_secret_env
      service_account = google_service_account.runtime.email
    }
    gateway_admin_db_migrate = {
      name        = "${local.name_prefix}-gateway-admin-db-migrate"
      image       = var.gateway_admin_image
      command     = ["python", "scripts/apply_migrations.py"]
      args        = []
      schedule    = ""
      timeout     = "600s"
      max_retries = 0
      retry_count = 0
      env = merge(
        local.runtime_env,
        {
          POSTGRES_POOL_MAX        = "3"
          POSTGRES_AUTO_INIT       = "0"
          EXECUTION_WORKER_ENABLED = "false"
          ADMIN_GATEWAY_PORT       = "8000"
        },
      )
      secret_env      = local.gateway_admin_secret_env
      service_account = google_service_account.runtime.email
    }
    provider_onboarding = {
      name            = "${local.name_prefix}-provider-onboarding"
      image           = var.provider_image
      command         = ["python", "-m", "app.gateway_onboarding"]
      args            = ["ensure", "--env", var.environment]
      schedule        = ""
      timeout         = "300s"
      max_retries     = 0
      retry_count     = 0
      env             = local.provider_onboarding_env
      secret_env      = local.provider_onboarding_secret_env
      service_account = google_service_account.provider_onboarding.email
    }
    provider_gpp_e2e = {
      name            = "${local.name_prefix}-provider-gpp-e2e"
      image           = var.provider_image
      command         = ["python", "-m", "app.gateway_onboarding.e2e"]
      args            = [var.environment]
      schedule        = ""
      timeout         = "600s"
      max_retries     = 0
      retry_count     = 0
      env             = local.provider_onboarding_env
      secret_env      = local.provider_onboarding_secret_env
      service_account = google_service_account.provider_onboarding.email
    }
  }
  enabled_cloud_run_jobs = {
    for key, job in local.cloud_run_jobs : key => job
    if trimspace(job.image) != ""
  }
  scheduled_cloud_run_jobs = {
    for key, job in local.enabled_cloud_run_jobs : key => job
    if trimspace(job.schedule) != ""
  }
}

resource "google_artifact_registry_repository" "docker" {
  location               = var.region
  repository_id          = var.artifact_registry_repository
  description            = "Synapse ${var.environment} Docker images"
  format                 = "DOCKER"
  labels                 = local.labels
  cleanup_policy_dry_run = var.artifact_registry_cleanup_policy_dry_run

  cleanup_policies {
    id     = "delete-untagged-older-than-7d"
    action = "DELETE"

    condition {
      tag_state  = "UNTAGGED"
      older_than = "7d"
    }
  }

  cleanup_policies {
    id     = "delete-staging-tagged-older-than-45d"
    action = "DELETE"

    condition {
      tag_state    = "TAGGED"
      tag_prefixes = ["staging-"]
      older_than   = "45d"
    }
  }

  cleanup_policies {
    id     = "keep-promoted-release-tags"
    action = "KEEP"

    condition {
      tag_state    = "TAGGED"
      tag_prefixes = ["prod-", "production-", "promoted-", "release-"]
    }
  }

  cleanup_policies {
    id     = "keep-recent-10-per-package"
    action = "KEEP"

    most_recent_versions {
      keep_count = 10
    }
  }
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

resource "google_service_account" "scheduler" {
  account_id   = "${local.name_prefix}-scheduler"
  display_name = "Synapse ${var.environment} Cloud Scheduler invoker"
}

resource "google_service_account" "provider_runtime" {
  account_id   = "${local.name_prefix}-provider-runtime"
  display_name = "Synapse ${var.environment} Provider runtime"
}

resource "google_service_account" "provider_onboarding" {
  account_id   = "${local.name_prefix}-provider-onboarding"
  display_name = "Synapse ${var.environment} Provider onboarding job"
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

resource "google_project_iam_member" "provider_runtime_logging_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.provider_runtime.email}"
}

resource "google_project_iam_member" "provider_runtime_monitoring_writer" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.provider_runtime.email}"
}

resource "google_project_iam_member" "provider_runtime_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.provider_runtime.email}"
}

resource "google_project_iam_member" "provider_onboarding_logging_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.provider_onboarding.email}"
}

resource "google_project_iam_member" "provider_onboarding_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.provider_onboarding.email}"
}

resource "google_secret_manager_secret_iam_member" "provider_runtime_secret_accessor" {
  for_each  = toset(values(local.provider_runtime_secret_env))
  project   = var.project_id
  secret_id = google_secret_manager_secret.placeholders[each.value].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.provider_runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "provider_onboarding_secret_accessor" {
  for_each  = toset(values(local.provider_onboarding_secret_env))
  project   = var.project_id
  secret_id = google_secret_manager_secret.placeholders[each.value].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.provider_onboarding.email}"
}

resource "google_project_iam_member" "scheduler_run_developer" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_service_account_iam_member" "scheduler_runtime_act_as" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_sql_database_instance" "postgres" {
  name                = "${local.name_prefix}-postgres"
  region              = var.region
  database_version    = var.cloud_sql_database_version
  deletion_protection = var.cloud_sql_deletion_protection

  settings {
    tier              = var.cloud_sql_tier
    edition           = var.cloud_sql_edition
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
  # Staging uses public custom domains. Application-layer auth and receiver
  # tokens protect privileged routes; Cloud Run IAM cannot protect browser and
  # GCP Monitoring webhook traffic on these public hostnames.
  invoker_iam_disabled = !local.is_production

  template {
    service_account                  = each.value.service_account
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

      dynamic "env" {
        for_each = each.value.secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_project_iam_member.runtime_cloudsql_client,
    google_project_iam_member.runtime_logging_writer,
    google_project_iam_member.runtime_monitoring_writer,
    google_project_iam_member.runtime_secret_accessor,
    google_project_iam_member.provider_runtime_cloudsql_client,
    google_project_iam_member.provider_runtime_logging_writer,
    google_project_iam_member.provider_runtime_monitoring_writer,
    google_secret_manager_secret_iam_member.provider_runtime_secret_accessor,
    google_sql_database.gateway,
  ]
}

resource "google_cloud_run_v2_job" "jobs" {
  for_each = local.enabled_cloud_run_jobs

  name                = each.value.name
  location            = var.region
  labels              = local.labels
  deletion_protection = local.is_production

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account = each.value.service_account
      timeout         = each.value.timeout
      max_retries     = each.value.max_retries

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.postgres.connection_name]
        }
      }

      containers {
        image   = each.value.image
        command = each.value.command
        args    = each.value.args

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

        dynamic "env" {
          for_each = each.value.secret_env
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = env.value
                version = "latest"
              }
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_project_iam_member.runtime_cloudsql_client,
    google_project_iam_member.runtime_logging_writer,
    google_project_iam_member.runtime_monitoring_writer,
    google_project_iam_member.runtime_secret_accessor,
    google_project_iam_member.provider_onboarding_cloudsql_client,
    google_project_iam_member.provider_onboarding_logging_writer,
    google_secret_manager_secret_iam_member.provider_onboarding_secret_accessor,
    google_sql_database.gateway,
  ]
}

resource "google_cloud_scheduler_job" "jobs" {
  for_each = local.scheduled_cloud_run_jobs

  name      = "${google_cloud_run_v2_job.jobs[each.key].name}-schedule"
  region    = var.region
  schedule  = each.value.schedule
  time_zone = var.scheduler_time_zone

  retry_config {
    retry_count = each.value.retry_count
  }

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${google_cloud_run_v2_job.jobs[each.key].name}:run"

    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [
    google_project_iam_member.scheduler_run_developer,
    google_service_account_iam_member.scheduler_runtime_act_as,
  ]
}
