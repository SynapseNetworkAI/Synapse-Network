#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/chaos/lib/common.sh"

chaos_require_staging_confirmation

RUN_ID="${SYNAPSE_CHAOS_RUN_ID:-$(chaos_timestamp)}"
OUT_ROOT="${SYNAPSE_CHAOS_OUT_ROOT:-$ROOT_DIR/docs/evidence/performance/${RUN_ID}-staging-chaos-suite}"
mkdir -p "$OUT_ROOT"

run_suite_step() {
  local name="$1"
  local command="$2"
  echo "[chaos:staging-suite] $name"
  SYNAPSE_CHAOS_RUN_ID="$RUN_ID" \
  SYNAPSE_CHAOS_OUT_DIR="$OUT_ROOT/$name" \
    bash -lc "$command" 2>&1 | tee "$OUT_ROOT/${name}.log"
}

cat > "$OUT_ROOT/README.md" <<EOF
# Staging Chaos Suite Evidence

- Run id: \`$RUN_ID\`
- Commit: \`$(cd "$ROOT_DIR" && git rev-parse --short HEAD)\`
- Started UTC: \`$(date -u +"%Y-%m-%dT%H:%M:%SZ")\`
- Environment: \`${SYNAPSE_CHAOS_ENV:-}\`

This suite runs destructive staging chaos drills. Do not run it against production or shared environments without an incident commander and rollback owner.
EOF

run_suite_step "provider-outage" "bash scripts/chaos/provider_outage.sh"
run_suite_step "gateway-restart" "bash scripts/chaos/gateway_restart.sh"
run_suite_step "gateway-admin-restart" "bash scripts/chaos/gateway_admin_restart.sh"
run_suite_step "analytics-outage" "bash scripts/chaos/analytics_outage.sh"
run_suite_step "rpc-outage" "bash scripts/chaos/rpc_outage.sh"
run_suite_step "postgres-failover" "bash scripts/chaos/postgres_failover.sh"
run_suite_step "redis-unavailable" "bash scripts/chaos/redis_unavailable.sh"

echo "[chaos:staging-suite] evidence directory: $OUT_ROOT"
