#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/drills/lib/common.sh"

drill_require_staging_confirmation

RUN_ID="${SYNAPSE_DRILL_RUN_ID:-$(drill_timestamp)}"
OUT_ROOT="${SYNAPSE_DRILL_OUT_ROOT:-$ROOT_DIR/docs/evidence/performance/${RUN_ID}-staging-recovery-suite}"
mkdir -p "$OUT_ROOT"

run_suite_step() {
  local name="$1"
  local command="$2"
  echo "[drill:staging-recovery-suite] $name"
  SYNAPSE_DRILL_RUN_ID="$RUN_ID" \
  SYNAPSE_DRILL_OUT_DIR="$OUT_ROOT/$name" \
    bash -lc "$command" 2>&1 | tee "$OUT_ROOT/${name}.log"
}

cat > "$OUT_ROOT/README.md" <<EOF
# Staging Recovery Suite Evidence

- Run id: \`$RUN_ID\`
- Commit: \`$(cd "$ROOT_DIR" && git rev-parse --short HEAD)\`
- Started UTC: \`$(date -u +"%Y-%m-%dT%H:%M:%SZ")\`
- Environment: \`${SYNAPSE_DRILL_ENV:-}\`

This suite runs staging rollback and signer recovery drills. Attach post-drill smoke, reconciliation, and operator sign-off before changing validation status.
EOF

run_suite_step "application-rollback" "bash scripts/drills/application_rollback.sh"
run_suite_step "config-rollback" "bash scripts/drills/config_rollback.sh"
run_suite_step "signer-rollback" "bash scripts/drills/signer_rollback.sh"

echo "[drill:staging-recovery-suite] evidence directory: $OUT_ROOT"
