locals {
  name_prefix                     = "synapse-${var.environment}"
  is_production                   = contains(["prod", "production"], lower(var.environment))
  provider_enabled                = trimspace(var.provider_image) != ""
  withdraw_signer_kms_enabled     = true
  withdraw_signer_runtime_enabled = trimspace(var.withdraw_signer_address) != "" && trimspace(var.withdraw_signer_kms_key_version) != ""
  provider_secret_ids = toset([
    "synapse-prod-provider-postgres-dsn",
    "synapse-prod-provider-onboarding-owner-private-key",
    "synapse-prod-provider-etherscan-api-key",
    "synapse-prod-provider-twitter-x-api-key",
    "synapse-prod-provider-twitter-x-api-secret",
    "synapse-prod-provider-twitter-x-bearer-token",
    "synapse-prod-provider-deepseek-api-key",
    "synapse-prod-provider-minio-access-key",
    "synapse-prod-provider-minio-secret-key",
  ])
  managed_secret_ids = setunion(
    local.provider_enabled ? var.secret_ids : setsubtract(var.secret_ids, local.provider_secret_ids),
    var.legacy_withdraw_private_key_secret_enabled ? toset(["synapse-prod-private-key"]) : toset([]),
  )
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
      ENVIRONMENT                              = var.environment
      STORAGE_BACKEND                          = "postgres"
      POSTGRES_HOST                            = "/cloudsql/${google_sql_database_instance.postgres.connection_name}"
      POSTGRES_DB                              = var.cloud_sql_database_name
      POSTGRES_USER                            = "synapse_gateway_app"
      POSTGRES_MIGRATOR_USER                   = "synapse_gateway_migrator"
      POSTGRES_CONNECT_TIMEOUT_SEC             = "5"
      POSTGRES_POOL_MAX                        = "5"
      POSTGRES_AUTO_INIT                       = "0"
      CORS_ALLOW_ORIGINS                       = "https://synapse-network.ai"
      ROUTER_ADDRESS                           = ""
      USDC_TOKEN_ADDRESS                       = ""
      V2_INDEXER_ENABLED                       = "false"
      PROVIDER_WITHDRAW_EXPIRY_REAPER_ENABLED  = "false"
      CONSUMER_WITHDRAW_PROCESSOR_ENABLED      = "false"
      CONSUMER_WITHDRAW_CHAIN_RECOVERY_ENABLED = "false"
      WITHDRAWAL_EXPIRY_SWEEPER_ENABLED        = "false"
      ANALYTICS_TRANSPORT                      = "outbox"
      ANALYTICS_STRICT_KAFKA                   = "false"
      ANALYTICS_KAFKA_BOOTSTRAP_SERVERS        = ""
      DOWNSTREAM_ADAPTIVE_REDIS_ENABLED        = "false"
      REDIS_URL                                = ""
      EMAIL_OUTBOX_ENABLED                     = "true"
      EMAIL_TRANSPORT                          = "gmail_smtp"
      GMAIL_SMTP_HOST                          = "smtp.gmail.com"
      GMAIL_SMTP_PORT                          = "587"
      EMAIL_FROM                               = "Synapse Network <alerts@synapse-network.ai>"
      EMAIL_REPLY_TO                           = "support@synapse-network.ai"
      GATEWAY_PROVIDER_SIGNATURE_ENABLED       = "true"
      GATEWAY_PROVIDER_SIGNATURE_MAX_SKEW_S    = "300"
      NOTIFICATION_OUTBOX_TRIGGER_ENABLED      = "true"
      NOTIFICATION_OUTBOX_TRIGGER_URL          = "http://127.0.0.1:8000/internal/jobs/notification-outbox/trigger"
      NOTIFICATION_OUTBOX_TRIGGER_TIMEOUT_SEC  = "3"
      NOTIFICATION_OUTBOX_FALLBACK_ENABLED     = "true"
      PUBLIC_GATEWAY_BASE_URL                  = "https://api.synapse-network.ai"
      PUBLIC_APP_BASE_URL                      = "https://synapse-network.ai"
      TRANSACTION_LARK_ENABLED                 = "true"
      IN_APP_NOTIFICATION_CLEANUP_ENABLED      = "false"
      WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC        = "1.000000"
      WITHDRAWAL_TIMEOUT_ALERT_AFTER_SEC       = "900"
      STAGING_ALERT_DRILL_ENABLED              = "false"
    },
    local.withdraw_signer_runtime_enabled ? {
      WITHDRAW_SIGNER_MODE             = "gcp_kms"
      WITHDRAW_SIGNER_GCP_KMS_KEY_NAME = "${google_kms_crypto_key.withdrawal_signer[0].id}/cryptoKeyVersions/${var.withdraw_signer_kms_key_version}"
      WITHDRAW_SIGNER_ADDRESS          = var.withdraw_signer_address
      } : {
      WITHDRAW_SIGNER_MODE = "local_private_key"
    },
    var.common_runtime_env,
  )
  gateway_withdraw_signer_secret_env = local.withdraw_signer_runtime_enabled ? {} : (
    var.legacy_withdraw_private_key_secret_enabled ? { PRIVATE_KEY = "synapse-prod-private-key" } : {}
  )
  gateway_secret_env = merge(
    {
      POSTGRES_DSN                      = "synapse-prod-postgres-dsn"
      POSTGRES_PASSWORD                 = "synapse-prod-postgres-password"
      JWT_SECRET                        = "synapse-prod-jwt-secret"
      AUTH_SECRET                       = "synapse-prod-auth-secret"
      METRICS_BASIC_USERNAME            = "synapse-prod-metrics-basic-username"
      METRICS_BASIC_PASSWORD            = "synapse-prod-metrics-basic-password"
      METRICS_BEARER_TOKEN              = "synapse-prod-metrics-bearer-token"
      GATEWAY_INTERNAL_JWT_SECRET       = "synapse-prod-gateway-internal-jwt-secret"
      INTERNAL_TRIGGER_SECRET           = "synapse-prod-internal-trigger-secret"
      RPC_URL                           = "synapse-prod-arbitrum-one-rpc-url"
      GMAIL_SMTP_USERNAME               = "synapse-prod-gmail-username"
      GMAIL_SMTP_APP_PASSWORD           = "synapse-prod-gmail-app-password"
      GATEWAY_PROVIDER_SIGNATURE_SECRET = "synapse-prod-provider-signature-secret"
      TRANSACTION_LARK_WEBHOOK_URL      = "synapse-prod-lark-webhook-prod-alerts"
      TRANSACTION_LARK_SECRET           = "synapse-prod-lark-secret-prod-alerts"
      PLATFORM_FEE_ADMIN_WALLETS        = "synapse-prod-gateway-admin-wallet"
      INDEXER_ADMIN_WALLETS             = "synapse-prod-gateway-admin-wallet"
    },
    local.gateway_withdraw_signer_secret_env,
  )
  gateway_migration_secret_env = merge(
    local.gateway_secret_env,
    local.gateway_withdraw_signer_secret_env,
    {
      POSTGRES_MIGRATOR_PASSWORD = "synapse-prod-postgres-migrator-password"
    },
  )
  gateway_admin_secret_env = {
    METRICS_BASIC_USERNAME           = "synapse-prod-metrics-basic-username"
    METRICS_BASIC_PASSWORD           = "synapse-prod-metrics-basic-password"
    METRICS_BEARER_TOKEN             = "synapse-prod-metrics-bearer-token"
    ADMIN_CSRF_SECRET                = "synapse-prod-admin-csrf-secret"
    ADMIN_DATABASE_DSN               = "synapse-prod-admin-database-dsn"
    ADMIN_DATABASE_MIGRATION_DSN     = "synapse-prod-admin-database-migration-dsn"
    ADMIN_TOTP_SECRET_ENCRYPTION_KEY = "synapse-prod-admin-totp-secret-encryption-key"
    GATEWAY_READONLY_DSN             = "synapse-prod-gateway-readonly-dsn"
    GATEWAY_FORUM_WRITE_DSN          = "synapse-prod-gateway-forum-write-dsn"
    GATEWAY_INTERNAL_ADMIN_WALLET    = "synapse-prod-gateway-admin-wallet"
    GATEWAY_INTERNAL_JWT_SECRET      = "synapse-prod-gateway-internal-jwt-secret"
    GCP_ALERT_RECEIVER_TOKEN         = "synapse-prod-gcp-alert-receiver-token"
    LARK_WEBHOOK_P0_WAR_ROOM         = "synapse-prod-lark-webhook-p0"
    LARK_SECRET_P0_WAR_ROOM          = "synapse-prod-lark-secret-p0"
    LARK_WEBHOOK_PROD_ALERTS         = "synapse-prod-lark-webhook-prod-alerts"
    LARK_SECRET_PROD_ALERTS          = "synapse-prod-lark-secret-prod-alerts"
  }
  provider_runtime_env = {
    PROVIDER_ENV                           = var.environment
    PROVIDER_RUNTIME_ROLE                  = "runtime"
    PROVIDER_PUBLIC_BASE_URL               = "https://provider.synapse-network.ai"
    PROVIDER_GATEWAY_REGISTRATION_EXPECTED = "true"
    PROVIDER_PUBLIC_DOCS_ENABLED           = "false"
    PROVIDER_STAGING_ENABLED_SERVICES_JSON = "[\"web3-sentiment-index\",\"protocol-fundamental-brief\",\"oss-security-healthcheck\",\"deepseek-chat\"]"
    PROVIDER_MAX_BODY_BYTES                = "131072"
    PROVIDER_MAX_RESPONSE_BYTES            = "1048576"
    PROVIDER_GLOBAL_QPS                    = "5"
    PROVIDER_SERVICE_QPS_JSON              = "{\"web3-sentiment-index\":2,\"protocol-fundamental-brief\":1,\"oss-security-healthcheck\":1,\"deepseek-chat\":1}"
    GATEWAY_PROVIDER_SIGNATURE_ENABLED     = "true"
    GATEWAY_PROVIDER_SIGNATURE_MAX_SKEW_S  = "300"
    SENTIMENT_REPOSITORY_BACKEND           = "postgres"
    SENTIMENT_SCHEDULER_ENABLED            = "false"
    SENTIMENT_PROXY_POOL_ENABLED           = "false"
    SENTIMENT_PROXY_POOL_URLS_JSON         = "[]"
    SENTIMENT_PROXY_TIMEOUT_FLOOR_S        = "8"
    VIDEO_STORAGE_BACKEND                  = "minio"
    VIDEO_STORAGE_MINIO_ENDPOINT           = ""
    VIDEO_STORAGE_MINIO_BUCKET             = "synapse-provider-assets-prod"
    VIDEO_STORAGE_MINIO_SECURE             = "true"
    SYNAPSE_ENV                            = var.environment
    SYNAPSE_GATEWAY                        = "https://api.synapse-network.ai"
  }
  provider_runtime_secret_env = {
    GATEWAY_PROVIDER_SIGNATURE_SECRET = "synapse-prod-provider-signature-secret"
    PROVIDER_SERVICE_POSTGRES_DSN     = "synapse-prod-provider-postgres-dsn"
    ETHERSCAN_API_KEY                 = "synapse-prod-provider-etherscan-api-key"
    TWITTER_X_API_KEY                 = "synapse-prod-provider-twitter-x-api-key"
    TWITTER_X_API_SECRET              = "synapse-prod-provider-twitter-x-api-secret"
    TWITTER_X_API_BEARER_TOKEN        = "synapse-prod-provider-twitter-x-bearer-token"
    DEEPSEEK_API_KEY                  = "synapse-prod-provider-deepseek-api-key"
    VIDEO_STORAGE_MINIO_ACCESS_KEY    = "synapse-prod-provider-minio-access-key"
    VIDEO_STORAGE_MINIO_SECRET_KEY    = "synapse-prod-provider-minio-secret-key"
  }
  provider_onboarding_env = merge(
    local.provider_runtime_env,
    {
      PROVIDER_RUNTIME_ROLE = "onboarding"
    },
  )
  provider_onboarding_secret_env = {
    SYNAPSE_PROVIDER_OWNER_PRIVATE_KEY = "synapse-prod-provider-onboarding-owner-private-key"
  }
  cloud_run_services = {
    gateway = {
      name            = "${local.name_prefix}-gateway"
      image           = var.gateway_image
      port            = 8000
      concurrency     = local.is_production ? 40 : 20
      min_instances   = var.gateway_min_instances
      max_instances   = local.is_production ? 3 : 2
      env             = local.runtime_env
      secret_env      = local.gateway_secret_env
      public_invoker  = true
      use_vpc_egress  = true
      service_account = google_service_account.gateway_runtime.email
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
          ADMIN_GATEWAY_DEBUG           = "false"
          ADMIN_GATEWAY_PORT            = "8000"
          ADMIN_GATEWAY_ALLOWED_ORIGINS = "https://admin.synapse-network.ai"
          ADMIN_SESSION_COOKIE_SECURE   = "true"
          ADMIN_SESSION_COOKIE_SAMESITE = "lax"
          ADMIN_LOGIN_LOCK_THRESHOLD    = "5"
          ADMIN_LOGIN_LOCK_HOURS        = "24"
          GATEWAY_INTERNAL_BASE_URL     = "https://api.synapse-network.ai"
          PUBLIC_APP_BASE_URL           = "https://admin.synapse-network.ai"
          GCP_ALERT_RECEIVER_ENABLED    = "true"
          GCP_ALERT_RECEIVER_USERNAME   = "synapse-gcp-alert"
          GCP_ALERT_DEFAULT_ROUTE       = "prod-alerts"
        },
      )
      secret_env      = local.gateway_admin_secret_env
      public_invoker  = true
      use_vpc_egress  = true
      service_account = google_service_account.gateway_admin_runtime.email
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
      public_invoker  = true
      use_vpc_egress  = false
      service_account = google_service_account.frontend_runtime.email
    }
    admin_front = {
      name          = "${local.name_prefix}-admin-front"
      image         = var.admin_front_image
      port          = 3000
      concurrency   = 20
      min_instances = 0
      max_instances = 1
      env = merge(
        var.frontend_runtime_env,
        {
          NEXT_PUBLIC_ADMIN_API_BASE_URL = ""
          ADMIN_API_PROXY_TARGET         = "https://admin-api.synapse-network.ai"
        },
      )
      secret_env      = {}
      public_invoker  = true
      use_vpc_egress  = false
      service_account = google_service_account.admin_front_runtime.email
    }
    docs_front = {
      name          = "${local.name_prefix}-docs-front"
      image         = var.docs_front_image
      port          = 3000
      concurrency   = 40
      min_instances = 0
      max_instances = 2
      env = merge(
        var.frontend_runtime_env,
        {
          NEXT_PUBLIC_APP_ENV          = var.environment
          NEXT_PUBLIC_DOCS_BASE_URL    = local.is_production ? "https://docs.synapse-network.ai" : "https://docs-synapse-network.ai"
          NEXT_PUBLIC_CONSOLE_BASE_URL = local.is_production ? "https://synapse-network.ai/dashboard/overview" : "https://synapse-network.ai/dashboard/overview"
          NEXT_PUBLIC_GATEWAY_BASE_URL = local.is_production ? "https://api.synapse-network.ai" : "https://api-synapse-network.ai"
        },
      )
      secret_env      = {}
      public_invoker  = true
      use_vpc_egress  = false
      service_account = google_service_account.frontend_runtime.email
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
      public_invoker  = true
      use_vpc_egress  = true
      service_account = local.provider_enabled ? google_service_account.provider_runtime[0].email : null
    }
  }
  enabled_cloud_run_services = {
    for key, service in local.cloud_run_services : key => service
    if trimspace(service.image) != ""
  }
  cloud_run_jobs = {
    deposit_indexer = {
      name        = "${local.name_prefix}-deposit-indexer"
      image       = var.gateway_image
      command     = ["python", "-m", "src.worker"]
      args        = ["deposit-indexer", "--once"]
      schedule    = var.deposit_indexer_schedule
      timeout     = "120s"
      max_retries = 0
      retry_count = 0
      env = merge(local.runtime_env, {
        POSTGRES_POOL_MAX         = "3"
        POSTGRES_POOL_TIMEOUT_SEC = "15"
      })
      secret_env      = local.gateway_secret_env
      use_vpc_egress  = true
      service_account = google_service_account.gateway_runtime.email
    }
    consumer_withdraw_chain_recovery = {
      name        = "${local.name_prefix}-consumer-withdraw-chain-recovery"
      image       = var.gateway_image
      command     = ["python", "-m", "src.worker"]
      args        = ["consumer-withdraw-chain-recovery", "--once"]
      schedule    = var.consumer_withdraw_chain_recovery_schedule
      timeout     = "120s"
      max_retries = 0
      retry_count = 0
      env = merge(local.runtime_env, {
        POSTGRES_POOL_MAX         = "3"
        POSTGRES_POOL_TIMEOUT_SEC = "15"
      })
      secret_env      = local.gateway_secret_env
      use_vpc_egress  = true
      service_account = google_service_account.gateway_runtime.email
    }
    withdrawal_expiry_sweeper = {
      name        = "${local.name_prefix}-withdrawal-expiry-sweeper"
      image       = var.gateway_image
      command     = ["python", "-m", "src.worker"]
      args        = ["withdrawal-expiry-sweeper", "--once"]
      schedule    = var.withdrawal_expiry_sweeper_schedule
      timeout     = "120s"
      max_retries = 0
      retry_count = 0
      env = merge(local.runtime_env, {
        POSTGRES_POOL_MAX         = "3"
        POSTGRES_POOL_TIMEOUT_SEC = "15"
      })
      secret_env      = local.gateway_secret_env
      use_vpc_egress  = true
      service_account = google_service_account.gateway_runtime.email
    }
    notification_outbox_drain = {
      name        = "${local.name_prefix}-notification-outbox-drain"
      image       = var.gateway_image
      command     = ["python", "-m", "src.worker"]
      args        = ["notification-outbox", "--once"]
      schedule    = var.notification_outbox_drain_schedule
      timeout     = "50s"
      max_retries = 1
      retry_count = 1
      env = merge(local.runtime_env, {
        POSTGRES_POOL_MAX         = "3"
        POSTGRES_POOL_TIMEOUT_SEC = "15"
      })
      secret_env      = local.gateway_secret_env
      use_vpc_egress  = true
      service_account = google_service_account.gateway_runtime.email
    }
    in_app_notification_cleanup = {
      name        = "${local.name_prefix}-in-app-notification-cleanup"
      image       = var.gateway_image
      command     = ["python", "-m", "src.worker"]
      args        = ["in-app-cleanup", "--once"]
      schedule    = "0 19 * * *"
      timeout     = "600s"
      max_retries = 0
      retry_count = 0
      env = merge(local.runtime_env, {
        IN_APP_NOTIFICATION_CLEANUP_ENABLED = "true"
        POSTGRES_POOL_MAX                   = "3"
        POSTGRES_POOL_TIMEOUT_SEC           = "15"
      })
      secret_env      = local.gateway_secret_env
      use_vpc_egress  = true
      service_account = google_service_account.gateway_runtime.email
    }
    db_migrate = {
      name        = "${local.name_prefix}-db-migrate"
      image       = var.gateway_image
      command     = ["bash", "scripts/deploy/migrate_db.sh"]
      args        = [var.environment]
      schedule    = ""
      timeout     = "600s"
      max_retries = 0
      retry_count = 0
      env = merge(local.runtime_env, {
        POSTGRES_AUTO_INIT        = "0"
        POSTGRES_POOL_MAX         = "1"
        POSTGRES_POOL_TIMEOUT_SEC = "15"
        SYNAPSE_MIGRATION_CONFIRM = "I_UNDERSTAND_THIS_CHANGES_PROD"
      })
      secret_env      = local.gateway_migration_secret_env
      use_vpc_egress  = true
      service_account = google_service_account.gateway_runtime.email
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
          POSTGRES_POOL_MAX           = "3"
          POSTGRES_POOL_TIMEOUT_SEC   = "15"
          POSTGRES_AUTO_INIT          = "0"
          EXECUTION_WORKER_ENABLED    = "false"
          ADMIN_GATEWAY_DEBUG         = "false"
          ADMIN_GATEWAY_PORT          = "8000"
          ADMIN_SESSION_COOKIE_SECURE = "true"
        },
      )
      secret_env      = local.gateway_admin_secret_env
      use_vpc_egress  = true
      service_account = google_service_account.gateway_admin_runtime.email
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
      use_vpc_egress  = true
      service_account = local.provider_enabled ? google_service_account.provider_onboarding[0].email : null
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
      use_vpc_egress  = true
      service_account = local.provider_enabled ? google_service_account.provider_onboarding[0].email : null
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
    id     = "keep-recent-${var.artifact_registry_keep_recent_count}-per-package"
    action = "KEEP"

    most_recent_versions {
      keep_count = var.artifact_registry_keep_recent_count
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
  for_each  = local.managed_secret_ids
  secret_id = each.value
  labels    = local.labels

  replication {
    auto {}
  }
}

resource "google_kms_key_ring" "withdrawal_signer" {
  count    = local.withdraw_signer_kms_enabled ? 1 : 0
  name     = local.name_prefix
  location = var.region
}

resource "google_kms_crypto_key" "withdrawal_signer" {
  count    = local.withdraw_signer_kms_enabled ? 1 : 0
  name     = "${local.name_prefix}-withdraw-signer"
  key_ring = google_kms_key_ring.withdrawal_signer[0].id
  purpose  = "ASYMMETRIC_SIGN"

  version_template {
    algorithm        = "EC_SIGN_SECP256K1_SHA256"
    protection_level = "HSM"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_service_account" "gateway_runtime" {
  account_id   = "${local.name_prefix}-gateway"
  display_name = "Synapse ${var.environment} Gateway runtime"
}

resource "google_service_account" "gateway_admin_runtime" {
  account_id   = "${local.name_prefix}-gateway-admin"
  display_name = "Synapse ${var.environment} Gateway-admin runtime"
}

resource "google_service_account" "frontend_runtime" {
  account_id   = "${local.name_prefix}-frontend"
  display_name = "Synapse ${var.environment} public frontend runtime"
}

resource "google_service_account" "admin_front_runtime" {
  account_id   = "${local.name_prefix}-admin-front"
  display_name = "Synapse ${var.environment} admin-front runtime"
}

resource "google_service_account" "scheduler" {
  account_id   = "${local.name_prefix}-scheduler"
  display_name = "Synapse ${var.environment} Cloud Scheduler invoker"
}

resource "google_service_account" "provider_runtime" {
  count        = local.provider_enabled ? 1 : 0
  account_id   = "syn-${var.environment}-prov-rt"
  display_name = "Synapse ${var.environment} Provider runtime"
}

resource "google_service_account" "provider_onboarding" {
  count        = local.provider_enabled ? 1 : 0
  account_id   = "syn-${var.environment}-prov-onboard"
  display_name = "Synapse ${var.environment} Provider onboarding job"
}

resource "google_project_iam_member" "gateway_logging_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.gateway_runtime.email}"
}

resource "google_project_iam_member" "gateway_monitoring_writer" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.gateway_runtime.email}"
}

resource "google_project_iam_member" "gateway_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.gateway_runtime.email}"
}

resource "google_project_iam_member" "gateway_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.gateway_runtime.email}"
}

resource "google_kms_crypto_key_iam_member" "gateway_withdrawal_signer" {
  count         = local.withdraw_signer_kms_enabled ? 1 : 0
  crypto_key_id = google_kms_crypto_key.withdrawal_signer[0].id
  role          = "roles/cloudkms.signerVerifier"
  member        = "serviceAccount:${google_service_account.gateway_runtime.email}"
}

resource "google_project_iam_member" "gateway_admin_logging_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.gateway_admin_runtime.email}"
}

resource "google_project_iam_member" "gateway_admin_monitoring_writer" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.gateway_admin_runtime.email}"
}

resource "google_project_iam_member" "gateway_admin_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.gateway_admin_runtime.email}"
}

resource "google_project_iam_member" "gateway_admin_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.gateway_admin_runtime.email}"
}

resource "google_project_iam_member" "frontend_logging_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.frontend_runtime.email}"
}

resource "google_project_iam_member" "frontend_monitoring_writer" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.frontend_runtime.email}"
}

resource "google_project_iam_member" "admin_front_logging_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.admin_front_runtime.email}"
}

resource "google_project_iam_member" "admin_front_monitoring_writer" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.admin_front_runtime.email}"
}

resource "google_project_iam_member" "provider_runtime_logging_writer" {
  count   = local.provider_enabled ? 1 : 0
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.provider_runtime[0].email}"
}

resource "google_project_iam_member" "provider_runtime_monitoring_writer" {
  count   = local.provider_enabled ? 1 : 0
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.provider_runtime[0].email}"
}

resource "google_project_iam_member" "provider_runtime_cloudsql_client" {
  count   = local.provider_enabled ? 1 : 0
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.provider_runtime[0].email}"
}

resource "google_project_iam_member" "provider_onboarding_logging_writer" {
  count   = local.provider_enabled ? 1 : 0
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.provider_onboarding[0].email}"
}

resource "google_project_iam_member" "provider_onboarding_cloudsql_client" {
  count   = local.provider_enabled ? 1 : 0
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.provider_onboarding[0].email}"
}

resource "google_secret_manager_secret_iam_member" "provider_runtime_secret_accessor" {
  for_each  = local.provider_enabled ? toset(values(local.provider_runtime_secret_env)) : toset([])
  project   = var.project_id
  secret_id = google_secret_manager_secret.placeholders[each.value].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.provider_runtime[0].email}"
}

resource "google_secret_manager_secret_iam_member" "provider_onboarding_secret_accessor" {
  for_each  = local.provider_enabled ? toset(values(local.provider_onboarding_secret_env)) : toset([])
  project   = var.project_id
  secret_id = google_secret_manager_secret.placeholders[each.value].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.provider_onboarding[0].email}"
}

resource "google_project_iam_member" "scheduler_run_developer" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_service_account_iam_member" "scheduler_gateway_runtime_act_as" {
  service_account_id = google_service_account.gateway_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_service_account_iam_member" "scheduler_gateway_admin_runtime_act_as" {
  service_account_id = google_service_account.gateway_admin_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_compute_network" "prod" {
  name                    = var.vpc_network_name
  project                 = var.project_id
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "prod" {
  name          = var.vpc_subnet_name
  project       = var.project_id
  region        = var.region
  network       = google_compute_network.prod.id
  ip_cidr_range = var.vpc_subnet_cidr
}

resource "google_compute_global_address" "private_service_range" {
  name          = var.private_service_range_name
  project       = var.project_id
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = var.private_service_range_prefix_length
  network       = google_compute_network.prod.id
}

resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = google_compute_network.prod.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_service_range.name]
}

resource "google_vpc_access_connector" "cloud_run" {
  name          = var.vpc_connector_name
  project       = var.project_id
  region        = var.region
  network       = google_compute_network.prod.name
  ip_cidr_range = var.vpc_connector_cidr
  min_instances = 2
  max_instances = 3
}

resource "google_sql_database_instance" "postgres" {
  name                = "${local.name_prefix}-postgres"
  region              = var.region
  database_version    = var.cloud_sql_database_version
  deletion_protection = var.cloud_sql_deletion_protection

  settings {
    tier                  = var.cloud_sql_tier
    edition               = var.cloud_sql_edition
    availability_type     = var.cloud_sql_availability_type
    disk_type             = var.cloud_sql_disk_type
    disk_size             = var.cloud_sql_disk_size_gb
    disk_autoresize       = var.cloud_sql_disk_autoresize
    connector_enforcement = "REQUIRED"
    user_labels           = local.labels

    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = google_compute_network.prod.id
      enable_private_path_for_google_cloud_services = true
      ssl_mode                                      = "ENCRYPTED_ONLY"
    }

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

    password_validation_policy {
      min_length                  = 16
      reuse_interval              = 4
      complexity                  = "COMPLEXITY_DEFAULT"
      disallow_username_substring = true
      enable_password_policy      = true
    }
  }

  depends_on = [google_service_networking_connection.private_vpc_connection]
}

resource "google_sql_database" "gateway" {
  name     = var.cloud_sql_database_name
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_database" "gateway_admin" {
  name     = var.admin_cloud_sql_database_name
  instance = google_sql_database_instance.postgres.name
}

resource "google_cloud_run_v2_service" "services" {
  for_each = local.enabled_cloud_run_services

  name                 = each.value.name
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_ALL"
  labels               = local.labels
  invoker_iam_disabled = each.value.public_invoker

  template {
    service_account                  = each.value.service_account
    max_instance_request_concurrency = each.value.concurrency

    scaling {
      min_instance_count = each.value.min_instances
      max_instance_count = each.value.max_instances
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.postgres.connection_name]
      }
    }

    dynamic "vpc_access" {
      for_each = each.value.use_vpc_egress ? [1] : []
      content {
        egress = "PRIVATE_RANGES_ONLY"

        network_interfaces {
          network    = google_compute_network.prod.name
          subnetwork = google_compute_subnetwork.prod.name
        }
      }
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
    google_kms_crypto_key_iam_member.gateway_withdrawal_signer,
    google_project_iam_member.gateway_cloudsql_client,
    google_project_iam_member.gateway_logging_writer,
    google_project_iam_member.gateway_monitoring_writer,
    google_project_iam_member.gateway_secret_accessor,
    google_project_iam_member.gateway_admin_cloudsql_client,
    google_project_iam_member.gateway_admin_logging_writer,
    google_project_iam_member.gateway_admin_monitoring_writer,
    google_project_iam_member.gateway_admin_secret_accessor,
    google_project_iam_member.frontend_logging_writer,
    google_project_iam_member.frontend_monitoring_writer,
    google_project_iam_member.admin_front_logging_writer,
    google_project_iam_member.admin_front_monitoring_writer,
    google_sql_database.gateway,
    google_sql_database.gateway_admin,
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

      dynamic "vpc_access" {
        for_each = each.value.use_vpc_egress ? [1] : []
        content {
          egress = "PRIVATE_RANGES_ONLY"

          network_interfaces {
            network    = google_compute_network.prod.name
            subnetwork = google_compute_subnetwork.prod.name
          }
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
    google_kms_crypto_key_iam_member.gateway_withdrawal_signer,
    google_project_iam_member.gateway_cloudsql_client,
    google_project_iam_member.gateway_logging_writer,
    google_project_iam_member.gateway_monitoring_writer,
    google_project_iam_member.gateway_secret_accessor,
    google_project_iam_member.gateway_admin_cloudsql_client,
    google_project_iam_member.gateway_admin_logging_writer,
    google_project_iam_member.gateway_admin_monitoring_writer,
    google_project_iam_member.gateway_admin_secret_accessor,
    google_sql_database.gateway,
    google_sql_database.gateway_admin,
  ]
}

resource "google_cloud_scheduler_job" "jobs" {
  for_each = local.scheduled_cloud_run_jobs

  name      = "${each.value.name}-schedule"
  region    = var.region
  schedule  = each.value.schedule
  time_zone = var.scheduler_time_zone

  retry_config {
    retry_count = each.value.retry_count
  }

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${each.value.name}:run"

    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [
    google_project_iam_member.scheduler_run_developer,
    google_service_account_iam_member.scheduler_gateway_runtime_act_as,
    google_service_account_iam_member.scheduler_gateway_admin_runtime_act_as,
  ]
}

resource "google_cloud_run_service_iam_member" "admin_front_invoker_group" {
  count    = trimspace(var.admin_invoker_group_email) != "" && contains(keys(local.enabled_cloud_run_services), "admin_front") && !local.enabled_cloud_run_services["admin_front"].public_invoker ? 1 : 0
  project  = var.project_id
  location = var.region
  service  = google_cloud_run_v2_service.services["admin_front"].name
  role     = "roles/run.invoker"
  member   = "group:${var.admin_invoker_group_email}"
}

resource "google_cloud_run_service_iam_member" "gateway_admin_invoker_admin_front" {
  count    = contains(keys(local.enabled_cloud_run_services), "gateway_admin") && !local.enabled_cloud_run_services["gateway_admin"].public_invoker ? 1 : 0
  project  = var.project_id
  location = var.region
  service  = google_cloud_run_v2_service.services["gateway_admin"].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.admin_front_runtime.email}"
}

resource "google_cloud_run_service_iam_member" "gateway_admin_invoker_breakglass_group" {
  count    = trimspace(var.gateway_admin_breakglass_group_email) != "" && contains(keys(local.enabled_cloud_run_services), "gateway_admin") && !local.enabled_cloud_run_services["gateway_admin"].public_invoker ? 1 : 0
  project  = var.project_id
  location = var.region
  service  = google_cloud_run_v2_service.services["gateway_admin"].name
  role     = "roles/run.invoker"
  member   = "group:${var.gateway_admin_breakglass_group_email}"
}
