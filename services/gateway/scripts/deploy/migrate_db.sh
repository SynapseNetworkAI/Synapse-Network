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
  staging MIGRATION_DSN | STAGING_POSTGRES_MIGRATOR_DSN | POSTGRES_MIGRATOR_DSN | POSTGRES_DSN
  prod    MIGRATION_DSN | PROD_POSTGRES_MIGRATOR_DSN | POSTGRES_MIGRATOR_DSN | POSTGRES_DSN

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
    MIGRATION_CONNINFO="${MIGRATION_DSN:-${LOCAL_POSTGRES_MIGRATOR_DSN:-${POSTGRES_MIGRATOR_DSN:-${POSTGRES_DSN:-postgresql://synapse:local-dev-postgres-password@localhost:5432/synapse_gateway}}}}"
    if ! is_local_dsn "${MIGRATION_CONNINFO}"; then
      echo "refusing local migration against non-local DSN" >&2
      echo "Agent fix: local migrations must target localhost/127.0.0.1/0.0.0.0." >&2
      exit 2
    fi
    ;;
  staging)
    MIGRATION_CONNINFO="${MIGRATION_DSN:-${STAGING_POSTGRES_MIGRATOR_DSN:-${POSTGRES_MIGRATOR_DSN:-${POSTGRES_DSN:-}}}}"
    if [[ -z "${MIGRATION_CONNINFO}" ]]; then
      MIGRATION_CONNINFO="$(build_conninfo_from_split_fields || true)"
    fi
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
    MIGRATION_CONNINFO="${MIGRATION_DSN:-${PROD_POSTGRES_MIGRATOR_DSN:-${POSTGRES_MIGRATOR_DSN:-${POSTGRES_DSN:-}}}}"
    if [[ -z "${MIGRATION_CONNINFO}" ]]; then
      MIGRATION_CONNINFO="$(build_conninfo_from_split_fields || true)"
    fi
    require_non_empty_dsn
    echo "PROD detected: schema/reference migration only; test seed skipped."
    ;;
esac

require_cmd psql
PYTHON_BIN="${GATEWAY_PYTHON:-python3}"
require_cmd "${PYTHON_BIN}"

echo "[migrate-db] environment=${ENVIRONMENT}"
echo "[migrate-db] schema=${SCHEMA_SQL}"
echo "[migrate-db] applying gateway target-state schema"
psql "${MIGRATION_CONNINFO}" -X -v ON_ERROR_STOP=1 -f "${SCHEMA_SQL}" >/dev/null

APP_DB_USER="${POSTGRES_APP_USER:-${POSTGRES_RUNTIME_USER:-${POSTGRES_USER:-}}}"
MIGRATOR_DB_USER="${POSTGRES_MIGRATOR_USER:-}"
if [[ -n "${APP_DB_USER}" && "${APP_DB_USER}" != "${MIGRATOR_DB_USER}" ]]; then
  echo "[migrate-db] granting runtime privileges to app user ${APP_DB_USER}"
  psql "${MIGRATION_CONNINFO}" -X -v ON_ERROR_STOP=1 --set=app_user="${APP_DB_USER}" <<'SQL' >/dev/null
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_user') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', :'app_user') \gexec
SELECT format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %I', :'app_user') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'app_user') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I', :'app_user') \gexec
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

from src.storage.postgres_impl import PostgresStorage

storage = PostgresStorage(os.environ["POSTGRES_DSN"], ensure_schema=True)
print("schema contract validation passed")
PY
)

echo "[migrate-db] ok"
