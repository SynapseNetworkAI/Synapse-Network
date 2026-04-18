#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/perf/lib/common.sh"

synapse_require_staging_confirmation

RUN_ID="${SYNAPSE_PERF_RUN_ID:-$(synapse_timestamp)}"
OUT_ROOT="${SYNAPSE_PERF_OUT_ROOT:-$ROOT_DIR/docs/evidence/performance/${RUN_ID}-staging-load-suite}"
mkdir -p "$OUT_ROOT"

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

This suite runs staging load scenarios only. It does not run chaos, failover, rollback, restore, or signer procedures.
EOF

run_suite_step "gateway-load" "bash scripts/perf/gateway_load.sh"
run_suite_step "finance-load" "bash scripts/perf/finance_load.sh"
run_suite_step "provider-health-load" "bash scripts/perf/provider_health_load.sh"
run_suite_step "admin-load" "bash scripts/perf/admin_load.sh"
run_suite_step "money-concurrency" "bash scripts/perf/money_concurrency.sh"

echo "[perf:staging-load-suite] evidence directory: $OUT_ROOT"
