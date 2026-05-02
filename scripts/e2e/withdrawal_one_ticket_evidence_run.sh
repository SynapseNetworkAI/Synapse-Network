#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
MODE="${WITHDRAWAL_ONE_TICKET_ENV:-local}"
OUT_DIR="${WITHDRAWAL_ONE_TICKET_OUT_DIR:-${ROOT_DIR}/docs/evidence/release/withdrawal-one-ticket/${TIMESTAMP}-${MODE}}"
LOG_FILE="${OUT_DIR}/withdrawal-one-ticket.log"
PYTHON_BIN="${ROOT_DIR}/services/gateway/.venv/bin/python"
COMPOSE_FILE="${ROOT_DIR}/infra/docker/local/docker-compose.yml"
POSTGRES_PORT="${WITHDRAWAL_ONE_TICKET_POSTGRES_PORT:-}"
POSTGRES_DB_NAME="${WITHDRAWAL_ONE_TICKET_POSTGRES_DB:-synapse_withdrawal_one_ticket_$(printf '%s' "$TIMESTAMP" | tr '[:upper:]' '[:lower:]')}"

mkdir -p "$OUT_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "[withdrawal-one-ticket] mode=${MODE}"
echo "[withdrawal-one-ticket] evidence=${OUT_DIR}"

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
    echo "[withdrawal-one-ticket] stopped ${name} (${pid})"
  fi
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
  echo "FATAL: docker compose or docker-compose is required" >&2
  return 1
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

choose_local_postgres_port() {
  if [[ -n "$POSTGRES_PORT" ]]; then
    return 0
  fi
  if probe_postgres_server 5432; then
    POSTGRES_PORT=5432
    return 0
  fi
  POSTGRES_PORT=15432
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

if [[ "$MODE" != "local" ]]; then
  echo "FATAL: withdrawal one-ticket evidence runner currently supports local rehearsal only." >&2
  exit 1
fi

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "FATAL: gateway virtualenv missing at ${PYTHON_BIN}" >&2
  exit 1
fi

compose_cmd="$(resolve_compose_cmd)"
choose_local_postgres_port
echo "[withdrawal-one-ticket] starting local postgres/redis (postgres_port=${POSTGRES_PORT}, postgres_db=${POSTGRES_DB_NAME})"
SYNAPSE_POSTGRES_HOST_PORT="$POSTGRES_PORT" ${compose_cmd} -f "$COMPOSE_FILE" up -d postgres redis >/dev/null

existing_gateway_pid="$(find_pid_by_port 8000)"
if [[ -n "$existing_gateway_pid" ]]; then
  stop_pid "gateway" "$existing_gateway_pid"
fi

echo "[withdrawal-one-ticket] bootstrapping local contracts and gateway"
POSTGRES_DSN="postgresql://synapse:local-dev-postgres-password@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB_NAME}" \
LOCAL_POSTGRES_BOOTSTRAP_USER=synapse \
LOCAL_POSTGRES_BOOTSTRAP_PASSWORD=local-dev-postgres-password \
PGHOST=127.0.0.1 \
PGPORT="$POSTGRES_PORT" \
POSTGRES_USER=synapse \
POSTGRES_PASSWORD=local-dev-postgres-password \
POSTGRES_DB="$POSTGRES_DB_NAME" \
SYNAPSE_GATEWAY_DB="$POSTGRES_DB_NAME" \
PROVIDER_WITHDRAW_DEADLINE_SEC="${PROVIDER_WITHDRAW_DEADLINE_SEC:-60}" \
WITHDRAW_TICKET_EXPIRY_BUFFER_SEC="${WITHDRAW_TICKET_EXPIRY_BUFFER_SEC:-3}" \
WITHDRAW_RPC_FINALITY_MARGIN_SEC="${WITHDRAW_RPC_FINALITY_MARGIN_SEC:-3}" \
PROVIDER_WITHDRAW_EXPIRY_REAPER_INTERVAL_SEC="${PROVIDER_WITHDRAW_EXPIRY_REAPER_INTERVAL_SEC:-1}" \
CONSUMER_WITHDRAW_PROCESSOR_INTERVAL_SEC="${CONSUMER_WITHDRAW_PROCESSOR_INTERVAL_SEC:-1}" \
CONSUMER_WITHDRAW_MAX_DAILY_COUNT="${CONSUMER_WITHDRAW_MAX_DAILY_COUNT:-100}" \
CONSUMER_WITHDRAW_MIN_USDC="${CONSUMER_WITHDRAW_MIN_USDC:-10}" \
CONSUMER_WITHDRAW_MATURITY_SECONDS="${CONSUMER_WITHDRAW_MATURITY_SECONDS:-0}" \
CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC="${CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC:-1000000}" \
PROVIDER_WITHDRAW_MIN_USDC="${PROVIDER_WITHDRAW_MIN_USDC:-10}" \
PROVIDER_WITHDRAW_MATURITY_SECONDS="${PROVIDER_WITHDRAW_MATURITY_SECONDS:-0}" \
WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC="${WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC:-1000000}" \
bash "${ROOT_DIR}/scripts/local/setup_local_env.sh"

wait_for_http "http://127.0.0.1:8000/health" 30

export WITHDRAWAL_ONE_TICKET_ENV="$MODE"
export WITHDRAWAL_ONE_TICKET_OUT_DIR="$OUT_DIR"
export GATEWAY_BASE_URL="${GATEWAY_BASE_URL:-http://127.0.0.1:8000}"
export RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
export PROVIDER_WITHDRAW_DEADLINE_SEC="${PROVIDER_WITHDRAW_DEADLINE_SEC:-60}"
export WITHDRAW_TICKET_EXPIRY_BUFFER_SEC="${WITHDRAW_TICKET_EXPIRY_BUFFER_SEC:-3}"
export WITHDRAW_RPC_FINALITY_MARGIN_SEC="${WITHDRAW_RPC_FINALITY_MARGIN_SEC:-3}"
export WITHDRAWAL_ONE_TICKET_SERVICE_PRICE_USDC="${WITHDRAWAL_ONE_TICKET_SERVICE_PRICE_USDC:-100.000000}"
export WITHDRAWAL_ONE_TICKET_CONSUMER_DEPOSIT_USDC="${WITHDRAWAL_ONE_TICKET_CONSUMER_DEPOSIT_USDC:-250.000000}"
export WITHDRAWAL_ONE_TICKET_CONSUMER_WITHDRAW_USDC="${WITHDRAWAL_ONE_TICKET_CONSUMER_WITHDRAW_USDC:-10.000000}"
export WITHDRAWAL_ONE_TICKET_PROVIDER_WITHDRAW_USDC="${WITHDRAWAL_ONE_TICKET_PROVIDER_WITHDRAW_USDC:-10.000000}"

node "${ROOT_DIR}/scripts/e2e/withdrawal_one_ticket_evidence.mjs"

echo "[withdrawal-one-ticket] PASSED"
