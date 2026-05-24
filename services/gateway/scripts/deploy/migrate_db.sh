#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-}"
SERVICE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPO_ROOT="$(cd "${SERVICE_ROOT}/../.." 2>/dev/null && pwd || true)"
CANONICAL_SCHEMA="${REPO_ROOT}/infra/postgres/init/gateway/001_synapse_schema.sql"
PACKAGED_SCHEMA="${SERVICE_ROOT}/migrations/postgres/001_synapse_schema.sql"
SCHEMA_SQL="${CANONICAL_SCHEMA}"

if [[ ! -f "${SCHEMA_SQL}" ]]; then
  SCHEMA_SQL="${PACKAGED_SCHEMA}"
fi

usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/deploy/migrate_db.sh local|staging|prod

DSN selection:
  local   MIGRATION_DSN | LOCAL_POSTGRES_MIGRATOR_DSN | POSTGRES_MIGRATOR_DSN | POSTGRES_DSN | local default
  staging MIGRATION_DSN | STAGING_POSTGRES_MIGRATOR_DSN | POSTGRES_MIGRATOR_DSN | split POSTGRES_MIGRATOR_* fields | POSTGRES_DSN
  prod    MIGRATION_DSN | PROD_POSTGRES_MIGRATOR_DSN | POSTGRES_MIGRATOR_DSN | split POSTGRES_MIGRATOR_* fields | POSTGRES_DSN

Prod requires:
  SYNAPSE_MIGRATION_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PROD

This runner applies schema/reference migrations only. Test, demo, dogfood, and
evidence seed data must be executed by explicit seed scripts with their own
environment guards.
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

is_local_dsn() {
  [[ "$1" =~ localhost|127\.0\.0\.1|0\.0\.0\.0 ]]
}

require_non_empty_dsn() {
  if [[ -z "${MIGRATION_CONNINFO:-}" ]]; then
    echo "missing migration DSN for ${ENVIRONMENT}" >&2
    echo "Agent fix: set MIGRATION_DSN, an environment-specific migrator DSN, or split POSTGRES_* migrator fields." >&2
    exit 2
  fi
}

run_schema_owner_preflight() {
  local app_user="${POSTGRES_APP_USER:-${POSTGRES_RUNTIME_USER:-${POSTGRES_USER:-}}}"
  local migrator_user="${POSTGRES_MIGRATOR_USER:-}"
  if [[ -z "${app_user}" || -z "${migrator_user}" || "${app_user}" == "${migrator_user}" ]]; then
    return 0
  fi

  local mismatched_count
  mismatched_count="$(
    psql "${MIGRATION_CONNINFO}" -X -v ON_ERROR_STOP=1 -q -t -A \
      --set=migrator_user="${migrator_user}" <<'SQL'
SELECT COUNT(*)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
  AND c.relname LIKE 'synapse_%'
  AND pg_get_userbyid(c.relowner) <> :'migrator_user';
SQL
  )"
  mismatched_count="$(printf '%s' "${mismatched_count}" | tr -d '[:space:]')"
  if [[ "${mismatched_count}" != "0" ]]; then
    echo "FATAL: ${mismatched_count} existing Synapse schema objects are not owned by migrator user ${migrator_user}." >&2
    echo "Why dangerous: runtime-owned tables make future migrations fail or appear empty to least-privilege operators." >&2
    echo "Agent fix: repair object ownership to ${migrator_user}, grant runtime privileges back to ${app_user}, then rerun this migration." >&2
    exit 2
  fi
}

validate_gateway_schema_guardrails() {
  local app_user="${POSTGRES_APP_USER:-${POSTGRES_RUNTIME_USER:-${POSTGRES_USER:-}}}"
  local migrator_user="${POSTGRES_MIGRATOR_USER:-}"
  local readonly_user="${POSTGRES_READONLY_USER:-${GATEWAY_READONLY_DB_USER:-synapse_gateway_ro}}"
  local table_count
  local missing_required
  local owner_mismatch_count

  table_count="$(
    psql "${MIGRATION_CONNINFO}" -X -v ON_ERROR_STOP=1 -q -t -A <<'SQL'
SELECT COUNT(*)
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'synapse_%';
SQL
  )"
  table_count="$(printf '%s' "${table_count}" | tr -d '[:space:]')"
  if [[ -z "${table_count}" || "${table_count}" -lt 40 ]]; then
    echo "FATAL: Gateway schema guard failed: expected at least 40 synapse_* tables, found ${table_count:-0}." >&2
    exit 2
  fi

  missing_required="$(
    psql "${MIGRATION_CONNINFO}" -X -v ON_ERROR_STOP=1 -q -t -A <<'SQL'
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
  missing_required="$(printf '%s' "${missing_required}" | xargs)"
  if [[ -n "${missing_required}" ]]; then
    echo "FATAL: Gateway schema guard failed: missing required tables ${missing_required}." >&2
    exit 2
  fi

  if [[ -n "${migrator_user}" ]]; then
    owner_mismatch_count="$(
      psql "${MIGRATION_CONNINFO}" -X -v ON_ERROR_STOP=1 -q -t -A \
        --set=migrator_user="${migrator_user}" <<'SQL'
SELECT COUNT(*)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
  AND c.relname LIKE 'synapse_%'
  AND pg_get_userbyid(c.relowner) <> :'migrator_user';
SQL
    )"
    owner_mismatch_count="$(printf '%s' "${owner_mismatch_count}" | tr -d '[:space:]')"
    if [[ "${owner_mismatch_count}" != "0" ]]; then
      echo "FATAL: Gateway schema guard failed: ${owner_mismatch_count} synapse_* objects are not owned by migrator ${migrator_user}." >&2
      exit 2
    fi
  fi

  if [[ -n "${app_user}" ]]; then
    local app_can_select
    local app_can_insert
    app_can_select="$(
      psql "${MIGRATION_CONNINFO}" -X -v ON_ERROR_STOP=1 -q -t -A \
        --set=app_user="${app_user}" <<'SQL'
SELECT has_table_privilege(:'app_user', 'public.synapse_owner_accounts', 'SELECT');
SQL
    )"
    app_can_insert="$(
      psql "${MIGRATION_CONNINFO}" -X -v ON_ERROR_STOP=1 -q -t -A \
        --set=app_user="${app_user}" <<'SQL'
SELECT has_table_privilege(:'app_user', 'public.synapse_invocations', 'INSERT');
SQL
    )"
    app_can_select="$(printf '%s' "${app_can_select}" | tr -d '[:space:]')"
    app_can_insert="$(printf '%s' "${app_can_insert}" | tr -d '[:space:]')"
    if [[ "${app_can_select}" != "t" || "${app_can_insert}" != "t" ]]; then
      echo "FATAL: Gateway schema guard failed: runtime app user ${app_user} lacks required table privileges." >&2
      echo "Details: synapse_owner_accounts SELECT=${app_can_select}; synapse_invocations INSERT=${app_can_insert}" >&2
      exit 2
    fi
  fi

  if [[ -n "${readonly_user}" ]]; then
    local readonly_can_select_analytics
    readonly_can_select_analytics="$(
      psql "${MIGRATION_CONNINFO}" -X -v ON_ERROR_STOP=1 -q -t -A \
        --set=readonly_user="${readonly_user}" <<'SQL'
SELECT has_table_privilege(:'readonly_user', 'public.synapse_analytics_outbox', 'SELECT');
SQL
    )"
    readonly_can_select_analytics="$(printf '%s' "${readonly_can_select_analytics}" | tr -d '[:space:]')"
    if [[ "${readonly_can_select_analytics}" != "t" ]]; then
      echo "FATAL: Gateway schema guard failed: readonly user ${readonly_user} lacks SELECT on synapse_analytics_outbox." >&2
      exit 2
    fi
  fi
}

build_conninfo_from_split_fields() {
  local user_name="${POSTGRES_MIGRATOR_USER:-${POSTGRES_USER:-}}"
  local password="${POSTGRES_MIGRATOR_PASSWORD:-${POSTGRES_PASSWORD:-}}"
  local host="${POSTGRES_HOST:-}"
  local port="${POSTGRES_PORT:-5432}"
  local db_name="${POSTGRES_DB:-${POSTGRES_DATABASE:-}}"
  local timeout="${POSTGRES_CONNECT_TIMEOUT_SEC:-5}"
  if [[ -z "${user_name}" || -z "${password}" || -z "${host}" || -z "${db_name}" ]]; then
    return 1
  fi
  printf 'host=%s port=%s dbname=%s user=%s password=%s connect_timeout=%s' \
    "${host}" "${port}" "${db_name}" "${user_name}" "${password}" "${timeout}"
}

select_remote_migration_conninfo() {
  local environment_migrator_dsn="${1:-}"
  MIGRATION_CONNINFO="${MIGRATION_DSN:-${environment_migrator_dsn:-${POSTGRES_MIGRATOR_DSN:-}}}"
  if [[ -z "${MIGRATION_CONNINFO}" ]]; then
    MIGRATION_CONNINFO="$(build_conninfo_from_split_fields || true)"
  fi
  if [[ -z "${MIGRATION_CONNINFO}" ]]; then
    MIGRATION_CONNINFO="${POSTGRES_DSN:-}"
  fi
}

if [[ ! "${ENVIRONMENT}" =~ ^(local|staging|prod)$ ]]; then
  usage
  exit 2
fi

if [[ ! -f "${SCHEMA_SQL}" ]]; then
  echo "gateway schema SQL not found. Checked:" >&2
  echo "  - ${CANONICAL_SCHEMA}" >&2
  echo "  - ${PACKAGED_SCHEMA}" >&2
  exit 1
fi

case "${ENVIRONMENT}" in
  local)
    MIGRATION_CONNINFO="${MIGRATION_DSN:-${LOCAL_POSTGRES_MIGRATOR_DSN:-${POSTGRES_MIGRATOR_DSN:-${POSTGRES_DSN:-postgresql://synapse:local-dev-postgres-password@127.0.0.1:15432/synapse_gateway}}}}"
    if ! is_local_dsn "${MIGRATION_CONNINFO}"; then
      echo "refusing local migration against non-local DSN" >&2
      echo "Agent fix: local migrations must target localhost/127.0.0.1/0.0.0.0." >&2
      exit 2
    fi
    ;;
  staging)
    select_remote_migration_conninfo "${STAGING_POSTGRES_MIGRATOR_DSN:-}"
    require_non_empty_dsn
    if [[ "${MIGRATION_CONNINFO}" =~ prod|production ]]; then
      echo "refusing staging migration because DSN looks production-like" >&2
      exit 2
    fi
    ;;
  prod)
    if [[ "${SYNAPSE_MIGRATION_CONFIRM:-}" != "I_UNDERSTAND_THIS_CHANGES_PROD" ]]; then
      echo "refusing prod migration without SYNAPSE_MIGRATION_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PROD" >&2
      exit 2
    fi
    select_remote_migration_conninfo "${PROD_POSTGRES_MIGRATOR_DSN:-}"
    require_non_empty_dsn
    echo "PROD detected: schema/reference migration only; test seed skipped."
    ;;
esac

require_cmd psql
DEFAULT_GATEWAY_PYTHON="${SERVICE_ROOT}/.venv/bin/python"
if [[ -n "${GATEWAY_PYTHON:-}" ]]; then
  PYTHON_BIN="${GATEWAY_PYTHON}"
elif [[ -x "${DEFAULT_GATEWAY_PYTHON}" ]]; then
  PYTHON_BIN="${DEFAULT_GATEWAY_PYTHON}"
else
  PYTHON_BIN="python3"
fi
require_cmd "${PYTHON_BIN}"

echo "[migrate-db] environment=${ENVIRONMENT}"
echo "[migrate-db] schema=${SCHEMA_SQL}"
echo "[migrate-db] checking existing schema ownership"
run_schema_owner_preflight
echo "[migrate-db] applying gateway target-state schema"
psql "${MIGRATION_CONNINFO}" -X -v ON_ERROR_STOP=1 -f "${SCHEMA_SQL}" >/dev/null

APP_DB_USER="${POSTGRES_APP_USER:-${POSTGRES_RUNTIME_USER:-${POSTGRES_USER:-}}}"
MIGRATOR_DB_USER="${POSTGRES_MIGRATOR_USER:-}"
READONLY_DB_USER="${POSTGRES_READONLY_USER:-${GATEWAY_READONLY_DB_USER:-synapse_gateway_ro}}"
if [[ -n "${APP_DB_USER}" && "${APP_DB_USER}" != "${MIGRATOR_DB_USER}" ]]; then
  echo "[migrate-db] granting runtime privileges to app user ${APP_DB_USER}"
  psql "${MIGRATION_CONNINFO}" -X -v ON_ERROR_STOP=1 --set=app_user="${APP_DB_USER}" <<'SQL' >/dev/null
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_user') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO %I', n.nspname, c.relname, :'app_user')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND pg_get_userbyid(c.relowner) = current_user \gexec
SELECT format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE %I.%I TO %I', n.nspname, c.relname, :'app_user')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'S'
  AND pg_get_userbyid(c.relowner) = current_user \gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'app_user') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I', :'app_user') \gexec
SQL
fi

if [[ -n "${READONLY_DB_USER}" && "${READONLY_DB_USER}" != "${MIGRATOR_DB_USER}" ]]; then
  echo "[migrate-db] granting analytics readonly privileges to readonly user ${READONLY_DB_USER}"
  psql "${MIGRATION_CONNINFO}" -X -v ON_ERROR_STOP=1 --set=readonly_user="${READONLY_DB_USER}" <<'SQL' >/dev/null
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'readonly_user') \gexec
SELECT format('GRANT SELECT ON TABLE public.synapse_analytics_outbox TO %I', :'readonly_user') \gexec
SQL
fi

echo "[migrate-db] reference data: none for gateway runtime schema"
echo "[migrate-db] validating gateway schema contract"
(
  cd "${SERVICE_ROOT}"
  POSTGRES_DSN="${MIGRATION_CONNINFO}" \
  POSTGRES_AUTO_INIT=0 \
  PYTHONPATH="${SERVICE_ROOT}" \
  "${PYTHON_BIN}" - <<'PY'
import os

postgres_dsn = os.environ["POSTGRES_DSN"]

from src.storage.postgres_impl import PostgresStorage

storage = PostgresStorage(postgres_dsn, ensure_schema=True)
try:
    print("schema contract validation passed")
finally:
    storage.close()
PY
)

echo "[migrate-db] validating gateway schema guardrails"
validate_gateway_schema_guardrails

echo "[migrate-db] ok"
