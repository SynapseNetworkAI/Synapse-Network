#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PID_FILE="${ROOT_DIR}/.local_env.pids"
LOG_FILE="${ROOT_DIR}/gateway/logs/seller_api.log"
CONFIG_FILE="${ROOT_DIR}/apps/frontend/src/contract-config.json"

find_pid_by_port() {
  local port="$1"
  lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

stop_pid() {
  local name="$1"
  local pid="$2"

  if [[ -z "${pid:-}" ]]; then
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

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 is not installed."
  exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Error: contract-config.json not found at ${CONFIG_FILE}"
  echo "Tip: run scripts/local/setup_local_env.sh first to deploy local contracts."
  exit 1
fi

if [[ -x "${ROOT_DIR}/gateway/venv/bin/python" ]]; then
  PYTHON_BIN="${ROOT_DIR}/gateway/venv/bin/python"
else
  PYTHON_BIN="python3"
fi

echo "=== Restarting gateway/seller_fastapi.py only ==="
echo "Using Python interpreter: ${PYTHON_BIN}"

if ! "$PYTHON_BIN" -c "import uvicorn, fastapi, web3" >/dev/null 2>&1; then
  echo "Python dependencies missing. Installing from gateway/requirements.txt ..."
  "$PYTHON_BIN" -m pip install -r "${ROOT_DIR}/gateway/requirements.txt"
fi

SELLER_PID_FROM_FILE=""
if [[ -f "$PID_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$PID_FILE" || true
  SELLER_PID_FROM_FILE="${SELLER_PID:-}"
fi

EXISTING_SELLER_PID="${SELLER_PID_FROM_FILE}"
if [[ -z "$EXISTING_SELLER_PID" ]]; then
  EXISTING_SELLER_PID="$(find_pid_by_port 8000)"
fi

if [[ -n "$EXISTING_SELLER_PID" ]]; then
  echo "Stopping existing gateway process on 8000: PID ${EXISTING_SELLER_PID}"
  stop_pid "SellerAPI" "$EXISTING_SELLER_PID"
fi

ROUTER_ADDRESS="$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(c.SynapseCore || c.A2APaySyncRouter || '')")"
SELLER_ADDRESS="$(node -e "const c=require('${CONFIG_FILE}'); process.stdout.write(c.Treasury || '')")"

DEFAULT_LOCAL_POSTGRES_DSN="postgresql://synapse:12345678@127.0.0.1:5432/synapse_gateway"
LOCAL_POSTGRES_DSN="${POSTGRES_DSN:-$DEFAULT_LOCAL_POSTGRES_DSN}"
LOCAL_POSTGRES_DSN="${LOCAL_POSTGRES_DSN/@postgres:/@127.0.0.1:}"

cd "${ROOT_DIR}/gateway"

if [[ -f "${ROOT_DIR}/gateway/.env.local" ]]; then
  ENVIRONMENT=local \
  ENV_FILE=.env.local \
  POSTGRES_DSN="$LOCAL_POSTGRES_DSN" \
  RPC_URL="http://127.0.0.1:8545" \
  ROUTER_ADDRESS="$ROUTER_ADDRESS" \
  SELLER_ADDRESS="$SELLER_ADDRESS" \
  EXPECTED_PRICE="1000000000000000000" \
  "$PYTHON_BIN" seller_fastapi.py > "$LOG_FILE" 2>&1 &
else
  ENVIRONMENT=local \
  POSTGRES_DSN="$LOCAL_POSTGRES_DSN" \
  RPC_URL="http://127.0.0.1:8545" \
  ROUTER_ADDRESS="$ROUTER_ADDRESS" \
  SELLER_ADDRESS="$SELLER_ADDRESS" \
  EXPECTED_PRICE="1000000000000000000" \
  "$PYTHON_BIN" seller_fastapi.py > "$LOG_FILE" 2>&1 &
fi

NEW_SELLER_PID=$!
sleep 3

if ! kill -0 "$NEW_SELLER_PID" >/dev/null 2>&1; then
  echo "Error: gateway failed to start. Check ${LOG_FILE}"
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  grep -v '^SELLER_PID=' "$PID_FILE" > "${PID_FILE}.tmp" || true
  echo "SELLER_PID=${NEW_SELLER_PID}" >> "${PID_FILE}.tmp"
  mv "${PID_FILE}.tmp" "$PID_FILE"
else
  cat > "$PID_FILE" <<EOF
SELLER_PID=${NEW_SELLER_PID}
EOF
fi

echo "Gateway restarted successfully"
echo "Gateway PID  : ${NEW_SELLER_PID}"
echo "PID file     : ${PID_FILE}"
echo "Health check : http://127.0.0.1:8000/health"
echo "Log file     : ${LOG_FILE}"
