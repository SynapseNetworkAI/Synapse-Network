#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/deploy/gcp_env.sh
source "${ROOT_DIR}/scripts/deploy/gcp_env.sh"

ENVIRONMENT=""
ROTATE_POSTGRES_PASSWORD="${ROTATE_POSTGRES_PASSWORD:-false}"

DB_USER="${DB_USER:-synapse_gateway_app}"
DB_PASSWORD_SECRET_ID=""
DB_DSN_SECRET_ID=""
MIGRATOR_DB_USER="${MIGRATOR_DB_USER:-synapse_gateway_migrator}"
MIGRATOR_DB_PASSWORD_SECRET_ID=""
GATEWAY_READONLY_DB_USER="${GATEWAY_READONLY_DB_USER:-synapse_gateway_ro}"
GATEWAY_READONLY_DSN_SECRET_ID=""
GATEWAY_FORUM_WRITE_DSN_SECRET_ID=""
ADMIN_DB_USER="${ADMIN_DB_USER:-synapse_admin_app}"
ADMIN_DB_PASSWORD_SECRET_ID=""
ADMIN_DATABASE_DSN_SECRET_ID=""
ADMIN_MIGRATOR_DB_USER="${ADMIN_MIGRATOR_DB_USER:-synapse_admin_migrator}"
ADMIN_DATABASE_MIGRATION_DSN_SECRET_ID=""

declare -a REQUIRED_SECRET_IDS=()
declare -a USER_PROVIDED_SECRET_IDS=()
declare -a BOOTSTRAP_SECRET_IDS=()

CLOUD_SQL_PRIVATE_IP=""

usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/deploy/gcp_bootstrap.sh --env staging --project <gcp-project-id>
  bash scripts/deploy/gcp_bootstrap.sh --env prod --project <gcp-project-id>

Environment overrides:
  ROTATE_POSTGRES_PASSWORD     default: false
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENVIRONMENT="${2:-}"
      shift 2
      ;;
    --project)
      PROJECT_ID="${2:-}"
      shift 2
      ;;
    --region)
      REGION="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

synapse_load_gcp_env "${ENVIRONMENT}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "missing --project or PROJECT_ID" >&2
  usage
  exit 2
fi

synapse_require_cmd gcloud
synapse_require_cmd bash
synapse_require_cmd openssl
synapse_require_cmd python3

case "${ENVIRONMENT}" in
  staging)
    DB_PASSWORD_SECRET_ID="${DB_PASSWORD_SECRET_ID:-synapse-staging-postgres-password}"
    DB_DSN_SECRET_ID="${DB_DSN_SECRET_ID:-synapse-staging-postgres-dsn}"
    MIGRATOR_DB_PASSWORD_SECRET_ID="${MIGRATOR_DB_PASSWORD_SECRET_ID:-synapse-staging-postgres-migrator-password}"
    GATEWAY_READONLY_DSN_SECRET_ID="${GATEWAY_READONLY_DSN_SECRET_ID:-synapse-staging-gateway-readonly-dsn}"
    GATEWAY_FORUM_WRITE_DSN_SECRET_ID="${GATEWAY_FORUM_WRITE_DSN_SECRET_ID:-synapse-staging-gateway-forum-write-dsn}"
    ADMIN_DB_PASSWORD_SECRET_ID="${ADMIN_DB_PASSWORD_SECRET_ID:-synapse-staging-admin-postgres-password}"
    ADMIN_DATABASE_DSN_SECRET_ID="${ADMIN_DATABASE_DSN_SECRET_ID:-synapse-staging-admin-database-dsn}"
    ADMIN_DATABASE_MIGRATION_DSN_SECRET_ID="${ADMIN_DATABASE_MIGRATION_DSN_SECRET_ID:-synapse-staging-admin-database-migration-dsn}"

    REQUIRED_SECRET_IDS=(
      "synapse-staging-postgres-password"
      "synapse-staging-postgres-dsn"
      "synapse-staging-postgres-migrator-password"
      "synapse-staging-admin-postgres-password"
      "synapse-staging-admin-database-dsn"
      "synapse-staging-admin-database-migration-dsn"
      "synapse-staging-gateway-readonly-dsn"
      "synapse-staging-gateway-forum-write-dsn"
      "synapse-staging-jwt-secret"
      "synapse-staging-auth-secret"
      "synapse-staging-gateway-internal-jwt-secret"
      "synapse-staging-admin-csrf-secret"
      "synapse-staging-gmail-app-password"
      "synapse-staging-lark-webhook-p0"
      "synapse-staging-lark-webhook-prod-alerts"
      "synapse-staging-lark-webhook-staging-drill"
      "synapse-staging-lark-secret-p0"
      "synapse-staging-lark-secret-prod-alerts"
      "synapse-staging-lark-secret-staging-drill"
      "synapse-staging-gcp-alert-receiver-token"
      "synapse-staging-alert-drill-token"
      "synapse-staging-arbitrum-sepolia-rpc-url"
      "synapse-staging-arbiscan-api-key"
      "synapse-staging-deployer-private-key"
      "synapse-staging-metrics-bearer-token"
      "synapse-staging-admin-totp-secret-encryption-key"
    )
    USER_PROVIDED_SECRET_IDS=(
      "synapse-staging-jwt-secret"
      "synapse-staging-auth-secret"
      "synapse-staging-gateway-internal-jwt-secret"
      "synapse-staging-admin-csrf-secret"
      "synapse-staging-gmail-app-password"
      "synapse-staging-lark-webhook-p0"
      "synapse-staging-lark-webhook-prod-alerts"
      "synapse-staging-lark-webhook-staging-drill"
      "synapse-staging-lark-secret-p0"
      "synapse-staging-lark-secret-prod-alerts"
      "synapse-staging-lark-secret-staging-drill"
      "synapse-staging-gcp-alert-receiver-token"
      "synapse-staging-alert-drill-token"
      "synapse-staging-arbitrum-sepolia-rpc-url"
      "synapse-staging-arbiscan-api-key"
      "synapse-staging-deployer-private-key"
      "synapse-staging-metrics-bearer-token"
    )
    ;;
  prod)
    DB_PASSWORD_SECRET_ID="${DB_PASSWORD_SECRET_ID:-synapse-prod-postgres-password}"
    DB_DSN_SECRET_ID="${DB_DSN_SECRET_ID:-synapse-prod-postgres-dsn}"
    MIGRATOR_DB_PASSWORD_SECRET_ID="${MIGRATOR_DB_PASSWORD_SECRET_ID:-synapse-prod-postgres-migrator-password}"
    GATEWAY_READONLY_DSN_SECRET_ID="${GATEWAY_READONLY_DSN_SECRET_ID:-synapse-prod-gateway-readonly-dsn}"
    GATEWAY_FORUM_WRITE_DSN_SECRET_ID="${GATEWAY_FORUM_WRITE_DSN_SECRET_ID:-synapse-prod-gateway-forum-write-dsn}"
    ADMIN_DB_PASSWORD_SECRET_ID="${ADMIN_DB_PASSWORD_SECRET_ID:-synapse-prod-admin-postgres-password}"
    ADMIN_DATABASE_DSN_SECRET_ID="${ADMIN_DATABASE_DSN_SECRET_ID:-synapse-prod-admin-database-dsn}"
    ADMIN_DATABASE_MIGRATION_DSN_SECRET_ID="${ADMIN_DATABASE_MIGRATION_DSN_SECRET_ID:-synapse-prod-admin-database-migration-dsn}"

    REQUIRED_SECRET_IDS=(
      "synapse-prod-postgres-password"
      "synapse-prod-postgres-dsn"
      "synapse-prod-postgres-migrator-password"
      "synapse-prod-admin-postgres-password"
      "synapse-prod-admin-database-dsn"
      "synapse-prod-admin-database-migration-dsn"
      "synapse-prod-gateway-readonly-dsn"
      "synapse-prod-gateway-forum-write-dsn"
      "synapse-prod-jwt-secret"
      "synapse-prod-auth-secret"
      "synapse-prod-gateway-internal-jwt-secret"
      "synapse-prod-admin-csrf-secret"
      "synapse-prod-gateway-admin-wallet"
      "synapse-prod-gmail-app-password"
      "synapse-prod-gmail-username"
      "synapse-prod-lark-webhook-p0"
      "synapse-prod-lark-webhook-prod-alerts"
      "synapse-prod-lark-webhook-staging-drill"
      "synapse-prod-lark-secret-p0"
      "synapse-prod-lark-secret-prod-alerts"
      "synapse-prod-lark-secret-staging-drill"
      "synapse-prod-gcp-alert-receiver-token"
      "synapse-prod-alert-drill-token"
      "synapse-prod-arbitrum-one-rpc-url"
      "synapse-prod-arbiscan-api-key"
      "synapse-prod-metrics-bearer-token"
      "synapse-prod-admin-totp-secret-encryption-key"
    )
    USER_PROVIDED_SECRET_IDS=(
      "synapse-prod-arbitrum-one-rpc-url"
      "synapse-prod-arbiscan-api-key"
      "synapse-prod-gmail-username"
      "synapse-prod-gmail-app-password"
      "synapse-prod-lark-webhook-p0"
      "synapse-prod-lark-secret-p0"
      "synapse-prod-lark-webhook-prod-alerts"
      "synapse-prod-lark-secret-prod-alerts"
      "synapse-prod-lark-webhook-staging-drill"
      "synapse-prod-lark-secret-staging-drill"
      "synapse-prod-gateway-admin-wallet"
      "synapse-prod-alert-drill-token"
    )
    ;;
esac

BOOTSTRAP_SECRET_IDS=(
  "${DB_PASSWORD_SECRET_ID}"
  "${DB_DSN_SECRET_ID}"
  "${MIGRATOR_DB_PASSWORD_SECRET_ID}"
  "${GATEWAY_READONLY_DSN_SECRET_ID}"
  "${GATEWAY_FORUM_WRITE_DSN_SECRET_ID}"
  "${ADMIN_DB_PASSWORD_SECRET_ID}"
  "${ADMIN_DATABASE_DSN_SECRET_ID}"
  "${ADMIN_DATABASE_MIGRATION_DSN_SECRET_ID}"
)

echo "[gcp-bootstrap] env=${ENVIRONMENT}"
echo "[gcp-bootstrap] project=${PROJECT_ID}"
echo "[gcp-bootstrap] region=${REGION}"

bash "${ROOT_DIR}/scripts/deploy/gcp_preflight.sh" --env "${ENVIRONMENT}" --project "${PROJECT_ID}" --region "${REGION}"

if ! gcloud sql instances describe "${CLOUD_SQL_INSTANCE}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "Cloud SQL instance not found: ${CLOUD_SQL_INSTANCE}" >&2
  echo "Agent fix: run Terraform apply in infra/terraform/gcp-${ENVIRONMENT} first." >&2
  exit 1
fi

for database_name in "${CLOUD_SQL_DATABASE}" "${ADMIN_CLOUD_SQL_DATABASE}"; do
  if ! gcloud sql databases describe "${database_name}" \
    --instance="${CLOUD_SQL_INSTANCE}" \
    --project="${PROJECT_ID}" >/dev/null 2>&1; then
    echo "Cloud SQL database not found: ${database_name}" >&2
    echo "Agent fix: run Terraform apply in infra/terraform/gcp-${ENVIRONMENT} first." >&2
    exit 1
  fi
done

enabled_secret_version_exists() {
  local secret_id="$1"
  gcloud secrets versions list "${secret_id}" \
    --project="${PROJECT_ID}" \
    --filter='state:enabled' \
    --format='value(name)' \
    --limit=1 2>/dev/null | grep -q .
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

ensure_placeholder_exists() {
  local secret_id="$1"
  if ! gcloud secrets describe "${secret_id}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    echo "Secret Manager placeholder missing: ${secret_id}" >&2
    echo "Agent fix: run Terraform apply in infra/terraform/gcp-${ENVIRONMENT} first." >&2
    exit 1
  fi
}

write_secret_version() {
  local secret_id="$1"
  local value="$2"
  printf '%s' "${value}" | \
    gcloud secrets versions add "${secret_id}" \
      --project="${PROJECT_ID}" \
      --data-file=- >/dev/null
  echo "[gcp-bootstrap] wrote generated value to ${secret_id}"
}

ensure_secret_password_value() {
  local secret_id="$1"
  local generated_password
  generated_password="$(openssl rand -base64 32)"
  write_secret_version "${secret_id}" "${generated_password}"
  printf '%s' "${generated_password}"
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

cloud_sql_private_ip_dsn() {
  local user_name="$1"
  local raw_password="$2"
  local database_name="$3"
  local encoded_password
  encoded_password="$(printf '%s' "${raw_password}" | urlencode)"
  printf 'postgresql://%s:%s@%s:5432/%s?sslmode=disable' \
    "${user_name}" \
    "${encoded_password}" \
    "${CLOUD_SQL_PRIVATE_IP}" \
    "${database_name}"
}

build_database_dsn() {
  local user_name="$1"
  local raw_password="$2"
  local database_name="$3"
  cloud_sql_socket_dsn "${user_name}" "${raw_password}" "${database_name}"
}

extract_password_from_dsn() {
  local dsn="$1"
  python3 -c 'import sys, urllib.parse as u; print(u.unquote(u.urlsplit(sys.argv[1]).password or ""))' "${dsn}"
}

dsn_matches_expected() {
  local actual_dsn="$1"
  local expected_dsn="$2"
  [[ "${actual_dsn}" == "${expected_dsn}" ]]
}

sql_user_exists() {
  local user_name="$1"
  gcloud sql users list \
    --instance="${CLOUD_SQL_INSTANCE}" \
    --project="${PROJECT_ID}" \
    --format='value(name)' | grep -qx "${user_name}"
}

apply_sql_user_password() {
  local user_name="$1"
  local raw_password="$2"
  local rotate_password="${3:-false}"
  if sql_user_exists "${user_name}"; then
    if [[ "${rotate_password}" == "true" ]]; then
      echo "[gcp-bootstrap] rotating password for Cloud SQL user ${user_name}"
      gcloud sql users set-password "${user_name}" \
        --instance="${CLOUD_SQL_INSTANCE}" \
        --project="${PROJECT_ID}" \
        --password="${raw_password}" >/dev/null
      return
    fi
    echo "[gcp-bootstrap] password already managed for ${user_name}; skipping rotation."
    return
  fi
  echo "[gcp-bootstrap] creating Cloud SQL user ${user_name}"
  gcloud sql users create "${user_name}" \
    --instance="${CLOUD_SQL_INSTANCE}" \
    --project="${PROJECT_ID}" \
    --password="${raw_password}" >/dev/null
}

ensure_sql_user_password() {
  local user_name="$1"
  local password_secret_id="$2"
  local password_value=""
  if enabled_secret_version_exists "${password_secret_id}" && [[ "${ROTATE_POSTGRES_PASSWORD}" != "true" ]]; then
    password_value="$(secret_value "${password_secret_id}")"
  else
    password_value="$(ensure_secret_password_value "${password_secret_id}")"
  fi
  apply_sql_user_password "${user_name}" "${password_value}" "${ROTATE_POSTGRES_PASSWORD}"
}

ensure_dsn_secret_from_password_secret() {
  local user_name="$1"
  local password_secret_id="$2"
  local dsn_secret_id="$3"
  local database_name="$4"
  if ! enabled_secret_version_exists "${password_secret_id}"; then
    echo "password secret missing enabled version: ${password_secret_id}" >&2
    exit 1
  fi
  local password_value generated_dsn existing_dsn
  password_value="$(secret_value "${password_secret_id}")"
  generated_dsn="$(build_database_dsn "${user_name}" "${password_value}" "${database_name}")"
  if enabled_secret_version_exists "${dsn_secret_id}" && [[ "${ROTATE_POSTGRES_PASSWORD}" != "true" ]]; then
    existing_dsn="$(secret_value "${dsn_secret_id}")"
    if dsn_matches_expected "${existing_dsn}" "${generated_dsn}"; then
      echo "[gcp-bootstrap] ${dsn_secret_id} already matches expected Cloud SQL topology; skipping DSN rewrite."
      return
    fi
    echo "[gcp-bootstrap] ${dsn_secret_id} topology drift detected; rewriting DSN."
  fi
  write_secret_version "${dsn_secret_id}" "${generated_dsn}"
}

ensure_sql_user_password_from_dsn_secret() {
  local user_name="$1"
  local dsn_secret_id="$2"
  local database_name="$3"
  local password_value="" existing_dsn="" expected_dsn=""
  if enabled_secret_version_exists "${dsn_secret_id}" && [[ "${ROTATE_POSTGRES_PASSWORD}" != "true" ]]; then
    existing_dsn="$(secret_value "${dsn_secret_id}")"
    password_value="$(extract_password_from_dsn "${existing_dsn}")"
  else
    password_value="$(openssl rand -base64 32)"
  fi
  expected_dsn="$(build_database_dsn "${user_name}" "${password_value}" "${database_name}")"
  if [[ -z "${existing_dsn}" ]] || [[ "${ROTATE_POSTGRES_PASSWORD}" == "true" ]] || ! dsn_matches_expected "${existing_dsn}" "${expected_dsn}"; then
    if [[ -n "${existing_dsn}" && "${ROTATE_POSTGRES_PASSWORD}" != "true" ]]; then
      echo "[gcp-bootstrap] ${dsn_secret_id} topology drift detected; rewriting DSN."
    fi
    write_secret_version "${dsn_secret_id}" "${expected_dsn}"
  else
    echo "[gcp-bootstrap] ${dsn_secret_id} already matches expected Cloud SQL topology; skipping DSN rewrite."
  fi
  apply_sql_user_password "${user_name}" "${password_value}" "${ROTATE_POSTGRES_PASSWORD}"
}

for secret_id in "${REQUIRED_SECRET_IDS[@]}"; do
  ensure_placeholder_exists "${secret_id}"
done

CLOUD_SQL_PRIVATE_IP="$(
  gcloud sql instances describe "${CLOUD_SQL_INSTANCE}" \
    --project="${PROJECT_ID}" \
    --format='value(ipAddresses[0].ipAddress)'
)"

if [[ "${ENVIRONMENT}" == "prod" && -z "${CLOUD_SQL_PRIVATE_IP}" ]]; then
  echo "missing private IP for ${CLOUD_SQL_INSTANCE}" >&2
  exit 1
fi

for secret_id in "${BOOTSTRAP_SECRET_IDS[@]}"; do
  if [[ ! "${secret_id}" =~ ^${SYNAPSE_SECRET_PREFIX}- ]]; then
    echo "refusing non-${ENVIRONMENT} secret id: ${secret_id}" >&2
    exit 2
  fi
done

ensure_sql_user_password "${DB_USER}" "${DB_PASSWORD_SECRET_ID}"
ensure_sql_user_password "${MIGRATOR_DB_USER}" "${MIGRATOR_DB_PASSWORD_SECRET_ID}"
ensure_sql_user_password "${ADMIN_DB_USER}" "${ADMIN_DB_PASSWORD_SECRET_ID}"
ensure_dsn_secret_from_password_secret "${DB_USER}" "${DB_PASSWORD_SECRET_ID}" "${DB_DSN_SECRET_ID}" "${CLOUD_SQL_DATABASE}"
ensure_sql_user_password_from_dsn_secret "${ADMIN_MIGRATOR_DB_USER}" "${ADMIN_DATABASE_MIGRATION_DSN_SECRET_ID}" "${ADMIN_CLOUD_SQL_DATABASE}"
ensure_sql_user_password_from_dsn_secret "${GATEWAY_READONLY_DB_USER}" "${GATEWAY_READONLY_DSN_SECRET_ID}" "${CLOUD_SQL_DATABASE}"
ensure_dsn_secret_from_password_secret "${ADMIN_DB_USER}" "${ADMIN_DB_PASSWORD_SECRET_ID}" "${ADMIN_DATABASE_DSN_SECRET_ID}" "${ADMIN_CLOUD_SQL_DATABASE}"
ensure_dsn_secret_from_password_secret "${DB_USER}" "${DB_PASSWORD_SECRET_ID}" "${GATEWAY_FORUM_WRITE_DSN_SECRET_ID}" "${CLOUD_SQL_DATABASE}"

cat <<EOF
[gcp-bootstrap] ok

[gcp-bootstrap] Cloud SQL topology:
  - instance: ${CLOUD_SQL_INSTANCE}
  - gateway db: ${CLOUD_SQL_DATABASE}
  - gateway-admin db: ${ADMIN_CLOUD_SQL_DATABASE}
  - gateway app user: ${DB_USER}
  - gateway migrator user: ${MIGRATOR_DB_USER}
  - gateway readonly user: ${GATEWAY_READONLY_DB_USER}
  - admin app user: ${ADMIN_DB_USER}
  - admin migrator user: ${ADMIN_MIGRATOR_DB_USER}

[gcp-bootstrap] user-provided secrets still required:
EOF

for secret_id in "${USER_PROVIDED_SECRET_IDS[@]}"; do
  if enabled_secret_version_exists "${secret_id}"; then
    echo "  - ${secret_id}: configured"
  else
    echo "  - ${secret_id}: missing value"
  fi
done

cat <<EOF

Still operator-managed:
- Google Group allowlist for admin-front / gateway-admin
- prod contract addresses, Safe, Ledger signer, KMS-derived signer address
- optional raw deployer private key only if you intentionally use the fallback hot-wallet deploy path
- DNS / domain mapping / final release evidence
EOF
