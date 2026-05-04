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
DOCS_FRONT_LOG="${ROOT_DIR}/services/docs-front/docs_front_dev.log"
GATEWAY_ADMIN_LOG="${ROOT_DIR}/services/gateway-admin/logs/gateway-admin.log"
ADMIN_FRONT_LOG="${ROOT_DIR}/services/admin-front/admin_front_dev.log"

ACTION="${1:-start}"
ADMIN_SCHEMA_MIGRATED=0

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
  local last_error=""

  while [[ "${elapsed}" -lt "${timeout_sec}" ]]; do
    last_error="$(curl -fsS "${url}" 2>&1 >/dev/null || true)"
    if [[ -z "${last_error}" ]]; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  echo "Error: ${name} did not become healthy at ${url} within ${timeout_sec}s."
  if [[ -n "${last_error}" ]]; then
    echo "Last health check error: ${last_error}"
  fi
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
      printf '%s' "${ADMIN_DATABASE_DSN:-postgresql://synapse_admin_app:local-dev-admin-app-password@127.0.0.1:15432/synapse_gateway_admin}"
    )
    return 0
  fi
  printf '%s' "postgresql://synapse_admin_app:local-dev-admin-app-password@127.0.0.1:15432/synapse_gateway_admin"
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
      printf '%s' "${ADMIN_DATABASE_MIGRATION_DSN:-postgresql://synapse_admin_migrator:local-dev-admin-migrator-password@127.0.0.1:15432/synapse_gateway_admin}"
    )
    return 0
  fi
  printf '%s' "postgresql://synapse_admin_migrator:local-dev-admin-migrator-password@127.0.0.1:15432/synapse_gateway_admin"
}

admin_superuser_migration_dsn() {
  printf '%s' "${ADMIN_DATABASE_LOCAL_SUPERUSER_DSN:-postgresql://synapse:local-dev-postgres-password@127.0.0.1:15432/synapse_gateway_admin}"
}

sanitize_admin_dsn_for_log() {
  local dsn="$1"
  python3 - "${dsn}" <<'PY'
import sys
from urllib.parse import urlsplit, urlunsplit

dsn = sys.argv[1]
try:
    parts = urlsplit(dsn)
except Exception:
    print("<invalid-dsn>")
    raise SystemExit(0)

netloc = parts.hostname or ""
if parts.username:
    netloc = f"{parts.username}:***@{netloc}"
if parts.port:
    netloc = f"{netloc}:{parts.port}"
print(urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment)))
PY
}

assert_local_admin_migration_dsn() {
  local dsn="$1"
  python3 - "${dsn}" <<'PY'
import sys
from urllib.parse import urlsplit

dsn = sys.argv[1]
parts = urlsplit(dsn)
host = (parts.hostname or "").lower()
dbname = parts.path.lstrip("/")
port = parts.port

allowed_hosts = {"127.0.0.1", "localhost", "::1"}
if host not in allowed_hosts or dbname != "synapse_gateway_admin" or port != 15432:
    print(
        "[local-apps] Refusing to auto-migrate gateway-admin schema: "
        "ADMIN_DATABASE_MIGRATION_DSN must point to Docker local synapse_gateway_admin."
    )
    print(
        f"[local-apps] Parsed host={host or '<missing>'} "
        f"port={port or '<missing>'} db={dbname or '<missing>'}"
    )
    print(
        "[local-apps] Expected: "
        "postgresql://synapse_admin_migrator:***@127.0.0.1:15432/synapse_gateway_admin"
    )
    raise SystemExit(1)
PY
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
    -c "SELECT CASE WHEN to_regclass('public.admin_users') IS NOT NULL AND to_regclass('public.admin_action_audit') IS NOT NULL THEN 'ready' ELSE 'admin_users=' || COALESCE(to_regclass('public.admin_users')::text, '') || ' admin_action_audit=' || COALESCE(to_regclass('public.admin_action_audit')::text, '') END" 2>/dev/null || true)"

  case "${probe}" in
    ready)
      return 0
      ;;
  esac

  echo "[local-apps] gateway-admin schema is missing or stale."
  echo "[local-apps] Probe result: ${probe:-empty}"
  echo "[local-apps] App DSN: $(sanitize_admin_dsn_for_log "$(admin_database_dsn)")"
  return 1
}

migrate_admin_db() {
  ensure_gateway_admin_runtime
  local migration_dsn
  local migration_output
  local fallback_dsn
  migration_dsn="$(admin_migration_dsn)"
  assert_local_admin_migration_dsn "${migration_dsn}"
  echo "[local-apps] applying gateway-admin DB migrations"
  echo "[local-apps] Migration DSN: $(sanitize_admin_dsn_for_log "${migration_dsn}")"
  if migration_output="$(ADMIN_DATABASE_MIGRATION_DSN="${migration_dsn}" \
      ADMIN_DATABASE_APP_USER="${ADMIN_DATABASE_APP_USER:-synapse_admin_app}" \
      ADMIN_DATABASE_READONLY_USER="${ADMIN_DATABASE_READONLY_USER:-synapse_admin_ro}" \
      "${ROOT_DIR}/services/gateway-admin/.venv/bin/python" \
      "${ROOT_DIR}/services/gateway-admin/scripts/apply_migrations.py" 2>&1)"; then
    printf '%s\n' "${migration_output}"
    return 0
  fi

  printf '%s\n' "${migration_output}"
  if ! grep -q "lacks CREATE privileges" <<<"${migration_output}"; then
    return 1
  fi

  fallback_dsn="$(admin_superuser_migration_dsn)"
  assert_local_admin_migration_dsn "${fallback_dsn}"
  echo "[local-apps] migrator lacks DDL privileges; retrying with local Docker Postgres owner"
  echo "[local-apps] Fallback DSN: $(sanitize_admin_dsn_for_log "${fallback_dsn}")"
  ADMIN_DATABASE_MIGRATION_DSN="${fallback_dsn}" \
    ADMIN_DATABASE_APP_USER="${ADMIN_DATABASE_APP_USER:-synapse_admin_app}" \
    ADMIN_DATABASE_READONLY_USER="${ADMIN_DATABASE_READONLY_USER:-synapse_admin_ro}" \
    "${ROOT_DIR}/services/gateway-admin/.venv/bin/python" \
    "${ROOT_DIR}/services/gateway-admin/scripts/apply_migrations.py"
}

ensure_admin_schema() {
  if probe_admin_schema; then
    return 0
  fi

  echo "[local-apps] attempting local-only gateway-admin schema self-heal"
  migrate_admin_db
  ADMIN_SCHEMA_MIGRATED=1

  if probe_admin_schema; then
    echo "[local-apps] gateway-admin schema is ready after local migration"
    return 0
  fi

  echo "[local-apps] gateway-admin schema is still missing or stale after migration."
  echo "[local-apps] Manual fix command: npm run dev:migrate"
  echo "[local-apps] If gateway-admin is already running, restart it after the migration."
  return 1
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
    wait_for_http "user-front" "http://127.0.0.1:3000/dashboard/account/settings" 120
    return 0
  fi

  ensure_yarn_deps "${ROOT_DIR}/services/user-front"
  echo "[local-apps] starting user-front on http://localhost:3000"
  if command -v screen >/dev/null 2>&1; then
    screen -S synapse-user-front -X quit >/dev/null 2>&1 || true
    screen -dmS synapse-user-front bash -lc \
      "cd '${ROOT_DIR}/services/user-front' && exec env NEXT_PUBLIC_APP_ENV='${NEXT_PUBLIC_APP_ENV:-local}' NEXT_PUBLIC_GATEWAY_BASE_URL='${NEXT_PUBLIC_GATEWAY_BASE_URL:-http://127.0.0.1:8000}' NEXT_PUBLIC_ANALYTICS_ENDPOINT='${NEXT_PUBLIC_ANALYTICS_ENDPOINT:-http://127.0.0.1:8000/api/v1/events}' NEXT_PUBLIC_DOCS_BASE_URL='${NEXT_PUBLIC_DOCS_BASE_URL:-http://localhost:3100}' NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS='${NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS:-20000}' NEXT_PUBLIC_SUPPORT_EMAIL='${NEXT_PUBLIC_SUPPORT_EMAIL:-support@synapse-network.ai}' NEXT_PUBLIC_SUPPORT_PORTAL_URL='${NEXT_PUBLIC_SUPPORT_PORTAL_URL:-}' yarn dev --hostname 0.0.0.0 > '${USER_FRONT_LOG}' 2>&1"
  else
    (
      cd "${ROOT_DIR}/services/user-front"
      nohup bash -lc 'trap "" HUP; exec env NEXT_PUBLIC_APP_ENV="${NEXT_PUBLIC_APP_ENV:-local}" NEXT_PUBLIC_GATEWAY_BASE_URL="${NEXT_PUBLIC_GATEWAY_BASE_URL:-http://127.0.0.1:8000}" NEXT_PUBLIC_ANALYTICS_ENDPOINT="${NEXT_PUBLIC_ANALYTICS_ENDPOINT:-http://127.0.0.1:8000/api/v1/events}" NEXT_PUBLIC_DOCS_BASE_URL="${NEXT_PUBLIC_DOCS_BASE_URL:-http://localhost:3100}" NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS="${NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS:-20000}" NEXT_PUBLIC_SUPPORT_EMAIL="${NEXT_PUBLIC_SUPPORT_EMAIL:-support@synapse-network.ai}" NEXT_PUBLIC_SUPPORT_PORTAL_URL="${NEXT_PUBLIC_SUPPORT_PORTAL_URL:-}" yarn dev --hostname 0.0.0.0' \
        > "${USER_FRONT_LOG}" 2>&1 < /dev/null &
      echo $!
    ) > /tmp/synapse-user-front.pid
    rm -f /tmp/synapse-user-front.pid
  fi
  wait_for_http "user-front" "http://127.0.0.1:3000/dashboard/account/settings" 120 || {
    echo "[local-apps] user-front failed to become healthy. Recent log:"
    tail -n 80 "${USER_FRONT_LOG}" 2>/dev/null || true
    return 1
  }
  sleep 3
  if [[ -z "$(find_pid_by_port 3000)" ]]; then
    echo "[local-apps] user-front became healthy but exited immediately. Recent log:"
    tail -n 80 "${USER_FRONT_LOG}" 2>/dev/null || true
    return 1
  fi
}

start_docs_front() {
  if [[ -n "$(find_pid_by_port 3100)" ]]; then
    echo "docs-front already running on port 3100: PID $(find_pid_by_port 3100)"
    wait_for_http "docs-front" "http://127.0.0.1:3100/smart-contracts" 120
    return 0
  fi

  ensure_yarn_deps "${ROOT_DIR}/services/docs-front"
  echo "[local-apps] starting docs-front on http://localhost:3100"
  if command -v screen >/dev/null 2>&1; then
    screen -S synapse-docs-front -X quit >/dev/null 2>&1 || true
    screen -dmS synapse-docs-front bash -lc \
      "cd '${ROOT_DIR}/services/docs-front' && exec env NEXT_PUBLIC_APP_ENV='${NEXT_PUBLIC_APP_ENV:-local}' NEXT_PUBLIC_DOCS_BASE_URL='${NEXT_PUBLIC_DOCS_BASE_URL:-http://localhost:3100}' NEXT_PUBLIC_CONSOLE_BASE_URL='${NEXT_PUBLIC_CONSOLE_BASE_URL:-http://localhost:3000/dashboard/overview}' NEXT_PUBLIC_GATEWAY_BASE_URL='${NEXT_PUBLIC_GATEWAY_BASE_URL:-http://127.0.0.1:8000}' yarn dev --hostname 0.0.0.0 > '${DOCS_FRONT_LOG}' 2>&1"
  else
    (
      cd "${ROOT_DIR}/services/docs-front"
      nohup bash -lc 'trap "" HUP; exec env NEXT_PUBLIC_APP_ENV="${NEXT_PUBLIC_APP_ENV:-local}" NEXT_PUBLIC_DOCS_BASE_URL="${NEXT_PUBLIC_DOCS_BASE_URL:-http://localhost:3100}" NEXT_PUBLIC_CONSOLE_BASE_URL="${NEXT_PUBLIC_CONSOLE_BASE_URL:-http://localhost:3000/dashboard/overview}" NEXT_PUBLIC_GATEWAY_BASE_URL="${NEXT_PUBLIC_GATEWAY_BASE_URL:-http://127.0.0.1:8000}" yarn dev --hostname 0.0.0.0' \
        > "${DOCS_FRONT_LOG}" 2>&1 < /dev/null &
      echo $!
    ) > /tmp/synapse-docs-front.pid
    rm -f /tmp/synapse-docs-front.pid
  fi
  wait_for_http "docs-front" "http://127.0.0.1:3100/smart-contracts" 120 || {
    echo "[local-apps] docs-front failed to become healthy. Recent log:"
    tail -n 80 "${DOCS_FRONT_LOG}" 2>/dev/null || true
    return 1
  }
  sleep 3
  if [[ -z "$(find_pid_by_port 3100)" ]]; then
    echo "[local-apps] docs-front became healthy but exited immediately. Recent log:"
    tail -n 80 "${DOCS_FRONT_LOG}" 2>/dev/null || true
    return 1
  fi
}

start_gateway_admin() {
  ensure_gateway_admin_runtime
  ensure_admin_schema

  if [[ -n "$(find_pid_by_port 8300)" ]]; then
    echo "gateway-admin already running on port 8300: PID $(find_pid_by_port 8300)"
    if [[ "${ADMIN_SCHEMA_MIGRATED}" == "1" ]]; then
      echo "[local-apps] gateway-admin schema was migrated while the service was already running."
      echo "[local-apps] Restart gateway-admin if login, review, or admin API errors persist."
    fi
    return 0
  fi

  bash "${ROOT_DIR}/services/gateway-admin/scripts/ops/start-local.sh"
  wait_for_http "gateway-admin" "http://127.0.0.1:8300/health" 45
}

start_admin_front() {
  if [[ -n "$(find_pid_by_port 3200)" ]]; then
    echo "admin-front already running on port 3200: PID $(find_pid_by_port 3200)"
    return 0
  fi

  ensure_yarn_deps "${ROOT_DIR}/services/admin-front"
  echo "[local-apps] starting admin-front on http://127.0.0.1:3200"
  (
    cd "${ROOT_DIR}/services/admin-front"
    ADMIN_API_PROXY_TARGET="${ADMIN_API_PROXY_TARGET:-http://localhost:8300}" \
      nohup yarn dev > "${ADMIN_FRONT_LOG}" 2>&1 < /dev/null &
    echo $!
  ) > /tmp/synapse-admin-front.pid
  rm -f /tmp/synapse-admin-front.pid
  wait_for_http "admin-front" "http://127.0.0.1:3200/login" 120 || {
    echo "[local-apps] admin-front failed to become healthy. Recent log:"
    tail -n 80 "${ADMIN_FRONT_LOG}" 2>/dev/null || true
    return 1
  }
}

write_pid_file() {
  cat > "${PID_FILE}" <<EOF
GATEWAY_PID=$(find_pid_by_port 8000)
USER_FRONT_PID=$(find_pid_by_port 3000)
DOCS_FRONT_PID=$(find_pid_by_port 3100)
GATEWAY_ADMIN_PID=$(find_pid_by_port 8300)
ADMIN_FRONT_PID=$(find_pid_by_port 3200)
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
  echo "[local-apps] This starts only the 5 app services. It does not create DBs or redeploy contracts."
  start_gateway
  start_gateway_admin
  start_user_front
  start_docs_front
  start_admin_front
  write_pid_file
  status_apps
}

stop_apps() {
  echo "=== Stopping Synapse local app services ==="
  stop_port "admin-front" 3200
  stop_port "docs-front" 3100
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
  print_status_line "user-front" 3000 "http://localhost:3000"
  print_status_line "docs-front" 3100 "http://localhost:3100/smart-contracts"
  print_status_line "admin-front" 3200 "http://127.0.0.1:3200/login"
  echo ""
  echo "Infra status:"
  print_status_line "postgres" 15432 "postgresql://127.0.0.1:15432"
  print_status_line "redis" 6379 "redis://127.0.0.1:6379"
  print_status_line "minio" 9001 "http://127.0.0.1:9001"
  print_status_line "otterscan" 5100 "http://localhost:5100"
  print_status_line "anvil" 8545 "http://127.0.0.1:8545"
}

tail_logs() {
  mkdir -p \
    "${ROOT_DIR}/services/gateway/logs" \
    "${ROOT_DIR}/services/gateway-admin/logs"
  touch "${GATEWAY_LOG}" "${USER_FRONT_LOG}" "${DOCS_FRONT_LOG}" "${GATEWAY_ADMIN_LOG}" "${ADMIN_FRONT_LOG}"
  tail -f "${GATEWAY_LOG}" "${GATEWAY_ADMIN_LOG}" "${USER_FRONT_LOG}" "${DOCS_FRONT_LOG}" "${ADMIN_FRONT_LOG}"
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
