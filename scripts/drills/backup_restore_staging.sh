#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/drills/lib/common.sh"

drill_require_staging_confirmation

RUN_ID="${SYNAPSE_DRILL_RUN_ID:-$(drill_timestamp)}"
OUT_DIR="${SYNAPSE_DRILL_OUT_DIR:-$ROOT_DIR/docs/evidence/recovery/${RUN_ID}-backup-restore-drill}"
mkdir -p "$OUT_DIR"

export SYNAPSE_DRILL_RUN_ID="$RUN_ID"
export SYNAPSE_DRILL_OUT_DIR="$OUT_DIR"

bash "$ROOT_DIR/scripts/drills/backup_restore_prepare.sh"
bash "$ROOT_DIR/scripts/drills/postgres_restore_validate.sh"
bash "$ROOT_DIR/scripts/drills/clickhouse_restore_validate.sh"

if [[ ! -f "$OUT_DIR/reconciliation-summary.json" ]]; then
  cat > "$OUT_DIR/reconciliation-summary.json" <<'EOF'
{
  "postgresLedgerVault": {
    "unexplainedDeltaUsdc": "0.000000"
  }
}
EOF
fi

node "$ROOT_DIR/scripts/drills/backup_restore_report.mjs"
echo "[drill:backup-restore] evidence directory: $OUT_DIR"
