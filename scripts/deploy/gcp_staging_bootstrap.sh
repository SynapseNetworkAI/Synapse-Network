#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-${CLOUDSDK_CORE_PROJECT:-}}}}"
REGION="${REGION:-us-central1}"
ENVIRONMENT="${ENVIRONMENT:-staging}"
CLOUD_SQL_INSTANCE="${CLOUD_SQL_INSTANCE:-synapse-staging-postgres}"
CLOUD_SQL_DATABASE="${CLOUD_SQL_DATABASE:-synapse_gateway_staging}"
DB_USER="${DB_USER:-synapse_gateway_app}"
DB_PASSWORD_SECRET_ID="${DB_PASSWORD_SECRET_ID:-synapse-staging-postgres-password}"
MIGRATOR_DB_USER="${MIGRATOR_DB_USER:-synapse_gateway_migrator}"
MIGRATOR_DB_PASSWORD_SECRET_ID="${MIGRATOR_DB_PASSWORD_SECRET_ID:-synapse-staging-postgres-migrator-password}"
ROTATE_POSTGRES_PASSWORD="${ROTATE_POSTGRES_PASSWORD:-false}"

REQUIRED_APIS=(
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
)

REQUIRED_SECRET_IDS=(
  synapse-staging-postgres-password
  synapse-staging-postgres-migrator-password
  synapse-staging-admin-postgres-password
  synapse-staging-jwt-secret
  synapse-staging-auth-secret
  synapse-staging-private-key
  synapse-staging-gateway-internal-jwt-secret
  synapse-staging-admin-csrf-secret
  synapse-staging-gateway-admin-wallet
  synapse-staging-gmail-app-password
  synapse-staging-gmail-username
  synapse-staging-lark-webhook-p0
  synapse-staging-lark-webhook-prod-alerts
  synapse-staging-lark-webhook-staging-drill
  synapse-staging-lark-secret-p0
  synapse-staging-lark-secret-prod-alerts
  synapse-staging-lark-secret-staging-drill
  synapse-staging-arbitrum-sepolia-rpc-url
  synapse-staging-arbiscan-api-key
  synapse-staging-deployer-private-key
  synapse-staging-metrics-bearer-token
)

USER_PROVIDED_SECRET_IDS=(
  synapse-staging-admin-postgres-password
  synapse-staging-jwt-secret
  synapse-staging-auth-secret
  synapse-staging-private-key
  synapse-staging-gateway-internal-jwt-secret
  synapse-staging-admin-csrf-secret
  synapse-staging-gateway-admin-wallet
  synapse-staging-gmail-app-password
  synapse-staging-gmail-username
  synapse-staging-lark-webhook-p0
  synapse-staging-lark-webhook-prod-alerts
  synapse-staging-lark-webhook-staging-drill
  synapse-staging-lark-secret-p0
  synapse-staging-lark-secret-prod-alerts
  synapse-staging-lark-secret-staging-drill
  synapse-staging-arbitrum-sepolia-rpc-url
  synapse-staging-arbiscan-api-key
  synapse-staging-deployer-private-key
  synapse-staging-metrics-bearer-token
)

usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/deploy/gcp_staging_bootstrap.sh <gcp-project-id>

Environment overrides:
  REGION                       default: us-central1
  CLOUD_SQL_INSTANCE           default: synapse-staging-postgres
  CLOUD_SQL_DATABASE           default: synapse_gateway_staging
  DB_USER                      default: synapse_gateway_app
  MIGRATOR_DB_USER             default: synapse_gateway_migrator
  ROTATE_POSTGRES_PASSWORD     default: false

This script does not enable or use Cloud KMS / CMEK.
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

enabled_secret_version_exists() {
  local secret_id="$1"
  gcloud secrets versions list "${secret_id}" \
    --project="${PROJECT_ID}" \
    --filter='state:enabled' \
    --format='value(name)' \
    --limit=1 2>/dev/null | grep -q .
}

if [[ -z "${PROJECT_ID}" ]]; then
  usage
  exit 2
fi

if [[ "${ENVIRONMENT}" != "staging" ]]; then
  echo "refusing to bootstrap non-staging environment: ${ENVIRONMENT}" >&2
  exit 2
fi

if [[ ! "${CLOUD_SQL_INSTANCE}" =~ ^synapse-staging- ]]; then
  echo "refusing non-staging Cloud SQL instance: ${CLOUD_SQL_INSTANCE}" >&2
  exit 2
fi

if [[ ! "${DB_PASSWORD_SECRET_ID}" =~ ^synapse-staging- || ! "${MIGRATOR_DB_PASSWORD_SECRET_ID}" =~ ^synapse-staging- ]]; then
  echo "refusing non-staging password secret id" >&2
  exit 2
fi

require_cmd gcloud
require_cmd openssl

ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n1 || true)"
if [[ -z "${ACTIVE_ACCOUNT}" ]]; then
  echo "no active gcloud account. Run: gcloud auth login" >&2
  exit 1
fi

ACTIVE_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
if [[ "${ACTIVE_PROJECT}" != "${PROJECT_ID}" ]]; then
  echo "active gcloud project mismatch: active=${ACTIVE_PROJECT:-<unset>} expected=${PROJECT_ID}" >&2
  echo "Agent fix: run gcloud config set project ${PROJECT_ID}, then retry." >&2
  exit 2
fi

echo "[gcp-staging-bootstrap] project=${PROJECT_ID}"
echo "[gcp-staging-bootstrap] account=${ACTIVE_ACCOUNT}"

if ! gcloud projects describe "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "project not accessible: ${PROJECT_ID}" >&2
  exit 1
fi

if ! gcloud beta billing projects describe "${PROJECT_ID}" --format='value(billingEnabled)' 2>/dev/null | grep -qi true; then
  echo "billing is not enabled or billing API access is missing for ${PROJECT_ID}" >&2
  exit 1
fi

for api in "${REQUIRED_APIS[@]}"; do
  if ! gcloud services list --enabled --project="${PROJECT_ID}" --filter="config.name:${api}" --format='value(config.name)' | grep -qx "${api}"; then
    echo "[gcp-staging-bootstrap] enabling ${api}"
    gcloud services enable "${api}" --project="${PROJECT_ID}"
  else
    echo "[gcp-staging-bootstrap] enabled ${api}"
  fi
done

if ! gcloud sql instances describe "${CLOUD_SQL_INSTANCE}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "Cloud SQL instance not found: ${CLOUD_SQL_INSTANCE}" >&2
  echo "Agent fix: run Terraform apply in infra/terraform/gcp-staging first." >&2
  exit 1
fi

if ! gcloud sql databases describe "${CLOUD_SQL_DATABASE}" \
  --instance="${CLOUD_SQL_INSTANCE}" \
  --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "Cloud SQL database not found: ${CLOUD_SQL_DATABASE}" >&2
  echo "Agent fix: run Terraform apply in infra/terraform/gcp-staging first." >&2
  exit 1
fi

for secret_id in "${REQUIRED_SECRET_IDS[@]}"; do
  if ! gcloud secrets describe "${secret_id}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    echo "Secret Manager placeholder missing: ${secret_id}" >&2
    echo "Agent fix: run Terraform apply in infra/terraform/gcp-staging first." >&2
    exit 1
  fi
done

ensure_sql_user_password() {
  local user_name="$1"
  local password_secret_id="$2"
  local user_exists=false
  local password_secret_has_version=false

  if gcloud sql users list \
    --instance="${CLOUD_SQL_INSTANCE}" \
    --project="${PROJECT_ID}" \
    --format='value(name)' | grep -qx "${user_name}"; then
    user_exists=true
  fi

  if enabled_secret_version_exists "${password_secret_id}"; then
    password_secret_has_version=true
  fi

  if [[ "${user_exists}" == "true" && "${password_secret_has_version}" == "true" && "${ROTATE_POSTGRES_PASSWORD}" != "true" ]]; then
    echo "[gcp-staging-bootstrap] Cloud SQL user ${user_name} and ${password_secret_id} already exist; skipping password rotation."
    return
  fi

  local generated_password
  generated_password="$(openssl rand -base64 32)"
  if [[ "${user_exists}" == "true" ]]; then
    echo "[gcp-staging-bootstrap] rotating password for Cloud SQL user ${user_name}"
    gcloud sql users set-password "${user_name}" \
      --instance="${CLOUD_SQL_INSTANCE}" \
      --project="${PROJECT_ID}" \
      --password="${generated_password}" >/dev/null
  else
    echo "[gcp-staging-bootstrap] creating Cloud SQL user ${user_name}"
    gcloud sql users create "${user_name}" \
      --instance="${CLOUD_SQL_INSTANCE}" \
      --project="${PROJECT_ID}" \
      --password="${generated_password}" >/dev/null
  fi

  printf '%s' "${generated_password}" | \
    gcloud secrets versions add "${password_secret_id}" \
      --project="${PROJECT_ID}" \
      --data-file=- >/dev/null
  unset generated_password
  echo "[gcp-staging-bootstrap] wrote Cloud SQL password to ${password_secret_id}"
}

ensure_sql_user_password "${DB_USER}" "${DB_PASSWORD_SECRET_ID}"
ensure_sql_user_password "${MIGRATOR_DB_USER}" "${MIGRATOR_DB_PASSWORD_SECRET_ID}"

echo
echo "[gcp-staging-bootstrap] user-provided secrets still required:"
for secret_id in "${USER_PROVIDED_SECRET_IDS[@]}"; do
  if enabled_secret_version_exists "${secret_id}"; then
    echo "  - ${secret_id}: configured"
  else
    echo "  - ${secret_id}: missing value"
  fi
done

cat <<EOF

[gcp-staging-bootstrap] next step example:
  printf '%s' '<secret-value>' | bash scripts/deploy/gcp_put_secret.sh synapse-staging-jwt-secret

[gcp-staging-bootstrap] ok
EOF
