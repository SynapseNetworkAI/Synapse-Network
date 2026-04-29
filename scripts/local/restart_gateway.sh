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
    if pg_isready -h 127.0.0.1 -p 5432 -U synapse >/dev/null 2>&1; then
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

  echo "Error: 127.0.0.1:5432 is not a usable Synapse gateway Postgres instance."
  echo "Probe expected current_user:database:public.synapse_owner_accounts; got '${probe_result:-empty}'."
  if [ -n "$probe_output" ]; then
    echo "psql output:"
    printf '%s\n' "$probe_output"
  fi
  existing_postgres_pid="$(find_pid_by_port 5432)"
  if [ -n "$existing_postgres_pid" ]; then
    echo "Current listener on 5432:"
    ps -p "$existing_postgres_pid" -o pid,ppid,command 2>/dev/null || true
  fi
  echo "Tip: stop the conflicting Postgres process or set LOCAL_GATEWAY_POSTGRES_DSN to an explicit local Synapse gateway DSN."
  return 1
}

ensure_local_postgres() {
  existing_postgres_pid="$(find_pid_by_port 5432)"
  if [ -n "$existing_postgres_pid" ]; then
    echo "Port 5432 already in use by PID ${existing_postgres_pid}. Reusing existing local Postgres."
    return 0
  fi

  if ! compose_cmd="$(resolve_compose_cmd)"; then
    echo "Error: neither 'docker compose' nor 'docker-compose' is available; cannot bootstrap local Postgres."
    return 1
  fi
  ensure_docker_runtime "$compose_cmd"

  echo "Starting local Postgres via ${compose_cmd}..."
  ${compose_cmd} -f "${ROOT_DIR}/infra/docker/local/docker-compose.yml" up -d postgres >/dev/null
  if ! wait_for_postgres_ready 45; then
    echo "Error: local Postgres failed to become ready on 127.0.0.1:5432."
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

DEFAULT_LOCAL_POSTGRES_DSN="postgresql://synapse:local-dev-postgres-password@127.0.0.1:5432/synapse_gateway"
_LOCAL_ENV_FILE="${ROOT_DIR}/services/gateway/.env.local"
if [[ -n "${LOCAL_GATEWAY_POSTGRES_DSN:-}" ]]; then
  LOCAL_POSTGRES_DSN="${LOCAL_GATEWAY_POSTGRES_DSN}"
elif [[ -f "$_LOCAL_ENV_FILE" ]]; then
  _dotenv_dsn="$(grep -m1 '^POSTGRES_DSN=' "$_LOCAL_ENV_FILE" | cut -d= -f2-)"
  LOCAL_POSTGRES_DSN="${_dotenv_dsn:-$DEFAULT_LOCAL_POSTGRES_DSN}"
else
  if [[ -n "${POSTGRES_DSN:-}" ]]; then
    echo "[local-gateway] ignoring ambient POSTGRES_DSN for local restart; use LOCAL_GATEWAY_POSTGRES_DSN to override intentionally."
  fi
  LOCAL_POSTGRES_DSN="$DEFAULT_LOCAL_POSTGRES_DSN"
fi
LOCAL_POSTGRES_DSN="$(printf '%s' "$LOCAL_POSTGRES_DSN" | sed 's/@postgres:/@127.0.0.1:/')"
probe_synapse_postgres "$LOCAL_POSTGRES_DSN"

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
V2_INDEXER_ENABLED=$(shell_quote "${V2_INDEXER_ENABLED:-false}") \
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
$(shell_quote "$PYTHON_BIN") gateway_fastapi.py > $(shell_quote "$LOG_FILE") 2>&1"
  screen -dmS synapse-gateway bash -lc "$START_CMD"
  NEW_PROVIDER_PID=""
else
  nohup env \
    ENVIRONMENT=local \
    ${ENV_FILE_ARG} \
    GATEWAY_RELOAD=false \
    V2_INDEXER_ENABLED="${V2_INDEXER_ENABLED:-false}" \
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
