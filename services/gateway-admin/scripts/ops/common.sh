#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPO_ROOT="$(cd "${APP_DIR}/../.." && pwd)"
LOG_DIR="${APP_DIR}/logs"
RUN_DIR="${APP_DIR}/run"
PID_FILE="${RUN_DIR}/gateway-admin.pid"
LOG_FILE="${LOG_DIR}/gateway-admin.log"
ENV_FILE_DEFAULT="${APP_DIR}/.env.local"
STAGING_ENV_FILE_DEFAULT="${APP_DIR}/.env.staging"
ENV_FILE_FALLBACK="${APP_DIR}/.env"
PROD_ENV_FILE_DEFAULT="/etc/synapse/gateway-admin.env"
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
  bash "${REPO_ROOT}/scripts/python/resolve_python_313.sh"
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

resolve_local_env_file() {
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

resolve_staging_env_file() {
  if [[ -n "${ADMIN_GATEWAY_ENV_FILE:-}" ]]; then
    echo "${ADMIN_GATEWAY_ENV_FILE}"
    return 0
  fi
  if [[ -f "${STAGING_ENV_FILE_DEFAULT}" ]]; then
    echo "${STAGING_ENV_FILE_DEFAULT}"
    return 0
  fi
  if [[ -f "${ENV_FILE_FALLBACK}" ]]; then
    echo "${ENV_FILE_FALLBACK}"
    return 0
  fi
  echo ""
}

resolve_prod_env_file() {
  if [[ -n "${ADMIN_GATEWAY_ENV_FILE:-}" ]]; then
    echo "${ADMIN_GATEWAY_ENV_FILE}"
    return 0
  fi
  if [[ -f "${PROD_ENV_FILE_DEFAULT}" ]]; then
    echo "${PROD_ENV_FILE_DEFAULT}"
    return 0
  fi
  echo ""
}

start_gateway_admin() {
  local env_file="$1"
  local mode_label="$2"

  ensure_runtime_dirs

  local python_bin
  local uvicorn_bin
  local port
  local host
  local existing_pid
  local new_pid

  python_bin="$(resolve_python_bin)"
  uvicorn_bin="$(resolve_uvicorn_bin)"
  port="${ADMIN_GATEWAY_PORT:-8300}"
  host="${ADMIN_GATEWAY_HOST:-0.0.0.0}"

  if [[ -z "${python_bin}" ]]; then
    echo "Error: python3 not found."
    exit 1
  fi

  if [[ -z "${uvicorn_bin}" ]]; then
    echo "Error: uvicorn not found. Install dependencies into .venv first."
    exit 1
  fi

  existing_pid="$(find_running_pid)"
  if [[ -n "${existing_pid}" ]]; then
    echo "gateway-admin already running: PID ${existing_pid}"
    echo "Log file: ${LOG_FILE}"
    exit 0
  fi

  cd "${APP_DIR}"

  if [[ -n "${env_file}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${env_file}"
    set +a
    port="${ADMIN_GATEWAY_PORT:-$port}"
    host="${ADMIN_GATEWAY_HOST:-$host}"
  fi

  nohup "${uvicorn_bin}" "${APP_MODULE}" --host "${host}" --port "${port}" > "${LOG_FILE}" 2>&1 &
  new_pid=$!
  echo "${new_pid}" > "${PID_FILE}"

  sleep 2

  if ! kill -0 "${new_pid}" >/dev/null 2>&1; then
    echo "gateway-admin failed to start. Check ${LOG_FILE}"
    rm -f "${PID_FILE}"
    exit 1
  fi

  echo "gateway-admin started (${mode_label})"
  echo "PID        : ${new_pid}"
  echo "Host       : ${host}"
  echo "Port       : ${port}"
  echo "Health     : http://127.0.0.1:${port}/health"
  echo "Env file   : ${env_file:-not set}"
  echo "Log file   : ${LOG_FILE}"
  echo "PID file   : ${PID_FILE}"
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
