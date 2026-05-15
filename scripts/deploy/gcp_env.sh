#!/usr/bin/env bash
set -euo pipefail

synapse_require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

synapse_load_gcp_env() {
  local requested_env="${1:-}"
  if [[ -z "${requested_env}" ]]; then
    echo "missing environment: expected staging or prod" >&2
    exit 2
  fi

  case "${requested_env}" in
    staging|prod)
      ;;
    *)
      echo "unsupported environment: ${requested_env}" >&2
      exit 2
      ;;
  esac

  export ENVIRONMENT="${requested_env}"
  export REGION="${REGION:-us-central1}"
  export SYNAPSE_NAME_PREFIX="synapse-${ENVIRONMENT}"
  export SYNAPSE_SECRET_PREFIX="synapse-${ENVIRONMENT}"
  export ARTIFACT_REGISTRY_REPOSITORY="${ARTIFACT_REGISTRY_REPOSITORY:-synapse-${ENVIRONMENT}}"

  case "${ENVIRONMENT}" in
    staging)
      export PROJECT_ID="${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-${CLOUDSDK_CORE_PROJECT:-}}}"
      export CLOUD_SQL_INSTANCE="${CLOUD_SQL_INSTANCE:-synapse-staging-postgres}"
      export CLOUD_SQL_DATABASE="${CLOUD_SQL_DATABASE:-synapse_gateway_staging}"
      export ADMIN_CLOUD_SQL_DATABASE="${ADMIN_CLOUD_SQL_DATABASE:-synapse_gateway_admin_staging}"
      export GATEWAY_HOST="${GATEWAY_HOST:-api-staging.synapse-network.ai}"
      export ADMIN_FRONT_HOST="${ADMIN_FRONT_HOST:-admin-staging.synapse-network.ai}"
      export ADMIN_API_HOST="${ADMIN_API_HOST:-admin-api-staging.synapse-network.ai}"
      export DOCS_HOST="${DOCS_HOST:-docs-staging.synapse-network.ai}"
      export USER_FRONT_HOST="${USER_FRONT_HOST:-staging.synapse-network.ai}"
      export TX_EXPLORER_BASE_URL="${TX_EXPLORER_BASE_URL:-https://sepolia.arbiscan.io}"
      export PUBLIC_RPC_URL="${PUBLIC_RPC_URL:-https://sepolia-rollup.arbitrum.io/rpc}"
      export USER_FRONT_CONTRACT_CONFIG_SOURCE="${USER_FRONT_CONTRACT_CONFIG_SOURCE:-src/contract-config.arbitrum-sepolia.example.json}"
      export RPC_SECRET_ID="${RPC_SECRET_ID:-synapse-staging-arbitrum-sepolia-rpc-url}"
      ;;
    prod)
      export PROJECT_ID="${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-${CLOUDSDK_CORE_PROJECT:-}}}"
      export CLOUD_SQL_INSTANCE="${CLOUD_SQL_INSTANCE:-synapse-prod-postgres}"
      export CLOUD_SQL_DATABASE="${CLOUD_SQL_DATABASE:-synapse_gateway_prod}"
      export ADMIN_CLOUD_SQL_DATABASE="${ADMIN_CLOUD_SQL_DATABASE:-synapse_gateway_admin_prod}"
      export GATEWAY_HOST="${GATEWAY_HOST:-api.synapse-network.ai}"
      export ADMIN_FRONT_HOST="${ADMIN_FRONT_HOST:-admin.synapse-network.ai}"
      export ADMIN_API_HOST="${ADMIN_API_HOST:-admin-api.synapse-network.ai}"
      export DOCS_HOST="${DOCS_HOST:-docs.synapse-network.ai}"
      export USER_FRONT_HOST="${USER_FRONT_HOST:-www.synapse-network.ai}"
      export TX_EXPLORER_BASE_URL="${TX_EXPLORER_BASE_URL:-https://arbiscan.io}"
      export PUBLIC_RPC_URL="${PUBLIC_RPC_URL:-https://arb1.arbitrum.io/rpc}"
      export USER_FRONT_CONTRACT_CONFIG_SOURCE="${USER_FRONT_CONTRACT_CONFIG_SOURCE:-src/contract-config.arbitrum-one.prod.json}"
      export RPC_SECRET_ID="${RPC_SECRET_ID:-synapse-prod-arbitrum-one-rpc-url}"
      ;;
  esac
}

synapse_required_gcp_apis() {
  cat <<'EOF'
run.googleapis.com
sqladmin.googleapis.com
cloudscheduler.googleapis.com
secretmanager.googleapis.com
artifactregistry.googleapis.com
cloudresourcemanager.googleapis.com
iam.googleapis.com
logging.googleapis.com
monitoring.googleapis.com
storage.googleapis.com
cloudkms.googleapis.com
vpcaccess.googleapis.com
servicenetworking.googleapis.com
EOF
}

synapse_cloud_run_secret_ids() {
  case "${ENVIRONMENT}" in
    staging)
      cat <<'EOF'
synapse-staging-postgres-dsn
synapse-staging-postgres-password
synapse-staging-jwt-secret
synapse-staging-auth-secret
synapse-staging-metrics-bearer-token
synapse-staging-gateway-internal-jwt-secret
synapse-staging-arbitrum-sepolia-rpc-url
synapse-staging-gmail-username
synapse-staging-gmail-app-password
synapse-staging-alert-drill-token
synapse-staging-postgres-migrator-password
synapse-staging-admin-csrf-secret
synapse-staging-admin-database-dsn
synapse-staging-admin-database-migration-dsn
synapse-staging-admin-totp-secret-encryption-key
synapse-staging-gateway-readonly-dsn
synapse-staging-gateway-forum-write-dsn
synapse-staging-gateway-admin-wallet
synapse-staging-gcp-alert-receiver-token
synapse-staging-lark-webhook-staging-drill
synapse-staging-lark-secret-staging-drill
synapse-staging-lark-webhook-p0
synapse-staging-lark-secret-p0
synapse-staging-lark-webhook-prod-alerts
synapse-staging-lark-secret-prod-alerts
EOF
      ;;
    prod)
      cat <<'EOF'
synapse-prod-postgres-dsn
synapse-prod-postgres-password
synapse-prod-postgres-migrator-password
synapse-prod-jwt-secret
synapse-prod-auth-secret
synapse-prod-metrics-bearer-token
synapse-prod-gateway-internal-jwt-secret
synapse-prod-arbitrum-one-rpc-url
synapse-prod-gmail-username
synapse-prod-gmail-app-password
synapse-prod-admin-csrf-secret
synapse-prod-admin-database-dsn
synapse-prod-admin-database-migration-dsn
synapse-prod-admin-totp-secret-encryption-key
synapse-prod-gateway-readonly-dsn
synapse-prod-gateway-forum-write-dsn
synapse-prod-gateway-admin-wallet
synapse-prod-gcp-alert-receiver-token
synapse-prod-lark-webhook-p0
synapse-prod-lark-secret-p0
synapse-prod-lark-webhook-prod-alerts
synapse-prod-lark-secret-prod-alerts
EOF
      ;;
  esac
}
