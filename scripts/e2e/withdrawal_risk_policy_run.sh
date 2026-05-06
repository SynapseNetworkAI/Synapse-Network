#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
MODE="${WITHDRAWAL_RISK_POLICY_ENV:-local}"
OUT_DIR="${WITHDRAWAL_RISK_POLICY_OUT_DIR:-${ROOT_DIR}/output/dogfood/withdrawal-risk-policy/${TIMESTAMP}-${MODE}}"
LOG_FILE="${OUT_DIR}/withdrawal-risk-policy.log"
COMPOSE_FILE="${ROOT_DIR}/infra/docker/local/docker-compose.yml"
POSTGRES_PORT="${WITHDRAWAL_RISK_POLICY_POSTGRES_PORT:-}"
POSTGRES_DB_NAME="${WITHDRAWAL_RISK_POLICY_POSTGRES_DB:-synapse_withdrawal_risk_$(printf '%s' "$TIMESTAMP" | tr '[:upper:]' '[:lower:]')}"

mkdir -p "$OUT_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "[withdrawal-risk-policy] mode=${MODE}"
echo "[withdrawal-risk-policy] evidence=${OUT_DIR}"

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
    echo "[withdrawal-risk-policy] stopped ${name} (${pid})"
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
  echo "FATAL: withdrawal risk policy runner currently supports local rehearsal only." >&2
  exit 1
fi

compose_cmd="$(resolve_compose_cmd)"
choose_local_postgres_port

echo "[withdrawal-risk-policy] starting local postgres/redis (postgres_port=${POSTGRES_PORT}, postgres_db=${POSTGRES_DB_NAME})"
SYNAPSE_POSTGRES_HOST_PORT="$POSTGRES_PORT" ${compose_cmd} -f "$COMPOSE_FILE" up -d postgres redis >/dev/null

existing_gateway_pid="$(find_pid_by_port 8000)"
if [[ -n "$existing_gateway_pid" ]]; then
  stop_pid "gateway" "$existing_gateway_pid"
fi

existing_frontend_pid="$(find_pid_by_port 3000)"
if [[ -n "$existing_frontend_pid" ]]; then
  stop_pid "user-front" "$existing_frontend_pid"
fi

echo "[withdrawal-risk-policy] bootstrapping contracts, gateway, and user-front"
POSTGRES_DSN="postgresql://synapse:local-dev-postgres-password@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB_NAME}" \
LOCAL_GATEWAY_POSTGRES_DSN="postgresql://synapse:local-dev-postgres-password@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB_NAME}" \
MIGRATION_DSN="postgresql://synapse:local-dev-postgres-password@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB_NAME}" \
LOCAL_POSTGRES_MIGRATOR_DSN="postgresql://synapse:local-dev-postgres-password@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB_NAME}" \
LOCAL_POSTGRES_BOOTSTRAP_USER=synapse \
LOCAL_POSTGRES_BOOTSTRAP_PASSWORD=local-dev-postgres-password \
PGHOST=127.0.0.1 \
PGPORT="$POSTGRES_PORT" \
POSTGRES_HOST=127.0.0.1 \
POSTGRES_PORT="$POSTGRES_PORT" \
POSTGRES_USER=synapse \
POSTGRES_PASSWORD=local-dev-postgres-password \
POSTGRES_DB="$POSTGRES_DB_NAME" \
SYNAPSE_GATEWAY_DB="$POSTGRES_DB_NAME" \
GATEWAY_PYTHON="${GATEWAY_PYTHON:-${ROOT_DIR}/services/gateway/.venv/bin/python}" \
CONSUMER_WITHDRAW_MIN_USDC="${CONSUMER_WITHDRAW_MIN_USDC:-10}" \
CONSUMER_WITHDRAW_MATURITY_ENFORCEMENT_ENABLED="${CONSUMER_WITHDRAW_MATURITY_ENFORCEMENT_ENABLED:-true}" \
CONSUMER_WITHDRAW_MATURITY_SECONDS="${CONSUMER_WITHDRAW_MATURITY_SECONDS:-604800}" \
CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC="${CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC:-1000000}" \
CONSUMER_WITHDRAW_MAX_DAILY_COUNT="${CONSUMER_WITHDRAW_MAX_DAILY_COUNT:-3}" \
PROVIDER_WITHDRAW_MIN_USDC="${PROVIDER_WITHDRAW_MIN_USDC:-10}" \
PROVIDER_WITHDRAW_MATURITY_ENFORCEMENT_ENABLED="${PROVIDER_WITHDRAW_MATURITY_ENFORCEMENT_ENABLED:-true}" \
PROVIDER_WITHDRAW_MATURITY_SECONDS="${PROVIDER_WITHDRAW_MATURITY_SECONDS:-604800}" \
WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC="${WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC:-1000000}" \
WITHDRAWAL_AUTO_24H_LIMIT_USDC="${WITHDRAWAL_AUTO_24H_LIMIT_USDC:-1000000}" \
bash "${ROOT_DIR}/scripts/local/setup_local_env.sh"

wait_for_http "http://127.0.0.1:8000/health" 45
wait_for_http "http://127.0.0.1:3000/dashboard/account/settings" 120

export WITHDRAWAL_RISK_POLICY_ENV="$MODE"
export WITHDRAWAL_RISK_POLICY_OUT_DIR="$OUT_DIR"
export GATEWAY_BASE_URL="${GATEWAY_BASE_URL:-http://127.0.0.1:8000}"
export USER_FRONT_BASE_URL="${USER_FRONT_BASE_URL:-http://127.0.0.1:3000}"
export RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
export POSTGRES_DSN="postgresql://synapse:local-dev-postgres-password@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB_NAME}"

node "${ROOT_DIR}/scripts/e2e/withdrawal_risk_policy_e2e.mjs"

echo "[withdrawal-risk-policy] PASSED"
