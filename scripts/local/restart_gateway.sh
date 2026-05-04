#!/usr/bin/env bash

if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# scripts/ is a symlink (→ tools/scripts); logical path is Synapse-Network/scripts/local
# so repo root is two levels up from SCRIPT_DIR, not three.
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PID_FILE="${ROOT_DIR}/.local_env.pids"
LOG_FILE="${ROOT_DIR}/services/gateway/logs/provider_api.log"
CONFIG_FILE="${ROOT_DIR}/services/user-front/src/contract-config.json"
HEALTH_URL="http://127.0.0.1:8000/health"
STARTUP_TIMEOUT_SEC="${STARTUP_TIMEOUT_SEC:-20}"
LOCAL_GATEWAY_POSTGRES_PORT="${SYNAPSE_POSTGRES_HOST_PORT:-15432}"

find_pid_by_port() {
  port="$1"
  lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

shell_quote() {
  printf '%q' "$1"
}

resolve_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
    return 0
  fi
  return 1
}

ensure_docker_runtime() {
  compose_cmd="$1"
  if ${compose_cmd} version >/dev/null 2>&1; then
    return 0
  fi
  if command -v colima >/dev/null 2>&1; then
    echo "Docker daemon is not available. Starting Colima..."
    colima start >/dev/null
    if ${compose_cmd} version >/dev/null 2>&1; then
      return 0
    fi
  fi
  echo "Error: Docker runtime is unavailable and local postgres cannot be started automatically."
  return 1
}

wait_for_postgres_ready() {
  timeout_sec="${1:-30}"
  elapsed=0
  while [ "$elapsed" -lt "$timeout_sec" ]; do
    if pg_isready -h 127.0.0.1 -p "$LOCAL_GATEWAY_POSTGRES_PORT" -U synapse >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

probe_synapse_postgres() {
  dsn="$1"
  if ! command -v psql >/dev/null 2>&1; then
    echo "Error: psql is required to validate the Synapse Postgres role/schema."
    return 1
  fi

  probe_output="$(psql "$dsn" -X -q -t -A -v ON_ERROR_STOP=1 \
    -c "SELECT current_user || ':' || current_database() || ':' || COALESCE(to_regclass('public.synapse_owner_accounts')::text, '')" 2>&1 || true)"
  probe_result="$(printf '%s' "$probe_output" | tail -n 1)"
  case "$probe_result" in
    *:synapse_owner_accounts|*:public.synapse_owner_accounts)
      return 0
      ;;
  esac

  echo "Error: configured local Gateway Postgres DSN is not a usable Synapse gateway database."
  echo "Probe expected current_user:database:public.synapse_owner_accounts; got '${probe_result:-empty}'."
  if [ -n "$probe_output" ]; then
    echo "psql output:"
    printf '%s\n' "$probe_output"
  fi
  existing_postgres_pid="$(lsof -t -nP -iTCP:5432 -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if [ -n "$existing_postgres_pid" ] && [ "$LOCAL_GATEWAY_POSTGRES_PORT" != "5432" ]; then
    echo "Current listener on 5432:"
    ps -p "$existing_postgres_pid" -o pid,ppid,command 2>/dev/null || true
  fi
  echo "Tip: local Gateway defaults to Docker Postgres on 127.0.0.1:${LOCAL_GATEWAY_POSTGRES_PORT}; set LOCAL_GATEWAY_POSTGRES_DSN only for an intentional local override."
  return 1
}

check_local_service_registry_bloat() {
  dsn="$1"
  limit="${LOCAL_SERVICE_REGISTRY_TEST_ACTIVE_LIMIT:-50}"
  health_limit="${LOCAL_SERVICE_REGISTRY_TEST_HEALTH_STATE_LIMIT:-100}"
  case "$limit" in
    ''|*[!0-9]*)
      limit=50
      ;;
  esac
  case "$health_limit" in
    ''|*[!0-9]*)
      health_limit=100
      ;;
  esac
  if [ "$limit" -le 0 ]; then
    active_limit_disabled=1
  else
    active_limit_disabled=0
  fi

  active_test_count="$(psql "$dsn" -X -q -t -A -v ON_ERROR_STOP=1 \
    -c "SELECT COUNT(*) FROM synapse_service_manifests WHERE status = 'active' AND (service_id LIKE 'api_ref_%' OR service_id LIKE 'apiref_test_%' OR service_id LIKE 'provider_onboard_%' OR service_id LIKE 'llm_%_llm_deepseek_%' OR service_id LIKE 'gateway_pull_health_%' OR service_id LIKE 'svc_e2e_%' OR service_id LIKE 'svc_verify_%' OR service_id LIKE 'svc_buyer_%' OR service_id LIKE 'ufc_%') AND service_id NOT IN ('svc_web3_sentiment_index','svc_protocol_fundamental_brief','svc_oss_security_healthcheck','svc_deepseek_chat')" 2>/dev/null || echo "0")"
  active_test_count="$(printf '%s' "$active_test_count" | tail -n 1)"
  health_state_count="$(psql "$dsn" -X -q -t -A -v ON_ERROR_STOP=1 \
    -c "SELECT COUNT(*) FROM synapse_runtime_state WHERE (state_key LIKE 'service_health_meta::api_ref_%' OR state_key LIKE 'service_health_meta::apiref_test_%' OR state_key LIKE 'service_health_meta::provider_onboard_%' OR state_key LIKE 'service_health_meta::llm_%_llm_deepseek_%' OR state_key LIKE 'service_health_meta::gateway_pull_health_%' OR state_key LIKE 'service_health_meta::svc_e2e_%' OR state_key LIKE 'service_health_meta::svc_verify_%' OR state_key LIKE 'service_health_meta::svc_buyer_%' OR state_key LIKE 'service_health_meta::ufc_%' OR state_key LIKE 'service_health_history::api_ref_%' OR state_key LIKE 'service_health_history::apiref_test_%' OR state_key LIKE 'service_health_history::provider_onboard_%' OR state_key LIKE 'service_health_history::llm_%_llm_deepseek_%' OR state_key LIKE 'service_health_history::gateway_pull_health_%' OR state_key LIKE 'service_health_history::svc_e2e_%' OR state_key LIKE 'service_health_history::svc_verify_%' OR state_key LIKE 'service_health_history::svc_buyer_%' OR state_key LIKE 'service_health_history::ufc_%') AND state_key NOT LIKE 'service_health_meta::svc_web3_sentiment_index::%' AND state_key NOT LIKE 'service_health_meta::svc_protocol_fundamental_brief::%' AND state_key NOT LIKE 'service_health_meta::svc_oss_security_healthcheck::%' AND state_key NOT LIKE 'service_health_meta::svc_deepseek_chat::%' AND state_key <> 'service_health_history::svc_web3_sentiment_index' AND state_key <> 'service_health_history::svc_protocol_fundamental_brief' AND state_key <> 'service_health_history::svc_oss_security_healthcheck' AND state_key <> 'service_health_history::svc_deepseek_chat'" 2>/dev/null || echo "0")"
  health_state_count="$(printf '%s' "$health_state_count" | tail -n 1)"
  if [ "${health_limit:-0}" -gt 0 ] && [ "${health_state_count:-0}" -gt "$health_limit" ]; then
    echo "Warning: local registry has ${health_state_count} E2E/test service health runtime rows; warning threshold is ${health_limit}."
    echo "These runtime health rows can still slow monitor ticks even after manifests are archived."
    echo "Inspect without mutating:"
    echo "  LOCAL_DEV_CLEANUP_DRY_RUN=1 LOCAL_DEV_CLEANUP_OUTPUT=json \\"
    echo "    bash scripts/local/cleanup_service_registry_dev.sh"
  fi
  if [ "$active_limit_disabled" -eq 1 ] || [ "${active_test_count:-0}" -le "$limit" ]; then
    return 0
  fi

  echo "Error: local registry has ${active_test_count} active E2E/test services; limit is ${limit}."
  echo "These stale services steal health-monitor probe slots and can make Marketplace flicker empty."
  echo "Run:"
  echo "  LOCAL_DEV_CLEANUP_CONFIRM=I_UNDERSTAND_THIS_MUTATES_LOCAL_DB \\"
  echo "    bash scripts/local/cleanup_service_registry_dev.sh"
  echo "Or set LOCAL_SERVICE_REGISTRY_TEST_ACTIVE_LIMIT=0 only for emergency debugging."
  return 1
}

ensure_local_postgres() {
  existing_postgres_pid="$(lsof -t -nP -iTCP:5432 -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if [ -n "$existing_postgres_pid" ] && [ "$LOCAL_GATEWAY_POSTGRES_PORT" != "5432" ]; then
    echo "Port 5432 is already in use by PID ${existing_postgres_pid}; local Gateway will use Docker Postgres on 127.0.0.1:${LOCAL_GATEWAY_POSTGRES_PORT}."
  fi

  if ! compose_cmd="$(resolve_compose_cmd)"; then
    echo "Error: neither 'docker compose' nor 'docker-compose' is available; cannot bootstrap local Postgres."
    return 1
  fi
  ensure_docker_runtime "$compose_cmd"

  echo "Starting Docker local Postgres via ${compose_cmd} on 127.0.0.1:${LOCAL_GATEWAY_POSTGRES_PORT}..."
  SYNAPSE_POSTGRES_HOST_PORT="$LOCAL_GATEWAY_POSTGRES_PORT" ${compose_cmd} -f "${ROOT_DIR}/infra/docker/local/docker-compose.yml" up -d postgres >/dev/null
  if ! wait_for_postgres_ready 45; then
    echo "Error: Docker local Postgres failed to become ready on 127.0.0.1:${LOCAL_GATEWAY_POSTGRES_PORT}."
    return 1
  fi
}

stop_pid() {
  name="$1"
  pid="$2"

  if [ -z "${pid:-}" ]; then
    return
  fi

  if kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1 || true
      echo "${name}: force killed (${pid})"
    else
      echo "${name}: stopped (${pid})"
    fi
  fi
}

wait_for_gateway_health() {
  health_url="$1"
  timeout_sec="$2"
  elapsed=0

  while [ "$elapsed" -lt "$timeout_sec" ]; do
    if curl -fsS "$health_url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  return 1
}

if [[ ! -f "${ROOT_DIR}/scripts/python/resolve_python_313.sh" ]]; then
  echo "Error: Python resolver script not found at ${ROOT_DIR}/scripts/python/resolve_python_313.sh"
  exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: contract-config.json not found at ${CONFIG_FILE}"
  echo "Tip: run scripts/local/setup_local_env.sh first to deploy local contracts."
  exit 1
fi

if [ -x "${ROOT_DIR}/services/gateway/.venv/bin/python" ]; then
  PYTHON_BIN="${ROOT_DIR}/services/gateway/.venv/bin/python"
elif [ -x "${ROOT_DIR}/services/gateway/venv/bin/python" ]; then
  PYTHON_BIN="${ROOT_DIR}/services/gateway/venv/bin/python"
else
  PYTHON_BIN="$(bash "${ROOT_DIR}/scripts/python/resolve_python_313.sh")"
fi

echo "=== Restarting gateway/gateway_fastapi.py only ==="
echo "Using Python interpreter: ${PYTHON_BIN}"

if ! "$PYTHON_BIN" -c "import uvicorn, fastapi, web3" >/dev/null 2>&1; then
  echo "Python dependencies missing. Installing from gateway/requirements.txt ..."
  "$PYTHON_BIN" -m pip install -r "${ROOT_DIR}/services/gateway/requirements.txt"
fi

ensure_local_postgres

PROVIDER_PID_FROM_FILE=""
if [ -f "$PID_FILE" ]; then
  . "$PID_FILE" || true
  PROVIDER_PID_FROM_FILE="${PROVIDER_PID:-}"
fi

EXISTING_PROVIDER_PID="${PROVIDER_PID_FROM_FILE}"
if [ -z "$EXISTING_PROVIDER_PID" ]; then
  EXISTING_PROVIDER_PID="$(find_pid_by_port 8000)"
fi

if [ -n "$EXISTING_PROVIDER_PID" ]; then
  echo "Stopping existing gateway process on 8000: PID ${EXISTING_PROVIDER_PID}"
  stop_pid "ProviderAPI" "$EXISTING_PROVIDER_PID"
fi

LISTENER_PID_AFTER_STOP="$(find_pid_by_port 8000)"
if [ -n "$LISTENER_PID_AFTER_STOP" ] && [ "$LISTENER_PID_AFTER_STOP" != "$EXISTING_PROVIDER_PID" ]; then
  echo "Stopping stale gateway listener on 8000: PID ${LISTENER_PID_AFTER_STOP}"
  stop_pid "ProviderAPIListener" "$LISTENER_PID_AFTER_STOP"
fi

ROUTER_ADDRESS="$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(c.SynapseCore || c.A2APaySyncRouter || '')")"
USDC_TOKEN_ADDRESS="$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(c.MockUSDC || c.USDC || '')")"

DEFAULT_LOCAL_POSTGRES_DSN="postgresql://synapse:local-dev-postgres-password@127.0.0.1:${LOCAL_GATEWAY_POSTGRES_PORT}/synapse_gateway"
_LOCAL_ENV_FILE="${ROOT_DIR}/services/gateway/.env.local"
if [[ -n "${LOCAL_GATEWAY_POSTGRES_DSN:-}" ]]; then
  LOCAL_POSTGRES_DSN="${LOCAL_GATEWAY_POSTGRES_DSN}"
else
  if [[ -n "${POSTGRES_DSN:-}" ]]; then
    echo "[local-gateway] ignoring ambient POSTGRES_DSN for local restart; use LOCAL_GATEWAY_POSTGRES_DSN to override intentionally."
  fi
  if [[ -f "$_LOCAL_ENV_FILE" ]] && grep -q '^POSTGRES_DSN=' "$_LOCAL_ENV_FILE"; then
    echo "[local-gateway] ignoring services/gateway/.env.local POSTGRES_DSN; local restart uses Docker Postgres by default."
  fi
  LOCAL_POSTGRES_DSN="$DEFAULT_LOCAL_POSTGRES_DSN"
fi
LOCAL_POSTGRES_DSN="$(printf '%s' "$LOCAL_POSTGRES_DSN" | sed 's/@postgres:/@127.0.0.1:/')"
probe_synapse_postgres "$LOCAL_POSTGRES_DSN"
check_local_service_registry_bloat "$LOCAL_POSTGRES_DSN"

cd "${ROOT_DIR}/services/gateway"

ENV_FILE_ARG=""
if [ -f "${ROOT_DIR}/services/gateway/.env.local" ]; then
  ENV_FILE_ARG="ENV_FILE=.env.local"
fi

if command -v screen >/dev/null 2>&1; then
  screen -S synapse-gateway -X quit >/dev/null 2>&1 || true
  START_CMD="cd $(shell_quote "${ROOT_DIR}/services/gateway") && exec env \
ENVIRONMENT=local \
${ENV_FILE_ARG} \
GATEWAY_RELOAD=false \
V2_INDEXER_ENABLED=$(shell_quote "${V2_INDEXER_ENABLED:-true}") \
V2_BACKFILL_ENABLED=$(shell_quote "${V2_BACKFILL_ENABLED:-false}") \
V2_RECONCILIATION_ENABLED=$(shell_quote "${V2_RECONCILIATION_ENABLED:-false}") \
PROVIDER_WITHDRAW_EXPIRY_REAPER_ENABLED=$(shell_quote "${PROVIDER_WITHDRAW_EXPIRY_REAPER_ENABLED:-false}") \
CONSUMER_WITHDRAW_PROCESSOR_ENABLED=$(shell_quote "${CONSUMER_WITHDRAW_PROCESSOR_ENABLED:-false}") \
SUPPORT_LARK_ENABLED=$(shell_quote "${SUPPORT_LARK_ENABLED:-false}") \
SUPPORT_LARK_WEBHOOK_URL=$(shell_quote "${SUPPORT_LARK_WEBHOOK_URL:-}") \
SUPPORT_LARK_SECRET=$(shell_quote "${SUPPORT_LARK_SECRET:-}") \
SUPPORT_LARK_TIMEOUT_SEC=$(shell_quote "${SUPPORT_LARK_TIMEOUT_SEC:-3}") \
POSTGRES_DSN=$(shell_quote "$LOCAL_POSTGRES_DSN") \
RPC_URL=http://127.0.0.1:8545 \
ROUTER_ADDRESS=$(shell_quote "$ROUTER_ADDRESS") \
USDC_TOKEN_ADDRESS=$(shell_quote "$USDC_TOKEN_ADDRESS") \
$(shell_quote "$PYTHON_BIN") gateway_fastapi.py > $(shell_quote "$LOG_FILE") 2>&1"
  screen -dmS synapse-gateway bash -lc "$START_CMD"
  NEW_PROVIDER_PID=""
else
  nohup env \
    ENVIRONMENT=local \
    ${ENV_FILE_ARG} \
    GATEWAY_RELOAD=false \
    V2_INDEXER_ENABLED="${V2_INDEXER_ENABLED:-true}" \
    V2_BACKFILL_ENABLED="${V2_BACKFILL_ENABLED:-false}" \
    V2_RECONCILIATION_ENABLED="${V2_RECONCILIATION_ENABLED:-false}" \
    PROVIDER_WITHDRAW_EXPIRY_REAPER_ENABLED="${PROVIDER_WITHDRAW_EXPIRY_REAPER_ENABLED:-false}" \
    CONSUMER_WITHDRAW_PROCESSOR_ENABLED="${CONSUMER_WITHDRAW_PROCESSOR_ENABLED:-false}" \
    SUPPORT_LARK_ENABLED="${SUPPORT_LARK_ENABLED:-false}" \
    SUPPORT_LARK_WEBHOOK_URL="${SUPPORT_LARK_WEBHOOK_URL:-}" \
    SUPPORT_LARK_SECRET="${SUPPORT_LARK_SECRET:-}" \
    SUPPORT_LARK_TIMEOUT_SEC="${SUPPORT_LARK_TIMEOUT_SEC:-3}" \
    POSTGRES_DSN="$LOCAL_POSTGRES_DSN" \
    RPC_URL="http://127.0.0.1:8545" \
    ROUTER_ADDRESS="$ROUTER_ADDRESS" \
    USDC_TOKEN_ADDRESS="$USDC_TOKEN_ADDRESS" \
    "$PYTHON_BIN" gateway_fastapi.py > "$LOG_FILE" 2>&1 < /dev/null &
  NEW_PROVIDER_PID=$!
fi
if ! wait_for_gateway_health "$HEALTH_URL" "$STARTUP_TIMEOUT_SEC"; then
  echo "Error: gateway failed health check within ${STARTUP_TIMEOUT_SEC}s. Check ${LOG_FILE}"
  stop_pid "ProviderAPI" "$NEW_PROVIDER_PID"
  LISTENER_PID="$(find_pid_by_port 8000)"
  if [ -n "$LISTENER_PID" ] && [ "$LISTENER_PID" != "$NEW_PROVIDER_PID" ]; then
    stop_pid "ProviderAPIListener" "$LISTENER_PID"
  fi
  tail -n 40 "$LOG_FILE" || true
  exit 1
fi

ACTIVE_PROVIDER_PID="$(find_pid_by_port 8000)"
if [ -n "$ACTIVE_PROVIDER_PID" ]; then
  NEW_PROVIDER_PID="$ACTIVE_PROVIDER_PID"
fi

sleep 3
if ! curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
  echo "Error: gateway became healthy but exited immediately. Check ${LOG_FILE}"
  tail -n 80 "$LOG_FILE" || true
  exit 1
fi

if [ -f "$PID_FILE" ]; then
  grep -v '^PROVIDER_PID=' "$PID_FILE" > "${PID_FILE}.tmp" || true
  echo "PROVIDER_PID=${NEW_PROVIDER_PID}" >> "${PID_FILE}.tmp"
  mv "${PID_FILE}.tmp" "$PID_FILE"
else
  cat > "$PID_FILE" <<EOF
PROVIDER_PID=${NEW_PROVIDER_PID}
EOF
fi

echo "Gateway restarted successfully"
echo "Gateway PID  : ${NEW_PROVIDER_PID}"
echo "PID file     : ${PID_FILE}"
echo "Health check : ${HEALTH_URL}"
echo "Log file     : ${LOG_FILE}"
