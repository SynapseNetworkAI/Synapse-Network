#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

ensure_runtime_dirs

PYTHON_BIN="$(resolve_python_bin)"
UVICORN_BIN="$(resolve_uvicorn_bin)"
ENV_FILE="$(resolve_env_file)"
PORT="${ADMIN_GATEWAY_PORT:-8300}"
HOST="${ADMIN_GATEWAY_HOST:-0.0.0.0}"

if [[ -z "${PYTHON_BIN}" ]]; then
  echo "Error: python3 not found."
  exit 1
fi

if [[ -z "${UVICORN_BIN}" ]]; then
  echo "Error: uvicorn not found. Install dependencies into .venv first."
  exit 1
fi

EXISTING_PID="$(find_running_pid)"
if [[ -n "${EXISTING_PID}" ]]; then
  echo "gateway-admin already running: PID ${EXISTING_PID}"
  echo "Log file: ${LOG_FILE}"
  exit 0
fi

cd "${APP_DIR}"

if [[ -n "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

nohup "${UVICORN_BIN}" "${APP_MODULE}" --host "${HOST}" --port "${PORT}" > "${LOG_FILE}" 2>&1 &
NEW_PID=$!
echo "${NEW_PID}" > "${PID_FILE}"

sleep 2

if ! kill -0 "${NEW_PID}" >/dev/null 2>&1; then
  echo "gateway-admin failed to start. Check ${LOG_FILE}"
  rm -f "${PID_FILE}"
  exit 1
fi

echo "gateway-admin started"
echo "PID        : ${NEW_PID}"
echo "Host       : ${HOST}"
echo "Port       : ${PORT}"
echo "Health     : http://127.0.0.1:${PORT}/health"
echo "Env file   : ${ENV_FILE:-not set}"
echo "Log file   : ${LOG_FILE}"
echo "PID file   : ${PID_FILE}"
