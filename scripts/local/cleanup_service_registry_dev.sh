#!/usr/bin/env bash

if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CONFIRM_VALUE="I_UNDERSTAND_THIS_MUTATES_LOCAL_DB"
DRY_RUN="${LOCAL_DEV_CLEANUP_DRY_RUN:-0}"
OUTPUT_FORMAT="${LOCAL_DEV_CLEANUP_OUTPUT:-text}"

if [[ "${DRY_RUN}" != "1" && "${LOCAL_DEV_CLEANUP_CONFIRM:-}" != "${CONFIRM_VALUE}" ]]; then
  echo "Refusing to mutate local service registry."
  echo "Set LOCAL_DEV_CLEANUP_CONFIRM=${CONFIRM_VALUE} to soft-archive local E2E services."
  echo "For a non-mutating count, run LOCAL_DEV_CLEANUP_DRY_RUN=1 bash scripts/local/cleanup_service_registry_dev.sh"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql is required."
  exit 1
fi

LOCAL_GATEWAY_POSTGRES_PORT="${LOCAL_GATEWAY_POSTGRES_PORT:-15432}"
DEFAULT_LOCAL_POSTGRES_DSN="postgresql://synapse:local-dev-postgres-password@127.0.0.1:${LOCAL_GATEWAY_POSTGRES_PORT}/synapse_gateway"
ENV_FILE="${ROOT_DIR}/services/gateway/.env.local"

mask_dsn() {
  printf '%s' "$1" | sed -E 's#(://[^:/@]+:)[^@]+@#\1***@#'
}

if [[ -n "${LOCAL_GATEWAY_POSTGRES_DSN:-}" ]]; then
  POSTGRES_DSN="${LOCAL_GATEWAY_POSTGRES_DSN}"
else
  if [[ -n "${POSTGRES_DSN:-}" ]]; then
    echo "[local-cleanup] ignoring ambient POSTGRES_DSN for local cleanup; use LOCAL_GATEWAY_POSTGRES_DSN to override intentionally."
  fi
  if [[ -f "${ENV_FILE}" ]] && grep -q '^POSTGRES_DSN=' "${ENV_FILE}"; then
    echo "[local-cleanup] ignoring services/gateway/.env.local POSTGRES_DSN; local cleanup uses Docker Postgres by default."
  fi
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

probe_stderr="$(mktemp)"
trap 'rm -f "${probe_stderr}"' EXIT

if ! db_name="$(psql "${POSTGRES_DSN}" -X -q -t -A -v ON_ERROR_STOP=1 -c "SELECT current_database()" 2>"${probe_stderr}")"; then
  echo "Error: unable to connect to local Gateway Postgres for cleanup."
  echo "DSN: $(mask_dsn "${POSTGRES_DSN}")"
  if [[ -s "${probe_stderr}" ]]; then
    sed -n '1,3p' "${probe_stderr}" | sed 's/^/psql: /'
  fi
  exit 1
fi
db_name="$(printf '%s' "${db_name}" | tr -d '[:space:]')"
if [[ "${db_name}" != "synapse_gateway" ]]; then
  echo "Error: cleanup only runs against local synapse_gateway; got '${db_name:-unknown}'."
  echo "DSN: $(mask_dsn "${POSTGRES_DSN}")"
  exit 1
fi

test_service_clause="
  (
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

active_test_clause="status = 'active' AND ${test_service_clause}"
runtime_health_clause="
  (
    state_key LIKE 'service_health_meta::api_ref_%'
    OR state_key LIKE 'service_health_meta::apiref_test_%'
    OR state_key LIKE 'service_health_meta::provider_onboard_%'
    OR state_key LIKE 'service_health_meta::llm_%_llm_deepseek_%'
    OR state_key LIKE 'service_health_meta::gateway_pull_health_%'
    OR state_key LIKE 'service_health_history::api_ref_%'
    OR state_key LIKE 'service_health_history::apiref_test_%'
    OR state_key LIKE 'service_health_history::provider_onboard_%'
    OR state_key LIKE 'service_health_history::llm_%_llm_deepseek_%'
    OR state_key LIKE 'service_health_history::gateway_pull_health_%'
  )
  AND state_key NOT LIKE 'service_health_meta::svc_web3_sentiment_index::%'
  AND state_key NOT LIKE 'service_health_meta::svc_protocol_fundamental_brief::%'
  AND state_key NOT LIKE 'service_health_meta::svc_oss_security_healthcheck::%'
  AND state_key NOT LIKE 'service_health_meta::svc_deepseek_chat::%'
  AND state_key <> 'service_health_history::svc_web3_sentiment_index'
  AND state_key <> 'service_health_history::svc_protocol_fundamental_brief'
  AND state_key <> 'service_health_history::svc_oss_security_healthcheck'
  AND state_key <> 'service_health_history::svc_deepseek_chat'
"

count_sql() {
  psql "${POSTGRES_DSN}" -X -q -t -A -v ON_ERROR_STOP=1 -c "$1" | tail -n 1
}

before_active_test="$(count_sql "SELECT COUNT(*) FROM synapse_service_manifests WHERE ${active_test_clause}")"
before_canonical_active="$(count_sql "SELECT COUNT(*) FROM synapse_service_manifests WHERE status = 'active' AND service_id IN ('svc_web3_sentiment_index','svc_protocol_fundamental_brief','svc_oss_security_healthcheck','svc_deepseek_chat')")"
before_health_snapshots="$(count_sql "SELECT COUNT(*) FROM synapse_service_health_snapshots WHERE service_id IN (SELECT service_id FROM synapse_service_manifests WHERE ${test_service_clause})")"
before_runtime_health_state="$(count_sql "SELECT COUNT(*) FROM synapse_runtime_state WHERE ${runtime_health_clause}")"

if [[ "${DRY_RUN}" != "1" ]]; then
  psql "${POSTGRES_DSN}" -X -q -v ON_ERROR_STOP=1 <<SQL
UPDATE synapse_service_manifests
SET status = 'archived', updated_at = NOW()
WHERE ${active_test_clause};

DELETE FROM synapse_service_health_snapshots
WHERE service_id IN (
  SELECT service_id FROM synapse_service_manifests WHERE ${test_service_clause}
);

DELETE FROM synapse_runtime_state
WHERE ${runtime_health_clause};
SQL
fi

after_active_test="$(count_sql "SELECT COUNT(*) FROM synapse_service_manifests WHERE ${active_test_clause}")"
after_canonical_active="$(count_sql "SELECT COUNT(*) FROM synapse_service_manifests WHERE status = 'active' AND service_id IN ('svc_web3_sentiment_index','svc_protocol_fundamental_brief','svc_oss_security_healthcheck','svc_deepseek_chat')")"
after_health_snapshots="$(count_sql "SELECT COUNT(*) FROM synapse_service_health_snapshots WHERE service_id IN (SELECT service_id FROM synapse_service_manifests WHERE ${test_service_clause})")"
after_runtime_health_state="$(count_sql "SELECT COUNT(*) FROM synapse_runtime_state WHERE ${runtime_health_clause}")"

if [[ "${OUTPUT_FORMAT}" == "json" ]]; then
  cat <<JSON
{
  "dryRun": $([[ "${DRY_RUN}" == "1" ]] && echo true || echo false),
  "activeTestServicesBefore": ${before_active_test},
  "activeTestServicesAfter": ${after_active_test},
  "canonicalActiveServicesBefore": ${before_canonical_active},
  "canonicalActiveServicesAfter": ${after_canonical_active},
  "healthSnapshotsBefore": ${before_health_snapshots},
  "healthSnapshotsAfter": ${after_health_snapshots},
  "runtimeHealthStateBefore": ${before_runtime_health_state},
  "runtimeHealthStateAfter": ${after_runtime_health_state}
}
JSON
else
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "Dry run only. No local DB rows were changed."
  fi
  echo "Active local E2E services before: ${before_active_test}"
  echo "Active local E2E services after : ${after_active_test}"
  echo "Canonical active services before: ${before_canonical_active}"
  echo "Canonical active services after : ${after_canonical_active}"
  echo "Health snapshots before        : ${before_health_snapshots}"
  echo "Health snapshots after         : ${after_health_snapshots}"
  echo "Runtime health state before    : ${before_runtime_health_state}"
  echo "Runtime health state after     : ${after_runtime_health_state}"
fi
