#!/usr/bin/env bash

if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# scripts/local/* must resolve the repository root with exactly two levels up.
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PID_FILE="${ROOT_DIR}/.local_all_services.pids"

GATEWAY_LOG="${ROOT_DIR}/services/gateway/logs/provider_api.log"
USER_FRONT_LOG="${ROOT_DIR}/services/user-front/frontend_dev.log"
GATEWAY_ADMIN_LOG="${ROOT_DIR}/services/gateway-admin/logs/gateway-admin.log"
ADMIN_FRONT_LOG="${ROOT_DIR}/services/admin-front/admin_front_dev.log"

ACTION="${1:-start}"

find_pid_by_port() {
  local port="$1"
  lsof -t -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

stop_pid() {
  local name="$1"
  local pid="${2:-}"

  if [[ -z "${pid}" ]]; then
    echo "${name}: PID not set, skip"
    return 0
  fi
  if ! kill -0 "${pid}" >/dev/null 2>&1; then
    echo "${name}: already stopped (${pid})"
    return 0
  fi

  kill "${pid}" >/dev/null 2>&1 || true
  sleep 1
  if kill -0 "${pid}" >/dev/null 2>&1; then
    kill -9 "${pid}" >/dev/null 2>&1 || true
    echo "${name}: force killed (${pid})"
  else
    echo "${name}: stopped (${pid})"
  fi
}

stop_port() {
  local name="$1"
  local port="$2"
  local pid
  pid="$(find_pid_by_port "${port}")"
  stop_pid "${name}" "${pid}"
}

wait_for_port() {
  local name="$1"
  local port="$2"
  local timeout_sec="${3:-45}"
  local elapsed=0

  while [[ "${elapsed}" -lt "${timeout_sec}" ]]; do
    if [[ -n "$(find_pid_by_port "${port}")" ]]; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  echo "Error: ${name} did not open port ${port} within ${timeout_sec}s."
  return 1
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local timeout_sec="${3:-45}"
  local elapsed=0

  while [[ "${elapsed}" -lt "${timeout_sec}" ]]; do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  echo "Error: ${name} did not become healthy at ${url} within ${timeout_sec}s."
  return 1
}

ensure_yarn_deps() {
  local app_dir="$1"
  if [[ ! -d "${app_dir}/node_modules" ]]; then
    echo "[local-apps] installing dependencies in ${app_dir#${ROOT_DIR}/}"
    (cd "${app_dir}" && yarn install)
  fi
}

resolve_python_bin() {
  local app_dir="$1"
  if [[ -x "${app_dir}/.venv/bin/python" ]]; then
    echo "${app_dir}/.venv/bin/python"
    return 0
  fi

  local resolver="${ROOT_DIR}/scripts/python/resolve_python_313.sh"
  if [[ -f "${resolver}" ]]; then
    bash "${resolver}"
    return 0
  fi

  command -v python3
}

ensure_gateway_admin_runtime() {
  local app_dir="${ROOT_DIR}/services/gateway-admin"
  local python_bin

  if [[ ! -x "${app_dir}/.venv/bin/python" ]]; then
    python_bin="$(resolve_python_bin "${app_dir}")"
    echo "[local-apps] creating gateway-admin virtualenv with ${python_bin}"
    "${python_bin}" -m venv "${app_dir}/.venv"
  fi

  python_bin="${app_dir}/.venv/bin/python"
  if ! "${python_bin}" -c "import fastapi, psycopg, uvicorn" >/dev/null 2>&1; then
    echo "[local-apps] installing gateway-admin Python dependencies"
    "${python_bin}" -m pip install -r "${app_dir}/requirements.txt"
  fi
}

admin_env_file() {
  if [[ -n "${ADMIN_GATEWAY_ENV_FILE:-}" ]]; then
    echo "${ADMIN_GATEWAY_ENV_FILE}"
    return 0
  fi
  if [[ -f "${ROOT_DIR}/services/gateway-admin/.env.local" ]]; then
    echo "${ROOT_DIR}/services/gateway-admin/.env.local"
    return 0
  fi
  if [[ -f "${ROOT_DIR}/services/gateway-admin/.env" ]]; then
    echo "${ROOT_DIR}/services/gateway-admin/.env"
    return 0
  fi
  echo ""
}

admin_database_dsn() {
  local env_file
  env_file="$(admin_env_file)"
  if [[ -n "${ADMIN_DATABASE_DSN:-}" ]]; then
    printf '%s' "${ADMIN_DATABASE_DSN}"
    return 0
  fi
  if [[ -n "${env_file}" ]]; then
    (
      set -a
      # shellcheck disable=SC1090
      source "${env_file}"
      set +a
      printf '%s' "${ADMIN_DATABASE_DSN:-postgresql://synapse_admin_app:local-dev-admin-app-password@127.0.0.1:5432/synapse_gateway_admin}"
    )
    return 0
  fi
  printf '%s' "postgresql://synapse_admin_app:local-dev-admin-app-password@127.0.0.1:5432/synapse_gateway_admin"
}

admin_migration_dsn() {
  local env_file
  env_file="$(admin_env_file)"
  if [[ -n "${ADMIN_DATABASE_MIGRATION_DSN:-}" ]]; then
    printf '%s' "${ADMIN_DATABASE_MIGRATION_DSN}"
    return 0
  fi
  if [[ -n "${env_file}" ]]; then
    (
      set -a
      # shellcheck disable=SC1090
      source "${env_file}"
      set +a
      printf '%s' "${ADMIN_DATABASE_MIGRATION_DSN:-postgresql://synapse_admin_migrator:local-dev-admin-migrator-password@127.0.0.1:5432/synapse_gateway_admin}"
    )
    return 0
  fi
  printf '%s' "postgresql://synapse_admin_migrator:local-dev-admin-migrator-password@127.0.0.1:5432/synapse_gateway_admin"
}

probe_admin_schema() {
  if ! command -v psql >/dev/null 2>&1; then
    echo "[local-apps] psql not found; cannot probe gateway-admin schema."
    return 1
  fi

  local dsn
  local probe
  dsn="$(admin_database_dsn)"
  probe="$(psql "${dsn}" -X -q -t -A -v ON_ERROR_STOP=1 \
    -c "SELECT COALESCE(to_regclass('public.admin_users')::text, '') || ':' || COALESCE(to_regclass('public.admin_action_audit')::text, '')" 2>/dev/null || true)"

  case "${probe}" in
    *admin_users*:admin_action_audit*|*public.admin_users*:public.admin_action_audit*)
      return 0
      ;;
  esac

  echo "[local-apps] gateway-admin schema is missing or stale."
  echo "[local-apps] Run: npm run dev:migrate"
  return 1
}

migrate_admin_db() {
  ensure_gateway_admin_runtime
  echo "[local-apps] applying gateway-admin DB migrations"
  ADMIN_DATABASE_MIGRATION_DSN="$(admin_migration_dsn)" \
    ADMIN_DATABASE_APP_USER="${ADMIN_DATABASE_APP_USER:-synapse_admin_app}" \
    ADMIN_DATABASE_READONLY_USER="${ADMIN_DATABASE_READONLY_USER:-synapse_admin_ro}" \
    "${ROOT_DIR}/services/gateway-admin/.venv/bin/python" \
    "${ROOT_DIR}/services/gateway-admin/scripts/apply_migrations.py"
}

start_gateway() {
  if [[ -n "$(find_pid_by_port 8000)" ]]; then
    echo "gateway already running on port 8000: PID $(find_pid_by_port 8000)"
    return 0
  fi

  if [[ ! -f "${ROOT_DIR}/services/user-front/src/contract-config.json" ]]; then
    echo "Error: local contract config is missing."
    echo "Run first-time bootstrap once: npm run dev:bootstrap"
    exit 1
  fi

  bash "${SCRIPT_DIR}/restart_gateway.sh"
  wait_for_http "gateway" "http://127.0.0.1:8000/health" 45
}

start_user_front() {
  if [[ -n "$(find_pid_by_port 3000)" ]]; then
    echo "user-front already running on port 3000: PID $(find_pid_by_port 3000)"
    return 0
  fi

  ensure_yarn_deps "${ROOT_DIR}/services/user-front"
  echo "[local-apps] starting user-front on http://127.0.0.1:3000"
  (
    cd "${ROOT_DIR}/services/user-front"
    NEXT_PUBLIC_GATEWAY_BASE_URL="${NEXT_PUBLIC_GATEWAY_BASE_URL:-http://localhost:8000}" \
      nohup yarn dev > "${USER_FRONT_LOG}" 2>&1 < /dev/null &
    echo $!
  ) > /tmp/synapse-user-front.pid
  rm -f /tmp/synapse-user-front.pid
  wait_for_port "user-front" 3000 60
}

start_gateway_admin() {
  if [[ -n "$(find_pid_by_port 8300)" ]]; then
    echo "gateway-admin already running on port 8300: PID $(find_pid_by_port 8300)"
    return 0
  fi

  ensure_gateway_admin_runtime
  probe_admin_schema
  bash "${ROOT_DIR}/services/gateway-admin/scripts/ops/start-local.sh"
  wait_for_http "gateway-admin" "http://127.0.0.1:8300/health" 45
}

start_admin_front() {
  if [[ -n "$(find_pid_by_port 4000)" ]]; then
    echo "admin-front already running on port 4000: PID $(find_pid_by_port 4000)"
    return 0
  fi

  ensure_yarn_deps "${ROOT_DIR}/services/admin-front"
  echo "[local-apps] starting admin-front on http://127.0.0.1:4000"
  (
    cd "${ROOT_DIR}/services/admin-front"
    NEXT_PUBLIC_ADMIN_API_BASE_URL="${NEXT_PUBLIC_ADMIN_API_BASE_URL:-http://localhost:8300}" \
      ADMIN_API_PROXY_TARGET="${ADMIN_API_PROXY_TARGET:-http://localhost:8300}" \
      nohup yarn dev > "${ADMIN_FRONT_LOG}" 2>&1 < /dev/null &
    echo $!
  ) > /tmp/synapse-admin-front.pid
  rm -f /tmp/synapse-admin-front.pid
  wait_for_port "admin-front" 4000 60
}

write_pid_file() {
  cat > "${PID_FILE}" <<EOF
GATEWAY_PID=$(find_pid_by_port 8000)
USER_FRONT_PID=$(find_pid_by_port 3000)
GATEWAY_ADMIN_PID=$(find_pid_by_port 8300)
ADMIN_FRONT_PID=$(find_pid_by_port 4000)
EOF
}

print_status_line() {
  local name="$1"
  local port="$2"
  local url="$3"
  local pid
  pid="$(find_pid_by_port "${port}")"
  if [[ -n "${pid}" ]]; then
    printf '%-16s running  pid=%-8s %s\n' "${name}" "${pid}" "${url}"
  else
    printf '%-16s stopped  port=%-6s %s\n' "${name}" "${port}" "${url}"
  fi
}

start_apps() {
  echo "=== Starting Synapse local app services ==="
  echo "[local-apps] This starts only the 4 app services. It does not create DBs or redeploy contracts."
  start_gateway
  start_gateway_admin
  start_user_front
  start_admin_front
  write_pid_file
  status_apps
}

stop_apps() {
  echo "=== Stopping Synapse local app services ==="
  stop_port "admin-front" 4000
  stop_port "gateway-admin" 8300
  stop_port "user-front" 3000
  stop_port "gateway" 8000
  rm -f "${PID_FILE}"
  echo "Done."
}

status_apps() {
  echo "=== Synapse local app service status ==="
  print_status_line "gateway" 8000 "http://127.0.0.1:8000/health"
  print_status_line "gateway-admin" 8300 "http://127.0.0.1:8300/health"
  print_status_line "user-front" 3000 "http://127.0.0.1:3000"
  print_status_line "admin-front" 4000 "http://127.0.0.1:4000/login"
  echo ""
  echo "Infra status:"
  print_status_line "postgres" 5432 "postgresql://127.0.0.1:5432"
  print_status_line "anvil" 8545 "http://127.0.0.1:8545"
}

tail_logs() {
  mkdir -p \
    "${ROOT_DIR}/services/gateway/logs" \
    "${ROOT_DIR}/services/gateway-admin/logs"
  touch "${GATEWAY_LOG}" "${USER_FRONT_LOG}" "${GATEWAY_ADMIN_LOG}" "${ADMIN_FRONT_LOG}"
  tail -f "${GATEWAY_LOG}" "${GATEWAY_ADMIN_LOG}" "${USER_FRONT_LOG}" "${ADMIN_FRONT_LOG}"
}

case "${ACTION}" in
  start)
    start_apps
    ;;
  stop)
    stop_apps
    ;;
  restart)
    stop_apps
    start_apps
    ;;
  status)
    status_apps
    ;;
  logs)
    tail_logs
    ;;
  migrate)
    migrate_admin_db
    ;;
  bootstrap)
    bash "${SCRIPT_DIR}/setup_local_env.sh"
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs|migrate|bootstrap}"
    exit 2
    ;;
esac
