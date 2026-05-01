#!/usr/bin/env bash

if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CONFIRM_VALUE="I_UNDERSTAND_THIS_MUTATES_LOCAL_DB"

if [[ "${LOCAL_DEV_CLEANUP_CONFIRM:-}" != "${CONFIRM_VALUE}" ]]; then
  echo "Refusing to mutate local service registry."
  echo "Set LOCAL_DEV_CLEANUP_CONFIRM=${CONFIRM_VALUE} to soft-archive local E2E services."
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql is required."
  exit 1
fi

DEFAULT_LOCAL_POSTGRES_DSN="postgresql://synapse:local-dev-postgres-password@127.0.0.1:5432/synapse_gateway"
ENV_FILE="${ROOT_DIR}/services/gateway/.env.local"
if [[ -n "${LOCAL_GATEWAY_POSTGRES_DSN:-}" ]]; then
  POSTGRES_DSN="${LOCAL_GATEWAY_POSTGRES_DSN}"
elif [[ -f "${ENV_FILE}" ]]; then
  POSTGRES_DSN="$(grep -m1 '^POSTGRES_DSN=' "${ENV_FILE}" | cut -d= -f2-)"
  POSTGRES_DSN="${POSTGRES_DSN:-${DEFAULT_LOCAL_POSTGRES_DSN}}"
else
  POSTGRES_DSN="${DEFAULT_LOCAL_POSTGRES_DSN}"
fi
POSTGRES_DSN="$(printf '%s' "${POSTGRES_DSN}" | sed 's/@postgres:/@127.0.0.1:/')"

case "${POSTGRES_DSN}" in
  *127.0.0.1*|*localhost*) ;;
  *)
    echo "Error: cleanup only runs against localhost/127.0.0.1 DSNs."
    exit 1
    ;;
esac

db_name="$(psql "${POSTGRES_DSN}" -X -q -t -A -v ON_ERROR_STOP=1 -c "SELECT current_database()" 2>/dev/null || true)"
if [[ "${db_name}" != "synapse_gateway" ]]; then
  echo "Error: cleanup only runs against local synapse_gateway; got '${db_name:-unknown}'."
  exit 1
fi

where_clause="
  status = 'active'
  AND (
    service_id LIKE 'api_ref_%'
    OR service_id LIKE 'apiref_test_%'
    OR service_id LIKE 'provider_onboard_%'
    OR service_id LIKE 'llm_%_llm_deepseek_%'
    OR service_id LIKE 'gateway_pull_health_%'
  )
  AND service_id NOT IN (
    'svc_web3_sentiment_index',
    'svc_protocol_fundamental_brief',
    'svc_oss_security_healthcheck',
    'svc_deepseek_chat'
  )
"

before_count="$(psql "${POSTGRES_DSN}" -X -q -t -A -v ON_ERROR_STOP=1 \
  -c "SELECT COUNT(*) FROM synapse_service_manifests WHERE ${where_clause}")"

psql "${POSTGRES_DSN}" -X -q -v ON_ERROR_STOP=1 <<SQL
UPDATE synapse_service_manifests
SET status = 'archived', updated_at = NOW()
WHERE ${where_clause};
SQL

after_active="$(psql "${POSTGRES_DSN}" -X -q -t -A -v ON_ERROR_STOP=1 \
  -c "SELECT COUNT(*) FROM synapse_service_manifests WHERE ${where_clause}")"
canonical_active="$(psql "${POSTGRES_DSN}" -X -q -t -A -v ON_ERROR_STOP=1 \
  -c "SELECT COUNT(*) FROM synapse_service_manifests WHERE status = 'active' AND service_id IN ('svc_web3_sentiment_index','svc_protocol_fundamental_brief','svc_oss_security_healthcheck','svc_deepseek_chat')")"

echo "Soft-archived local E2E services: ${before_count}"
echo "Remaining active matching E2E services: ${after_active}"
echo "Canonical active services preserved: ${canonical_active}"
