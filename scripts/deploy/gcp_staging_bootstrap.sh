#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-${CLOUDSDK_CORE_PROJECT:-}}}}"
REGION="${REGION:-us-central1}"
ENVIRONMENT="${ENVIRONMENT:-staging}"
CLOUD_SQL_INSTANCE="${CLOUD_SQL_INSTANCE:-synapse-staging-postgres}"
CLOUD_SQL_DATABASE="${CLOUD_SQL_DATABASE:-synapse_gateway_staging}"
ADMIN_CLOUD_SQL_DATABASE="${ADMIN_CLOUD_SQL_DATABASE:-synapse_gateway_admin_staging}"
DB_USER="${DB_USER:-synapse_gateway_app}"
DB_PASSWORD_SECRET_ID="${DB_PASSWORD_SECRET_ID:-synapse-staging-postgres-password}"
DB_DSN_SECRET_ID="${DB_DSN_SECRET_ID:-synapse-staging-postgres-dsn}"
MIGRATOR_DB_USER="${MIGRATOR_DB_USER:-synapse_gateway_migrator}"
MIGRATOR_DB_PASSWORD_SECRET_ID="${MIGRATOR_DB_PASSWORD_SECRET_ID:-synapse-staging-postgres-migrator-password}"
GATEWAY_READONLY_DB_USER="${GATEWAY_READONLY_DB_USER:-synapse_gateway_ro}"
GATEWAY_READONLY_DSN_SECRET_ID="${GATEWAY_READONLY_DSN_SECRET_ID:-synapse-staging-gateway-readonly-dsn}"
GATEWAY_FORUM_WRITE_DSN_SECRET_ID="${GATEWAY_FORUM_WRITE_DSN_SECRET_ID:-synapse-staging-gateway-forum-write-dsn}"
ADMIN_DB_USER="${ADMIN_DB_USER:-synapse_admin_app}"
ADMIN_DB_PASSWORD_SECRET_ID="${ADMIN_DB_PASSWORD_SECRET_ID:-synapse-staging-admin-postgres-password}"
ADMIN_DATABASE_DSN_SECRET_ID="${ADMIN_DATABASE_DSN_SECRET_ID:-synapse-staging-admin-database-dsn}"
ADMIN_MIGRATOR_DB_USER="${ADMIN_MIGRATOR_DB_USER:-synapse_admin_migrator}"
ADMIN_DATABASE_MIGRATION_DSN_SECRET_ID="${ADMIN_DATABASE_MIGRATION_DSN_SECRET_ID:-synapse-staging-admin-database-migration-dsn}"
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
  synapse-staging-postgres-dsn
  synapse-staging-postgres-migrator-password
  synapse-staging-admin-postgres-password
  synapse-staging-admin-database-dsn
  synapse-staging-admin-database-migration-dsn
  synapse-staging-gateway-readonly-dsn
  synapse-staging-gateway-forum-write-dsn
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
  synapse-staging-gcp-alert-receiver-token
  synapse-staging-alert-drill-token
  synapse-staging-arbitrum-sepolia-rpc-url
  synapse-staging-arbiscan-api-key
  synapse-staging-deployer-private-key
  synapse-staging-metrics-bearer-token
)

USER_PROVIDED_SECRET_IDS=(
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
  synapse-staging-gcp-alert-receiver-token
  synapse-staging-alert-drill-token
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
  ADMIN_CLOUD_SQL_DATABASE     default: synapse_gateway_admin_staging
  DB_USER                      default: synapse_gateway_app
  MIGRATOR_DB_USER             default: synapse_gateway_migrator
  GATEWAY_READONLY_DB_USER     default: synapse_gateway_ro
  ADMIN_DB_USER                default: synapse_admin_app
  ADMIN_MIGRATOR_DB_USER       default: synapse_admin_migrator
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

STAGING_SECRET_IDS_TO_VALIDATE=(
  "${DB_PASSWORD_SECRET_ID}"
  "${DB_DSN_SECRET_ID}"
  "${MIGRATOR_DB_PASSWORD_SECRET_ID}"
  "${GATEWAY_READONLY_DSN_SECRET_ID}"
  "${GATEWAY_FORUM_WRITE_DSN_SECRET_ID}"
  "${ADMIN_DB_PASSWORD_SECRET_ID}"
  "${ADMIN_DATABASE_DSN_SECRET_ID}"
  "${ADMIN_DATABASE_MIGRATION_DSN_SECRET_ID}"
)

for secret_id_to_validate in "${STAGING_SECRET_IDS_TO_VALIDATE[@]}"; do
  if [[ ! "${secret_id_to_validate}" =~ ^synapse-staging- ]]; then
    echo "refusing non-staging secret id: ${secret_id_to_validate}" >&2
    exit 2
  fi
done

if [[ ! "${CLOUD_SQL_DATABASE}" =~ ^synapse_.*_staging$ || ! "${ADMIN_CLOUD_SQL_DATABASE}" =~ ^synapse_.*_staging$ ]]; then
  echo "refusing non-staging database names: gateway=${CLOUD_SQL_DATABASE} admin=${ADMIN_CLOUD_SQL_DATABASE}" >&2
  exit 2
fi

if [[ "${CLOUD_SQL_DATABASE}" == "${ADMIN_CLOUD_SQL_DATABASE}" ]]; then
  echo "refusing to reuse the same database for Gateway and Gateway-admin: ${CLOUD_SQL_DATABASE}" >&2
  exit 2
fi

if [[ ! "${DB_USER}" =~ ^synapse_ || ! "${MIGRATOR_DB_USER}" =~ ^synapse_ || ! "${GATEWAY_READONLY_DB_USER}" =~ ^synapse_ || ! "${ADMIN_DB_USER}" =~ ^synapse_ || ! "${ADMIN_MIGRATOR_DB_USER}" =~ ^synapse_ ]]; then
  echo "refusing non-synapse database user name" >&2
  exit 2
fi

require_cmd gcloud
require_cmd openssl
require_cmd python3

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

billing_enabled_value="$(gcloud beta billing projects describe "${PROJECT_ID}" --format='value(billingEnabled)' 2>/dev/null || true)"
billing_enabled_value="$(printf '%s' "${billing_enabled_value}" | tr -d '[:space:]')"

case "${billing_enabled_value}" in
  true|TRUE|True)
    echo "[gcp-staging-bootstrap] billing enabled"
    ;;
  false|FALSE|False)
    echo "billing is disabled for ${PROJECT_ID}" >&2
    echo "Agent fix: attach the project to an active billing account, then retry." >&2
    exit 1
    ;;
  *)
    echo "[gcp-staging-bootstrap] WARN: unable to verify billing state via Billing API; continuing because the project is already accessible." >&2
    echo "[gcp-staging-bootstrap] WARN: if later resource creation fails, verify billing manually with:" >&2
    echo "  gcloud beta billing projects describe ${PROJECT_ID}" >&2
    ;;
esac

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

if gcloud sql databases describe "${ADMIN_CLOUD_SQL_DATABASE}" \
  --instance="${CLOUD_SQL_INSTANCE}" \
  --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "[gcp-staging-bootstrap] Cloud SQL database ${ADMIN_CLOUD_SQL_DATABASE} already exists."
else
  echo "[gcp-staging-bootstrap] creating Cloud SQL database ${ADMIN_CLOUD_SQL_DATABASE}"
  gcloud sql databases create "${ADMIN_CLOUD_SQL_DATABASE}" \
    --instance="${CLOUD_SQL_INSTANCE}" \
    --project="${PROJECT_ID}" >/dev/null
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

secret_value() {
  local secret_id="$1"
  gcloud secrets versions access latest \
    --secret="${secret_id}" \
    --project="${PROJECT_ID}" 2>/dev/null
}

urlencode() {
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read(), safe=""))'
}

cloud_sql_socket_dsn() {
  local user_name="$1"
  local raw_password="$2"
  local database_name="$3"
  local encoded_password
  encoded_password="$(printf '%s' "${raw_password}" | urlencode)"
  printf 'postgresql://%s:%s@/%s?host=/cloudsql/%s:%s:%s' \
    "${user_name}" \
    "${encoded_password}" \
    "${database_name}" \
    "${PROJECT_ID}" \
    "${REGION}" \
    "${CLOUD_SQL_INSTANCE}"
}

write_secret_version() {
  local secret_id="$1"
  local value="$2"
  printf '%s' "${value}" | \
    gcloud secrets versions add "${secret_id}" \
      --project="${PROJECT_ID}" \
      --data-file=- >/dev/null
  echo "[gcp-staging-bootstrap] wrote generated value to ${secret_id}"
}

ensure_sql_user_password_from_dsn_secret() {
  local user_name="$1"
  local dsn_secret_id="$2"
  local database_name="$3"
  local user_exists=false
  local dsn_secret_has_version=false

  if gcloud sql users list \
    --instance="${CLOUD_SQL_INSTANCE}" \
    --project="${PROJECT_ID}" \
    --format='value(name)' | grep -qx "${user_name}"; then
    user_exists=true
  fi

  if enabled_secret_version_exists "${dsn_secret_id}"; then
    dsn_secret_has_version=true
  fi

  if [[ "${user_exists}" == "true" && "${dsn_secret_has_version}" == "true" && "${ROTATE_POSTGRES_PASSWORD}" != "true" ]]; then
    echo "[gcp-staging-bootstrap] Cloud SQL user ${user_name} and ${dsn_secret_id} already exist; skipping password rotation."
    return
  fi

  local generated_password generated_dsn
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

  generated_dsn="$(cloud_sql_socket_dsn "${user_name}" "${generated_password}" "${database_name}")"
  write_secret_version "${dsn_secret_id}" "${generated_dsn}"
  unset generated_password generated_dsn
}

ensure_dsn_secret_from_password_secret() {
  local user_name="$1"
  local password_secret_id="$2"
  local dsn_secret_id="$3"
  local database_name="$4"

  if enabled_secret_version_exists "${dsn_secret_id}" && [[ "${ROTATE_POSTGRES_PASSWORD}" != "true" ]]; then
    echo "[gcp-staging-bootstrap] ${dsn_secret_id} already exists; skipping DSN rewrite."
    return
  fi

  if ! enabled_secret_version_exists "${password_secret_id}"; then
    echo "password secret missing enabled version: ${password_secret_id}" >&2
    exit 1
  fi

  local password generated_dsn
  password="$(secret_value "${password_secret_id}")"
  generated_dsn="$(cloud_sql_socket_dsn "${user_name}" "${password}" "${database_name}")"
  write_secret_version "${dsn_secret_id}" "${generated_dsn}"
  unset password generated_dsn
}

ensure_sql_user_password "${DB_USER}" "${DB_PASSWORD_SECRET_ID}"
ensure_sql_user_password "${MIGRATOR_DB_USER}" "${MIGRATOR_DB_PASSWORD_SECRET_ID}"
ensure_sql_user_password "${ADMIN_DB_USER}" "${ADMIN_DB_PASSWORD_SECRET_ID}"
ensure_dsn_secret_from_password_secret "${DB_USER}" "${DB_PASSWORD_SECRET_ID}" "${DB_DSN_SECRET_ID}" "${CLOUD_SQL_DATABASE}"
ensure_sql_user_password_from_dsn_secret "${ADMIN_MIGRATOR_DB_USER}" "${ADMIN_DATABASE_MIGRATION_DSN_SECRET_ID}" "${ADMIN_CLOUD_SQL_DATABASE}"
ensure_sql_user_password_from_dsn_secret "${GATEWAY_READONLY_DB_USER}" "${GATEWAY_READONLY_DSN_SECRET_ID}" "${CLOUD_SQL_DATABASE}"
ensure_dsn_secret_from_password_secret "${ADMIN_DB_USER}" "${ADMIN_DB_PASSWORD_SECRET_ID}" "${ADMIN_DATABASE_DSN_SECRET_ID}" "${ADMIN_CLOUD_SQL_DATABASE}"
ensure_dsn_secret_from_password_secret "${DB_USER}" "${DB_PASSWORD_SECRET_ID}" "${GATEWAY_FORUM_WRITE_DSN_SECRET_ID}" "${CLOUD_SQL_DATABASE}"

echo
echo "[gcp-staging-bootstrap] Cloud SQL staging topology:"
echo "  - instance: ${CLOUD_SQL_INSTANCE}"
echo "  - gateway db: ${CLOUD_SQL_DATABASE}"
echo "  - gateway-admin db: ${ADMIN_CLOUD_SQL_DATABASE}"
echo "  - generated users: ${DB_USER}, ${MIGRATOR_DB_USER}, ${GATEWAY_READONLY_DB_USER}, ${ADMIN_DB_USER}, ${ADMIN_MIGRATOR_DB_USER}"
echo "  - generated DSN secrets: ${DB_DSN_SECRET_ID}, ${ADMIN_DATABASE_DSN_SECRET_ID}, ${ADMIN_DATABASE_MIGRATION_DSN_SECRET_ID}, ${GATEWAY_READONLY_DSN_SECRET_ID}, ${GATEWAY_FORUM_WRITE_DSN_SECRET_ID}"
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
