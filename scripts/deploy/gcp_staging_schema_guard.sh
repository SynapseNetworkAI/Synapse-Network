#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-${CLOUDSDK_CORE_PROJECT:-fabled-archive-494108-k5}}}"
REGION="${REGION:-us-central1}"
CLOUD_SQL_INSTANCE="${CLOUD_SQL_INSTANCE:-synapse-staging-postgres}"
GATEWAY_DATABASE="${GATEWAY_DATABASE:-synapse_gateway_staging}"
ADMIN_DATABASE="${ADMIN_DATABASE:-synapse_gateway_admin_staging}"
PROXY_HOST="${STAGING_SCHEMA_GUARD_HOST:-127.0.0.1}"
PROXY_PORT="${STAGING_SCHEMA_GUARD_PORT:-15543}"
GATEWAY_APP_USER="${GATEWAY_APP_USER:-synapse_gateway_app}"
GATEWAY_MIGRATOR_USER="${GATEWAY_MIGRATOR_USER:-synapse_gateway_migrator}"
GATEWAY_READONLY_DB_USER="${GATEWAY_READONLY_DB_USER:-synapse_gateway_ro}"
ADMIN_APP_USER="${ADMIN_APP_USER:-synapse_admin_app}"
ADMIN_MIGRATOR_USER="${ADMIN_MIGRATOR_USER:-synapse_admin_migrator}"

usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/deploy/gcp_staging_schema_guard.sh [--project <id>] [--host 127.0.0.1] [--port 15543]

Purpose:
  Verifies staging Cloud SQL schema is not an empty shell after Terraform /
  bootstrap. Run this through Cloud SQL Auth Proxy.

Proxy example:
  cloud-sql-proxy fabled-archive-494108-k5:us-central1:synapse-staging-postgres --port 15543

Checks:
  - Expected staging Cloud SQL databases exist.
  - Gateway DSN and password secrets are consistent.
  - Gateway database has required synapse_* tables.
  - Gateway schema objects are owned by the migrator user.
  - Gateway runtime app user has table privileges.
  - Gateway-admin database has required admin_* tables.
  - Gateway-admin schema objects are owned by the admin migrator user.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT_ID="${2:-}"
      shift 2
      ;;
    --region)
      REGION="${2:-}"
      shift 2
      ;;
    --instance)
      CLOUD_SQL_INSTANCE="${2:-}"
      shift 2
      ;;
    --host)
      PROXY_HOST="${2:-}"
      shift 2
      ;;
    --port)
      PROXY_PORT="${2:-}"
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

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

secret_value() {
  local secret_id="$1"
  gcloud secrets versions access latest \
    --project "${PROJECT_ID}" \
    --secret "${secret_id}"
}

database_exists() {
  local database="$1"
  gcloud sql databases describe "${database}" \
    --project "${PROJECT_ID}" \
    --instance "${CLOUD_SQL_INSTANCE}" >/dev/null 2>&1
}

localize_dsn() {
  python3 - "$1" "${PROXY_HOST}" "${PROXY_PORT}" <<'PY'
import sys
import urllib.parse as p

dsn, host, port = sys.argv[1:4]
url = p.urlparse(dsn)
query = dict(p.parse_qsl(url.query, keep_blank_values=True))
query["host"] = host
query["port"] = port
print(p.urlunparse((url.scheme, url.netloc, url.path, "", p.urlencode(query), "")))
PY
}

build_gateway_migrator_dsn() {
  local password="$1"
  python3 - "${GATEWAY_MIGRATOR_USER}" "${password}" "${GATEWAY_DATABASE}" "${PROXY_HOST}" "${PROXY_PORT}" <<'PY'
import sys
import urllib.parse as p

user, password, database, host, port = sys.argv[1:6]
netloc = f"{p.quote(user)}:{p.quote(password, safe='')}@{host}:{port}"
print(p.urlunparse(("postgresql", netloc, f"/{database}", "", "connect_timeout=10", "")))
PY
}

require_cmd gcloud
require_cmd psql
require_cmd python3

if [[ -z "${PROJECT_ID}" ]]; then
  echo "missing PROJECT_ID" >&2
  usage
  exit 2
fi

if [[ ! "${CLOUD_SQL_INSTANCE}" =~ ^synapse-staging- ]]; then
  echo "refusing non-staging Cloud SQL instance: ${CLOUD_SQL_INSTANCE}" >&2
  exit 2
fi

echo "[staging-schema-guard] project=${PROJECT_ID}"
echo "[staging-schema-guard] instance=${CLOUD_SQL_INSTANCE}"
echo "[staging-schema-guard] proxy=${PROXY_HOST}:${PROXY_PORT}"

for database in postgres "${GATEWAY_DATABASE}" "${ADMIN_DATABASE}"; do
  if ! database_exists "${database}"; then
    echo "FATAL STAGING-SCHEMA-001: missing Cloud SQL database ${database}" >&2
    exit 1
  fi
  echo "[ok] database exists: ${database}"
done

gateway_dsn_raw="$(secret_value synapse-staging-postgres-dsn)"
gateway_password_secret="$(secret_value synapse-staging-postgres-password)"
gateway_migrator_password="$(secret_value synapse-staging-postgres-migrator-password)"
admin_dsn_raw="$(secret_value synapse-staging-admin-database-dsn)"
admin_migration_dsn_raw="$(secret_value synapse-staging-admin-database-migration-dsn)"
provider_dsn_raw="$(secret_value synapse-staging-provider-postgres-dsn 2>/dev/null || true)"

python3 - "${gateway_dsn_raw}" "${gateway_password_secret}" "${GATEWAY_DATABASE}" "${GATEWAY_APP_USER}" <<'PY'
import sys
import urllib.parse as p

dsn, password_secret, expected_db, expected_user = sys.argv[1:5]
url = p.urlparse(dsn)
dsn_password = p.unquote(url.password or "")
if url.username != expected_user:
    raise SystemExit(f"gateway DSN user mismatch: {url.username} != {expected_user}")
if url.path.lstrip("/") != expected_db:
    raise SystemExit(f"gateway DSN database mismatch: {url.path.lstrip('/')} != {expected_db}")
if dsn_password != password_secret:
    raise SystemExit("gateway password secret does not match gateway DSN password")
PY
echo "[ok] gateway DSN and password secret are consistent"

if [[ -n "${provider_dsn_raw}" ]]; then
  python3 - "${provider_dsn_raw}" "${GATEWAY_DATABASE}" <<'PY'
import sys
import urllib.parse as p

dsn, expected_db = sys.argv[1:3]
url = p.urlparse(dsn)
if url.path.lstrip("/") != expected_db:
    raise SystemExit(f"provider DSN database mismatch: {url.path.lstrip('/')} != {expected_db}")
PY
  echo "[ok] provider DSN targets gateway staging database"
fi

gateway_app_dsn="$(localize_dsn "${gateway_dsn_raw}")"
gateway_migrator_dsn="$(build_gateway_migrator_dsn "${gateway_migrator_password}")"
admin_app_dsn="$(localize_dsn "${admin_dsn_raw}")"
admin_migration_dsn="$(localize_dsn "${admin_migration_dsn_raw}")"

echo "[staging-schema-guard] checking gateway schema"
gateway_table_count="$(
  psql "${gateway_migrator_dsn}" -X -v ON_ERROR_STOP=1 -q -t -A <<'SQL'
SELECT COUNT(*)
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'synapse_%';
SQL
)"
gateway_table_count="$(printf '%s' "${gateway_table_count}" | tr -d '[:space:]')"
if [[ -z "${gateway_table_count}" || "${gateway_table_count}" -lt 40 ]]; then
  echo "FATAL STAGING-SCHEMA-002: gateway table count too low: ${gateway_table_count:-0}" >&2
  exit 1
fi
echo "[ok] gateway synapse_* table count: ${gateway_table_count}"

gateway_missing="$(
  psql "${gateway_migrator_dsn}" -X -v ON_ERROR_STOP=1 -q -t -A <<'SQL'
SELECT COALESCE(string_agg(required_table, ', '), '')
FROM (
  VALUES
    ('synapse_owner_accounts'),
    ('synapse_agent_credentials'),
    ('synapse_service_manifests'),
    ('synapse_invocations'),
    ('synapse_ledger_entries'),
    ('synapse_vault_deposits'),
    ('synapse_vault_withdrawals'),
    ('synapse_audit_events')
) AS required(required_table)
WHERE to_regclass(format('public.%I', required_table)) IS NULL;
SQL
)"
gateway_missing="$(printf '%s' "${gateway_missing}" | xargs)"
if [[ -n "${gateway_missing}" ]]; then
  echo "FATAL STAGING-SCHEMA-003: missing gateway required tables: ${gateway_missing}" >&2
  exit 1
fi
echo "[ok] gateway required tables exist"

gateway_owner_mismatch="$(
  psql "${gateway_migrator_dsn}" -X -v ON_ERROR_STOP=1 -q -t -A \
    --set=migrator_user="${GATEWAY_MIGRATOR_USER}" <<'SQL'
SELECT COALESCE(string_agg(c.relname || ':' || pg_get_userbyid(c.relowner), ', '), '')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
  AND c.relname LIKE 'synapse_%'
  AND pg_get_userbyid(c.relowner) <> :'migrator_user';
SQL
)"
gateway_owner_mismatch="$(printf '%s' "${gateway_owner_mismatch}" | xargs)"
if [[ -n "${gateway_owner_mismatch}" ]]; then
  echo "FATAL STAGING-SCHEMA-004: gateway objects not owned by migrator: ${gateway_owner_mismatch}" >&2
  exit 1
fi
echo "[ok] gateway schema owner is migrator"

gateway_app_privileges="$(
  psql "${gateway_migrator_dsn}" -X -v ON_ERROR_STOP=1 -q -t -A \
    --set=app_user="${GATEWAY_APP_USER}" <<'SQL'
SELECT has_table_privilege(:'app_user', 'public.synapse_owner_accounts', 'SELECT')::text
       || ',' ||
       has_table_privilege(:'app_user', 'public.synapse_invocations', 'INSERT')::text;
SQL
)"
gateway_app_privileges="$(printf '%s' "${gateway_app_privileges}" | tr -d '[:space:]')"
if [[ "${gateway_app_privileges}" != "true,true" ]]; then
  echo "FATAL STAGING-SCHEMA-005: gateway app user lacks required table privileges: ${gateway_app_privileges}" >&2
  exit 1
fi
echo "[ok] gateway app user has runtime table privileges"

gateway_readonly_privileges="$(
  psql "${gateway_migrator_dsn}" -X -v ON_ERROR_STOP=1 -q -t -A \
    --set=readonly_user="${GATEWAY_READONLY_DB_USER}" <<'SQL'
SELECT has_table_privilege(:'readonly_user', 'public.synapse_analytics_outbox', 'SELECT')::text;
SQL
)"
gateway_readonly_privileges="$(printf '%s' "${gateway_readonly_privileges}" | tr -d '[:space:]')"
if [[ "${gateway_readonly_privileges}" != "true" ]]; then
  echo "FATAL STAGING-SCHEMA-005B: gateway readonly user lacks SELECT on synapse_analytics_outbox: ${gateway_readonly_privileges}" >&2
  exit 1
fi
echo "[ok] gateway readonly user can read analytics outbox"

psql "${gateway_app_dsn}" -X -v ON_ERROR_STOP=1 \
  -c "SELECT '[ok] gateway app DSN can read owner accounts: ' || COUNT(*) FROM synapse_owner_accounts;" >/dev/null

echo "[staging-schema-guard] checking gateway-admin schema"
admin_table_count="$(
  psql "${admin_migration_dsn}" -X -v ON_ERROR_STOP=1 -q -t -A <<'SQL'
SELECT COUNT(*)
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'admin_%';
SQL
)"
admin_table_count="$(printf '%s' "${admin_table_count}" | tr -d '[:space:]')"
if [[ -z "${admin_table_count}" || "${admin_table_count}" -lt 10 ]]; then
  echo "FATAL STAGING-SCHEMA-006: admin table count too low: ${admin_table_count:-0}" >&2
  exit 1
fi
echo "[ok] admin table count: ${admin_table_count}"

admin_missing="$(
  psql "${admin_migration_dsn}" -X -v ON_ERROR_STOP=1 -q -t -A <<'SQL'
SELECT COALESCE(string_agg(required_table, ', '), '')
FROM (
  VALUES
    ('admin_users'),
    ('admin_sessions'),
    ('admin_action_audit'),
    ('admin_approvals'),
    ('admin_execution_jobs')
) AS required(required_table)
WHERE to_regclass(format('public.%I', required_table)) IS NULL;
SQL
)"
admin_missing="$(printf '%s' "${admin_missing}" | xargs)"
if [[ -n "${admin_missing}" ]]; then
  echo "FATAL STAGING-SCHEMA-007: missing admin required tables: ${admin_missing}" >&2
  exit 1
fi
echo "[ok] admin required tables exist"

admin_owner_mismatch="$(
  psql "${admin_migration_dsn}" -X -v ON_ERROR_STOP=1 -q -t -A \
    --set=migrator_user="${ADMIN_MIGRATOR_USER}" <<'SQL'
SELECT COALESCE(string_agg(c.relname || ':' || pg_get_userbyid(c.relowner), ', '), '')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
  AND c.relname LIKE 'admin_%'
  AND pg_get_userbyid(c.relowner) <> :'migrator_user';
SQL
)"
admin_owner_mismatch="$(printf '%s' "${admin_owner_mismatch}" | xargs)"
if [[ -n "${admin_owner_mismatch}" ]]; then
  echo "FATAL STAGING-SCHEMA-008: admin objects not owned by migrator: ${admin_owner_mismatch}" >&2
  exit 1
fi
echo "[ok] admin schema owner is admin migrator"

admin_app_privileges="$(
  psql "${admin_migration_dsn}" -X -v ON_ERROR_STOP=1 -q -t -A \
    --set=app_user="${ADMIN_APP_USER}" <<'SQL'
SELECT has_table_privilege(:'app_user', 'public.admin_users', 'SELECT')::text
       || ',' ||
       has_table_privilege(:'app_user', 'public.admin_action_audit', 'INSERT')::text;
SQL
)"
admin_app_privileges="$(printf '%s' "${admin_app_privileges}" | tr -d '[:space:]')"
if [[ "${admin_app_privileges}" != "true,true" ]]; then
  echo "FATAL STAGING-SCHEMA-009: admin app user lacks required table privileges: ${admin_app_privileges}" >&2
  exit 1
fi
echo "[ok] admin app user has runtime table privileges"

psql "${admin_app_dsn}" -X -v ON_ERROR_STOP=1 \
  -c "SELECT '[ok] admin app DSN can read admin users: ' || COUNT(*) FROM admin_users;" >/dev/null

echo "[staging-schema-guard] ok"
