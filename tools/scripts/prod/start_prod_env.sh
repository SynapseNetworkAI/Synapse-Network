#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PID_FILE="${ROOT_DIR}/.prod_env.pids"
LOG_FILE="${ROOT_DIR}/gateway/logs/provider_api_prod.log"

find_pid_by_port() {
  local port="$1"
  lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 is not installed."
  exit 1
fi

cd "${ROOT_DIR}/gateway"

if [[ -x "${ROOT_DIR}/gateway/venv/bin/python" ]]; then
  PYTHON_BIN="${ROOT_DIR}/gateway/venv/bin/python"
else
  PYTHON_BIN="python3"
fi

echo "=== Starting Synapse prod profile (gateway/provider_fastapi.py only) ==="
echo "Using Python interpreter: ${PYTHON_BIN}"

if ! "$PYTHON_BIN" -c "import uvicorn, fastapi, web3" >/dev/null 2>&1; then
  echo "Python dependencies missing. Installing from gateway/requirements.txt ..."
  "$PYTHON_BIN" -m pip install -r "${ROOT_DIR}/gateway/requirements.txt"
fi

EXISTING_PROVIDER_PID="$(find_pid_by_port 8000)"
if [[ -n "$EXISTING_PROVIDER_PID" ]]; then
  echo "Port 8000 already in use by PID ${EXISTING_PROVIDER_PID}. Stopping stale API process..."
  kill "$EXISTING_PROVIDER_PID" >/dev/null 2>&1 || true
  sleep 1
  if kill -0 "$EXISTING_PROVIDER_PID" >/dev/null 2>&1; then
    kill -9 "$EXISTING_PROVIDER_PID" >/dev/null 2>&1 || true
  fi
fi

if [[ -f "${ROOT_DIR}/gateway/.env.prod" ]]; then
  ENVIRONMENT=prod ENV_FILE=.env.prod "$PYTHON_BIN" provider_fastapi.py > "$LOG_FILE" 2>&1 &
else
  ENVIRONMENT=prod "$PYTHON_BIN" provider_fastapi.py > "$LOG_FILE" 2>&1 &
fi

PROVIDER_PID=$!
sleep 3

if ! kill -0 "$PROVIDER_PID" >/dev/null 2>&1; then
  echo "Error: Provider API failed to start. Check ${LOG_FILE}"
  exit 1
fi

cat > "$PID_FILE" <<EOF
PROVIDER_PID=$PROVIDER_PID
EOF

echo "Prod Provider PID : $PROVIDER_PID"
echo "PID file        : $PID_FILE"
echo "Log file        : $LOG_FILE"
echo "Health endpoint : http://127.0.0.1:8000/health"
