#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/chaos/lib/common.sh"

chaos_require_staging_confirmation
chaos_require_var SYNAPSE_CHAOS_GATEWAY_ADMIN_RESTART_CMD
chaos_require_var SYNAPSE_CHAOS_VERIFY_CMD

OUT_DIR="${SYNAPSE_CHAOS_OUT_DIR:-$(chaos_evidence_dir "$ROOT_DIR" gateway-admin-restart)}"
chaos_write_run_metadata "$OUT_DIR" "gateway-admin-restart" "$ROOT_DIR"
chaos_run_step gateway_admin_restart "$SYNAPSE_CHAOS_GATEWAY_ADMIN_RESTART_CMD" "$OUT_DIR"
chaos_run_step verify_post_restart "$SYNAPSE_CHAOS_VERIFY_CMD" "$OUT_DIR"
echo "[chaos] evidence directory: $OUT_DIR"

