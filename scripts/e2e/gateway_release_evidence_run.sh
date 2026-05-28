#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODE="${GATEWAY_RELEASE_E2E_ENV:-${1:-local}}"
PROFILE="${GATEWAY_RELEASE_E2E_PROFILE:-full}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${GATEWAY_RELEASE_E2E_OUT_DIR:-${ROOT_DIR}/docs/evidence/release/gateway-fullchain/${TIMESTAMP}-${MODE}}"
LOG_FILE="${OUT_DIR}/gateway-e2e.log"
COMPOSE_FILE="${ROOT_DIR}/infra/docker/local/docker-compose.yml"
PYTHON_BIN="${ROOT_DIR}/services/gateway/.venv/bin/python"
PROVIDER_FIXTURE_PID=""
GATEWAY_RELEASE_PID=""
POSTGRES_PORT="${GATEWAY_RELEASE_E2E_POSTGRES_PORT:-}"
POSTGRES_DB_NAME="${GATEWAY_RELEASE_E2E_POSTGRES_DB:-synapse_gateway_release_$(printf '%s' "$TIMESTAMP" | tr '[:upper:]' '[:lower:]')}"

mkdir -p "$OUT_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "[gateway-release-e2e] mode=${MODE}"
echo "[gateway-release-e2e] profile=${PROFILE}"
echo "[gateway-release-e2e] evidence=${OUT_DIR}"

if [[ "$PROFILE" != "full" && "$PROFILE" != "mvp-postgres" ]]; then
  echo "FATAL: unsupported GATEWAY_RELEASE_E2E_PROFILE=${PROFILE}. Use full or mvp-postgres." >&2
  exit 1
fi

find_pid_by_port() {
  lsof -t -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

stop_pid() {
  local name="$1"
  local pid="${2:-}"
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
    echo "[gateway-release-e2e] stopped ${name} (${pid})"
  fi
}

cleanup() {
  stop_pid "release gateway" "$GATEWAY_RELEASE_PID"
  stop_pid "provider fixture" "$PROVIDER_FIXTURE_PID"
}
trap cleanup EXIT

resolve_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
    return 0
  fi
  echo "FATAL: docker compose or docker-compose is required" >&2
  return 1
}

wait_for_http() {
  local url="$1"
  local timeout_sec="${2:-60}"
  local elapsed=0
  while [[ "$elapsed" -lt "$timeout_sec" ]]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  echo "FATAL: timed out waiting for ${url}" >&2
  return 1
}

wait_for_kafka() {
  local timeout_sec="${1:-90}"
  local elapsed=0
  while [[ "$elapsed" -lt "$timeout_sec" ]]; do
    if docker exec synapse-kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  echo "FATAL: timed out waiting for Kafka" >&2
  return 1
}

require_env_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "FATAL: ${name} is required for staging gateway release evidence" >&2
    return 1
  fi
}

require_staging_env() {
  local required=(
    GATEWAY_E2E_GATEWAY_BASE
    GATEWAY_E2E_PROVIDER_BASE
    GATEWAY_E2E_RPC_URL
    GATEWAY_E2E_CONTRACT_CONFIG_PATH
    GATEWAY_E2E_DEPLOYER_KEY
    GATEWAY_E2E_OWNER_KEY
    GATEWAY_E2E_PROVIDER_KEY
    GATEWAY_E2E_INTERNAL_TRIGGER_SECRET
    POSTGRES_DSN
  )
  if [[ "$PROFILE" != "mvp-postgres" ]]; then
    required+=(
      ANALYTICS_CLICKHOUSE_URL
      ANALYTICS_KAFKA_BOOTSTRAP_SERVERS
    )
  fi
  for name in "${required[@]}"; do
    require_env_var "$name"
  done
}

probe_postgres_server() {
  local port="$1"
  PGPASSWORD=local-dev-postgres-password psql \
    -h 127.0.0.1 \
    -p "$port" \
    -U synapse \
    -d postgres \
    -X -q -t -A \
    -c "SELECT current_user" \
    2>/dev/null | grep -Eq '^synapse$'
}

probe_synapse_postgres() {
  local port="$1"
  PGPASSWORD=local-dev-postgres-password psql \
    -h 127.0.0.1 \
    -p "$port" \
    -U synapse \
    -d "$POSTGRES_DB_NAME" \
    -X -q -t -A \
    -c "SELECT current_user || ':' || COALESCE(to_regclass('public.synapse_owner_accounts')::text, '')" \
    2>/dev/null | grep -Eq '^synapse:(public\.)?synapse_owner_accounts$'
}

wait_for_synapse_postgres() {
  local port="$1"
  local timeout_sec="${2:-60}"
  local elapsed=0
  while [[ "$elapsed" -lt "$timeout_sec" ]]; do
    if probe_synapse_postgres "$port"; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  echo "FATAL: timed out waiting for Synapse Postgres on 127.0.0.1:${port}" >&2
  return 1
}

repair_synapse_postgres_password() {
  if ! docker exec synapse-postgres psql \
    -U synapse \
    -d postgres \
    -v ON_ERROR_STOP=1 \
    -c "ALTER ROLE synapse WITH PASSWORD 'local-dev-postgres-password';" >/dev/null 2>&1; then
    return 1
  fi
  echo "[gateway-release-e2e] repaired local synapse Postgres password for host release runner"
}

choose_local_postgres_port() {
  if [[ -n "$POSTGRES_PORT" ]]; then
    return 0
  fi
  POSTGRES_PORT=15432
  echo "[gateway-release-e2e] using Docker Postgres on 127.0.0.1:${POSTGRES_PORT} for local release evidence"
}

start_provider_fixture() {
  if [[ -n "$(find_pid_by_port 8001)" ]]; then
    echo "[gateway-release-e2e] provider fixture: port 8001 already occupied, reusing"
    return
  fi
  cat > "${OUT_DIR}/provider_fixture.py" <<'PY'
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):  # noqa: A002
        return

    def _ok(self):
        body = b'{"status":"healthy","provider":"gateway-release-e2e"}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._ok()

    def do_POST(self):
        self._ok()


HTTPServer(("127.0.0.1", 8001), Handler).serve_forever()
PY
  "$PYTHON_BIN" "${OUT_DIR}/provider_fixture.py" &
  PROVIDER_FIXTURE_PID=$!
  wait_for_http "http://127.0.0.1:8001/health" 15
}

start_gateway_strict_kafka() {
  local existing_gateway_pid
  existing_gateway_pid="$(find_pid_by_port 8000)"
  stop_pid "gateway" "$existing_gateway_pid"

  local config_file="${ROOT_DIR}/services/user-front/src/contract-config.json"
  local router_address
  router_address="$(node -e "const c=require('${config_file}'); process.stdout.write(c.SynapseCore || '')")"
  local dsn="${POSTGRES_DSN:-postgresql://synapse:local-dev-postgres-password@127.0.0.1:${POSTGRES_PORT:-15432}/${POSTGRES_DB_NAME}}"
  dsn="${dsn/@postgres:/@127.0.0.1:}"

  (
    cd "${ROOT_DIR}/services/gateway"
    env \
      ENVIRONMENT=staging \
      ENV_FILE=.env.local \
      GATEWAY_RELOAD=false \
      POSTGRES_DSN="$dsn" \
      INTERNAL_TRIGGER_SECRET="${GATEWAY_E2E_INTERNAL_TRIGGER_SECRET:-release-e2e-internal-trigger}" \
      RPC_URL="${GATEWAY_E2E_RPC_URL:-http://127.0.0.1:8545}" \
      ROUTER_ADDRESS="$router_address" \
      ANALYTICS_STRICT_KAFKA=true \
      ANALYTICS_KAFKA_BOOTSTRAP_SERVERS="${ANALYTICS_KAFKA_BOOTSTRAP_SERVERS:-localhost:9092}" \
      ANALYTICS_KAFKA_TOPIC="${ANALYTICS_KAFKA_TOPIC:-synapse.analytics.events}" \
      ANALYTICS_FALLBACK_FILE="${OUT_DIR}/analytics-fallback-forbidden.jsonl" \
      "$PYTHON_BIN" gateway_fastapi.py > "${OUT_DIR}/gateway-release-process.log" 2>&1 < /dev/null &
    echo $! > "${OUT_DIR}/gateway-release.pid"
  )
  GATEWAY_RELEASE_PID="$(cat "${OUT_DIR}/gateway-release.pid")"
  echo "[gateway-release-e2e] strict Kafka gateway pid=${GATEWAY_RELEASE_PID}"
  wait_for_http "http://127.0.0.1:8000/health" 30
}

prepare_local() {
  local compose_cmd
  compose_cmd="$(resolve_compose_cmd)"
  choose_local_postgres_port
  echo "[gateway-release-e2e] starting local postgres/redis/kafka/clickhouse (postgres_port=${POSTGRES_PORT}, postgres_db=${POSTGRES_DB_NAME})"
  SYNAPSE_POSTGRES_HOST_PORT="$POSTGRES_PORT" ${compose_cmd} -f "$COMPOSE_FILE" up -d postgres redis kafka clickhouse >/dev/null
  if ! probe_postgres_server "$POSTGRES_PORT"; then
    repair_synapse_postgres_password || true
  fi
  if ! probe_postgres_server "$POSTGRES_PORT"; then
    echo "FATAL: local Synapse Postgres is not reachable on 127.0.0.1:${POSTGRES_PORT}" >&2
    return 1
  fi
  wait_for_http "http://127.0.0.1:8123/ping" 120
  wait_for_kafka 120

  echo "[gateway-release-e2e] running local chain/gateway bootstrap"
  POSTGRES_DSN="postgresql://synapse:local-dev-postgres-password@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB_NAME}" \
    LOCAL_GATEWAY_POSTGRES_DSN="postgresql://synapse:local-dev-postgres-password@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB_NAME}" \
    LOCAL_POSTGRES_BOOTSTRAP_USER=synapse \
    LOCAL_POSTGRES_BOOTSTRAP_PASSWORD=local-dev-postgres-password \
    PGHOST=127.0.0.1 \
    PGPORT="$POSTGRES_PORT" \
    POSTGRES_USER=synapse \
    POSTGRES_PASSWORD=local-dev-postgres-password \
    POSTGRES_DB="$POSTGRES_DB_NAME" \
    SYNAPSE_GATEWAY_DB="$POSTGRES_DB_NAME" \
    bash "${ROOT_DIR}/scripts/local/setup_local_env.sh"
  wait_for_synapse_postgres "$POSTGRES_PORT" 30
  start_provider_fixture
  start_gateway_strict_kafka
}

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "FATAL: gateway virtualenv missing at ${PYTHON_BIN}" >&2
  exit 1
fi

if [[ "$MODE" == "local" ]]; then
  prepare_local
elif [[ "$MODE" == "staging" ]]; then
  echo "[gateway-release-e2e] staging mode: using externally provided services"
  require_staging_env
else
  echo "FATAL: unsupported GATEWAY_RELEASE_E2E_ENV=${MODE}. Use local or staging." >&2
  exit 1
fi

export GATEWAY_RELEASE_E2E=true
if [[ "$PROFILE" == "mvp-postgres" ]]; then
  export ANALYTICS_FULLCHAIN_E2E=false
  export ANALYTICS_TEST_E2E=false
  export ANALYTICS_TRANSPORT="${ANALYTICS_TRANSPORT:-outbox}"
  export ANALYTICS_STRICT_KAFKA=false
else
  export ANALYTICS_FULLCHAIN_E2E=true
  export ANALYTICS_TEST_E2E=true
fi
export ANALYTICS_KAFKA_TOPIC="${ANALYTICS_KAFKA_TOPIC:-synapse.analytics.events}"
if [[ "$MODE" == "local" ]]; then
  export ANALYTICS_CLICKHOUSE_URL="${ANALYTICS_CLICKHOUSE_URL:-http://127.0.0.1:8123}"
  export ANALYTICS_KAFKA_BOOTSTRAP_SERVERS="${ANALYTICS_KAFKA_BOOTSTRAP_SERVERS:-localhost:9092}"
  export GATEWAY_E2E_GATEWAY_BASE="${GATEWAY_E2E_GATEWAY_BASE:-http://127.0.0.1:8000}"
  export GATEWAY_E2E_PROVIDER_BASE="${GATEWAY_E2E_PROVIDER_BASE:-http://127.0.0.1:8001}"
  export GATEWAY_E2E_RPC_URL="${GATEWAY_E2E_RPC_URL:-http://127.0.0.1:8545}"
  export GATEWAY_E2E_INTERNAL_TRIGGER_SECRET="${GATEWAY_E2E_INTERNAL_TRIGGER_SECRET:-release-e2e-internal-trigger}"
  export POSTGRES_DSN="${POSTGRES_DSN:-postgresql://synapse:local-dev-postgres-password@127.0.0.1:${POSTGRES_PORT:-15432}/${POSTGRES_DB_NAME}}"
fi

set +e
(
  cd "${ROOT_DIR}/services/gateway"
  if [[ "$PROFILE" == "mvp-postgres" ]]; then
    PYTHONPATH=. "$PYTHON_BIN" -m pytest \
      tests/e2e/test_01_infrastructure.py \
      tests/e2e/test_02_wallet_auth.py \
      tests/e2e/test_03_fund_wallet.py \
      tests/e2e/test_04_deposit.py \
      tests/e2e/test_05_provider_register.py \
      tests/e2e/test_05_provider_register_onboarding.py \
      tests/e2e/test_05_provider_credentials.py \
      tests/e2e/test_06_agent_credential.py \
      tests/e2e/test_07_invoke.py \
      tests/e2e/test_08_cleanup.py \
      tests/e2e/test_09_consumer_withdraw.py \
      tests/e2e/test_api_reference.py \
      -q --tb=short --junitxml="${OUT_DIR}/pytest-junit.xml"
  else
    PYTHONPATH=. "$PYTHON_BIN" -m pytest tests/e2e -q --tb=short --junitxml="${OUT_DIR}/pytest-junit.xml"
  fi
)
PYTEST_EXIT=$?
set -e

set +e
"$PYTHON_BIN" "${ROOT_DIR}/scripts/e2e/gateway_release_evidence_report.py" \
  --out-dir "$OUT_DIR" \
  --env "$MODE" \
  --profile "$PROFILE" \
  --pytest-exit-code "$PYTEST_EXIT"
REPORT_EXIT=$?
set -e

echo "[gateway-release-e2e] report=${OUT_DIR}/report.md"
if [[ "$PYTEST_EXIT" -ne 0 || "$REPORT_EXIT" -ne 0 ]]; then
  echo "[gateway-release-e2e] FAILED pytest_exit=${PYTEST_EXIT} report_exit=${REPORT_EXIT}"
  exit 1
fi
echo "[gateway-release-e2e] PASSED"
