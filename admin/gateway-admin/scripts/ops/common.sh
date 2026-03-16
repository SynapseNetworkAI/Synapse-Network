#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LOG_DIR="${APP_DIR}/logs"
RUN_DIR="${APP_DIR}/run"
PID_FILE="${RUN_DIR}/gateway-admin.pid"
LOG_FILE="${LOG_DIR}/gateway-admin.log"
ENV_FILE_DEFAULT="${APP_DIR}/.env.local"
ENV_FILE_FALLBACK="${APP_DIR}/.env"
APP_MODULE="src.app:app"

find_pid_by_port() {
  local port="$1"
  lsof -t -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

find_running_pid() {
  if [[ -f "${PID_FILE}" ]]; then
    local pid
    pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      echo "${pid}"
      return 0
    fi
  fi

  local port
  port="${ADMIN_GATEWAY_PORT:-8300}"
  find_pid_by_port "${port}"
}

resolve_python_bin() {
  if [[ -x "${APP_DIR}/.venv/bin/python" ]]; then
    echo "${APP_DIR}/.venv/bin/python"
    return 0
  fi
  command -v python3
}

resolve_uvicorn_bin() {
  if [[ -x "${APP_DIR}/.venv/bin/uvicorn" ]]; then
    echo "${APP_DIR}/.venv/bin/uvicorn"
    return 0
  fi
  command -v uvicorn
}

resolve_env_file() {
  if [[ -n "${ADMIN_GATEWAY_ENV_FILE:-}" ]]; then
    echo "${ADMIN_GATEWAY_ENV_FILE}"
    return 0
  fi
  if [[ -f "${ENV_FILE_DEFAULT}" ]]; then
    echo "${ENV_FILE_DEFAULT}"
    return 0
  fi
  if [[ -f "${ENV_FILE_FALLBACK}" ]]; then
    echo "${ENV_FILE_FALLBACK}"
    return 0
  fi
  echo ""
}

ensure_runtime_dirs() {
  mkdir -p "${LOG_DIR}" "${RUN_DIR}"
}

stop_pid() {
  local pid="$1"
  if [[ -z "${pid}" ]]; then
    return 0
  fi
  if ! kill -0 "${pid}" >/dev/null 2>&1; then
    return 0
  fi

  kill "${pid}" >/dev/null 2>&1 || true
  sleep 1
  if kill -0 "${pid}" >/dev/null 2>&1; then
    kill -9 "${pid}" >/dev/null 2>&1 || true
  fi
}
