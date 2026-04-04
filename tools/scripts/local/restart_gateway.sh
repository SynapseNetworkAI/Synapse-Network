#!/usr/bin/env bash

if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
PID_FILE="${ROOT_DIR}/.local_env.pids"
LOG_FILE="${ROOT_DIR}/services/gateway/logs/provider_api.log"
CONFIG_FILE="${ROOT_DIR}/services/user-front/src/contract-config.json"
HEALTH_URL="http://127.0.0.1:8000/health"
STARTUP_TIMEOUT_SEC="${STARTUP_TIMEOUT_SEC:-20}"

find_pid_by_port() {
  port="$1"
  lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
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

if [[ ! -f "${ROOT_DIR}/scripts/python/resolve_python_311.sh" ]]; then
  echo "Error: Python resolver script not found at ${ROOT_DIR}/scripts/python/resolve_python_311.sh"
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
  PYTHON_BIN="$(bash "${ROOT_DIR}/scripts/python/resolve_python_311.sh")"
fi

echo "=== Restarting gateway/gateway_fastapi.py only ==="
echo "Using Python interpreter: ${PYTHON_BIN}"

if ! "$PYTHON_BIN" -c "import uvicorn, fastapi, web3" >/dev/null 2>&1; then
  echo "Python dependencies missing. Installing from gateway/requirements.txt ..."
  "$PYTHON_BIN" -m pip install -r "${ROOT_DIR}/services/gateway/requirements.txt"
fi

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
PROVIDER_ADDRESS="$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(c.Treasury || '')")"

DEFAULT_LOCAL_POSTGRES_DSN="postgresql://synapse:12345678@127.0.0.1:5432/synapse_gateway"
LOCAL_POSTGRES_DSN="${POSTGRES_DSN:-$DEFAULT_LOCAL_POSTGRES_DSN}"
LOCAL_POSTGRES_DSN="$(printf '%s' "$LOCAL_POSTGRES_DSN" | sed 's/@postgres:/@127.0.0.1:/')"

cd "${ROOT_DIR}/services/gateway"

if [ -f "${ROOT_DIR}/services/gateway/.env.local" ]; then
  nohup env \
    ENVIRONMENT=local \
    ENV_FILE=.env.local \
    GATEWAY_RELOAD=false \
    POSTGRES_DSN="$LOCAL_POSTGRES_DSN" \
    RPC_URL="http://127.0.0.1:8545" \
    ROUTER_ADDRESS="$ROUTER_ADDRESS" \
    PROVIDER_ADDRESS="$PROVIDER_ADDRESS" \
    EXPECTED_PRICE="1000000000000000000" \
    "$PYTHON_BIN" gateway_fastapi.py > "$LOG_FILE" 2>&1 < /dev/null &
else
  nohup env \
    ENVIRONMENT=local \
    GATEWAY_RELOAD=false \
    POSTGRES_DSN="$LOCAL_POSTGRES_DSN" \
    RPC_URL="http://127.0.0.1:8545" \
    ROUTER_ADDRESS="$ROUTER_ADDRESS" \
    PROVIDER_ADDRESS="$PROVIDER_ADDRESS" \
    EXPECTED_PRICE="1000000000000000000" \
    "$PYTHON_BIN" gateway_fastapi.py > "$LOG_FILE" 2>&1 < /dev/null &
fi

NEW_PROVIDER_PID=$!
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
