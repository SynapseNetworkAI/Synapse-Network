#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-}"

usage() {
  cat >&2 <<'EOF'
Usage:
  SERVICE_HEALTH_KV_CLEANUP_CONFIRM=I_UNDERSTAND_THIS_DELETES_EPHEMERAL_HEALTH_CACHE \
    bash services/gateway/scripts/deploy/cleanup_legacy_service_health_runtime_state.sh local|staging|prod

DSN selection:
  local   MIGRATION_DSN | LOCAL_POSTGRES_MIGRATOR_DSN | POSTGRES_MIGRATOR_DSN | POSTGRES_DSN | local default
  staging MIGRATION_DSN | STAGING_POSTGRES_MIGRATOR_DSN | POSTGRES_MIGRATOR_DSN | POSTGRES_DSN
  prod    MIGRATION_DSN | PROD_POSTGRES_MIGRATOR_DSN | POSTGRES_MIGRATOR_DSN | POSTGRES_DSN
EOF
}

is_local_dsn() {
  [[ "$1" =~ localhost|127\.0\.0\.1|0\.0\.0\.0 ]]
}

if [[ ! "${ENVIRONMENT}" =~ ^(local|staging|prod)$ ]]; then
  usage
  exit 2
fi

if [[ "${SERVICE_HEALTH_KV_CLEANUP_CONFIRM:-}" != "I_UNDERSTAND_THIS_DELETES_EPHEMERAL_HEALTH_CACHE" ]]; then
  echo "refusing cleanup without SERVICE_HEALTH_KV_CLEANUP_CONFIRM=I_UNDERSTAND_THIS_DELETES_EPHEMERAL_HEALTH_CACHE" >&2
  exit 2
fi

case "${ENVIRONMENT}" in
  local)
    CONNINFO="${MIGRATION_DSN:-${LOCAL_POSTGRES_MIGRATOR_DSN:-${POSTGRES_MIGRATOR_DSN:-${POSTGRES_DSN:-postgresql://synapse:local-dev-postgres-password@127.0.0.1:15432/synapse_gateway}}}}"
    if ! is_local_dsn "${CONNINFO}"; then
      echo "refusing local cleanup against non-local DSN" >&2
      exit 2
    fi
    ;;
  staging)
    CONNINFO="${MIGRATION_DSN:-${STAGING_POSTGRES_MIGRATOR_DSN:-${POSTGRES_MIGRATOR_DSN:-${POSTGRES_DSN:-}}}}"
    if [[ -z "${CONNINFO}" ]]; then
      echo "missing staging cleanup DSN" >&2
      exit 2
    fi
    if [[ "${CONNINFO}" =~ prod|production ]]; then
      echo "refusing staging cleanup because DSN looks production-like" >&2
      exit 2
    fi
    ;;
  prod)
    if [[ "${SYNAPSE_MIGRATION_CONFIRM:-}" != "I_UNDERSTAND_THIS_CHANGES_PROD" ]]; then
      echo "refusing prod cleanup without SYNAPSE_MIGRATION_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PROD" >&2
      exit 2
    fi
    CONNINFO="${MIGRATION_DSN:-${PROD_POSTGRES_MIGRATOR_DSN:-${POSTGRES_MIGRATOR_DSN:-${POSTGRES_DSN:-}}}}"
    if [[ -z "${CONNINFO}" ]]; then
      echo "missing prod cleanup DSN" >&2
      exit 2
    fi
    ;;
esac

if ! command -v psql >/dev/null 2>&1; then
  echo "missing required command: psql" >&2
  exit 1
fi

echo "[service-health-kv-cleanup] environment=${ENVIRONMENT}"
psql "${CONNINFO}" -X -v ON_ERROR_STOP=1 <<'SQL'
WITH before_count AS (
  SELECT COUNT(*)::BIGINT AS value
  FROM synapse_runtime_state
  WHERE state_key LIKE 'service_health_%'
),
deleted AS (
  DELETE FROM synapse_runtime_state
  WHERE state_key LIKE 'service_health_%'
  RETURNING 1
)
SELECT before_count.value AS before_rows, COUNT(deleted.*)::BIGINT AS deleted_rows
FROM before_count
LEFT JOIN deleted ON TRUE
GROUP BY before_count.value;
SQL
