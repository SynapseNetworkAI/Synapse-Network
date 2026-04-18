#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/drills/lib/common.sh"

drill_require_staging_confirmation
drill_require_var SYNAPSE_DRILL_CONFIG_ROLLBACK_CMD
drill_require_var SYNAPSE_DRILL_VERIFY_CMD

OUT_DIR="${SYNAPSE_DRILL_OUT_DIR:-$(drill_evidence_dir "$ROOT_DIR" config-rollback)}"
drill_write_run_metadata "$OUT_DIR" "config-rollback" "$ROOT_DIR"
drill_run_step config_rollback "$SYNAPSE_DRILL_CONFIG_ROLLBACK_CMD" "$OUT_DIR"
drill_run_step verify_post_rollback "$SYNAPSE_DRILL_VERIFY_CMD" "$OUT_DIR"
echo "[drill] evidence directory: $OUT_DIR"

