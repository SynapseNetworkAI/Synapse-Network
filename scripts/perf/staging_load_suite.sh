#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/perf/lib/common.sh"

synapse_require_staging_confirmation

RUN_ID="${SYNAPSE_PERF_RUN_ID:-$(synapse_timestamp)}"
OUT_ROOT="${SYNAPSE_PERF_OUT_ROOT:-$ROOT_DIR/docs/evidence/performance/${RUN_ID}-staging-load-suite}"
mkdir -p "$OUT_ROOT"

export SYNAPSE_GATEWAY_BASE_URL="${SYNAPSE_GATEWAY_BASE_URL:-https://api-staging.synapse-network.ai}"
export SYNAPSE_ADMIN_GATEWAY_BASE_URL="${SYNAPSE_ADMIN_GATEWAY_BASE_URL:-https://admin-api-staging.synapse-network.ai}"
export SYNAPSE_PERF_DURATION_SEC="${SYNAPSE_PERF_DURATION_SEC:-60}"
export SYNAPSE_PERF_CONCURRENCY="${SYNAPSE_PERF_CONCURRENCY:-1}"
export SYNAPSE_PERF_REQUEST_DELAY_MS="${SYNAPSE_PERF_REQUEST_DELAY_MS:-1000}"
export SYNAPSE_PERF_SERVICE_ID="${SYNAPSE_PERF_SERVICE_ID:-svc_oss_security_healthcheck}"
export SYNAPSE_PERF_ENABLE_MONEY_WRITE_LOAD="${SYNAPSE_PERF_ENABLE_MONEY_WRITE_LOAD:-0}"

if [[ -z "${SYNAPSE_ADMIN_COOKIE_HEADER:-}" ]]; then
  admin_env="$(node "$ROOT_DIR/scripts/perf/staging_admin_session.mjs")"
  eval "$admin_env"
fi

if [[ -z "${SYNAPSE_OWNER_TOKEN:-}" || -z "${SYNAPSE_AGENT_TOKEN:-}" || -z "${SYNAPSE_OWNER_WALLET:-}" ]]; then
  gateway_env="$(node "$ROOT_DIR/scripts/perf/staging_gateway_wallet_session.mjs")"
  eval "$gateway_env"
fi

run_suite_step() {
  local name="$1"
  local command="$2"
  echo "[perf:staging-load-suite] $name"
  SYNAPSE_PERF_RUN_ID="$RUN_ID" \
  SYNAPSE_PERF_OUT_DIR="$OUT_ROOT/$name" \
    bash -lc "$command" 2>&1 | tee "$OUT_ROOT/${name}.log"
}

cat > "$OUT_ROOT/README.md" <<EOF
# Staging Load Suite Evidence

- Run id: \`$RUN_ID\`
- Commit: \`$(cd "$ROOT_DIR" && git rev-parse --short HEAD)\`
- Started UTC: \`$(date -u +"%Y-%m-%dT%H:%M:%SZ")\`
- Environment: \`${SYNAPSE_PERF_ENV:-}\`

This suite runs staging light-load scenarios only. It does not run chaos,
failover, rollback, restore, signer procedures, or destructive money-write
concurrency unless SYNAPSE_PERF_ENABLE_MONEY_WRITE_LOAD=1 is explicitly set.
EOF

run_suite_step "gateway-load" "bash scripts/perf/gateway_load.sh"
run_suite_step "finance-load" "bash scripts/perf/finance_load.sh"
run_suite_step "provider-health-load" "bash scripts/perf/provider_health_load.sh"
run_suite_step "admin-load" "bash scripts/perf/admin_load.sh"
if [[ "${SYNAPSE_PERF_ENABLE_MONEY_WRITE_LOAD}" == "1" ]]; then
  run_suite_step "money-concurrency" "bash scripts/perf/money_concurrency.sh"
else
  echo "[perf:staging-load-suite] skipping money-concurrency; set SYNAPSE_PERF_ENABLE_MONEY_WRITE_LOAD=1 to run destructive money-write load"
fi

echo "[perf:staging-load-suite] evidence directory: $OUT_ROOT"
