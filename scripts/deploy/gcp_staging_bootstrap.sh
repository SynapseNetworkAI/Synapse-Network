#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-${CLOUDSDK_CORE_PROJECT:-}}}}"
REGION="${REGION:-us-central1}"
ENVIRONMENT="${ENVIRONMENT:-staging}"
CLOUD_SQL_INSTANCE="${CLOUD_SQL_INSTANCE:-synapse-staging-postgres}"
CLOUD_SQL_DATABASE="${CLOUD_SQL_DATABASE:-synapse_gateway_staging}"
DB_USER="${DB_USER:-synapse_gateway_app}"
DB_PASSWORD_SECRET_ID="${DB_PASSWORD_SECRET_ID:-synapse-staging-postgres-password}"
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

if [[ ! "${DB_PASSWORD_SECRET_ID}" =~ ^synapse-staging- ]]; then
  echo "refusing non-staging password secret id: ${DB_PASSWORD_SECRET_ID}" >&2
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

USER_EXISTS=false
if gcloud sql users list \
  --instance="${CLOUD_SQL_INSTANCE}" \
  --project="${PROJECT_ID}" \
  --format='value(name)' | grep -qx "${DB_USER}"; then
  USER_EXISTS=true
fi

PASSWORD_SECRET_HAS_VERSION=false
if enabled_secret_version_exists "${DB_PASSWORD_SECRET_ID}"; then
  PASSWORD_SECRET_HAS_VERSION=true
fi

if [[ "${USER_EXISTS}" == "true" && "${PASSWORD_SECRET_HAS_VERSION}" == "true" && "${ROTATE_POSTGRES_PASSWORD}" != "true" ]]; then
  echo "[gcp-staging-bootstrap] Cloud SQL user and password secret already exist; skipping password rotation."
  echo "[gcp-staging-bootstrap] To rotate, rerun with ROTATE_POSTGRES_PASSWORD=true."
else
  DB_PASSWORD="$(openssl rand -base64 32)"
  if [[ "${USER_EXISTS}" == "true" ]]; then
    echo "[gcp-staging-bootstrap] rotating password for Cloud SQL user ${DB_USER}"
    gcloud sql users set-password "${DB_USER}" \
      --instance="${CLOUD_SQL_INSTANCE}" \
      --project="${PROJECT_ID}" \
      --password="${DB_PASSWORD}" >/dev/null
  else
    echo "[gcp-staging-bootstrap] creating Cloud SQL user ${DB_USER}"
    gcloud sql users create "${DB_USER}" \
      --instance="${CLOUD_SQL_INSTANCE}" \
      --project="${PROJECT_ID}" \
      --password="${DB_PASSWORD}" >/dev/null
  fi

  printf '%s' "${DB_PASSWORD}" | \
    gcloud secrets versions add "${DB_PASSWORD_SECRET_ID}" \
      --project="${PROJECT_ID}" \
      --data-file=- >/dev/null
  unset DB_PASSWORD
  echo "[gcp-staging-bootstrap] wrote Cloud SQL password to ${DB_PASSWORD_SECRET_ID}"
fi

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
