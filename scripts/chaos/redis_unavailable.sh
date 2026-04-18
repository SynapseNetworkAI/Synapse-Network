#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/chaos/lib/common.sh"

chaos_require_staging_confirmation
chaos_require_var SYNAPSE_CHAOS_REDIS_STOP_CMD
chaos_require_var SYNAPSE_CHAOS_REDIS_START_CMD
chaos_require_var SYNAPSE_CHAOS_VERIFY_CMD

OUT_DIR="${SYNAPSE_CHAOS_OUT_DIR:-$(chaos_evidence_dir "$ROOT_DIR" redis-unavailable)}"
chaos_write_run_metadata "$OUT_DIR" "redis-unavailable" "$ROOT_DIR"
trap 'chaos_run_step redis_recover "$SYNAPSE_CHAOS_REDIS_START_CMD" "$OUT_DIR" || true' EXIT
chaos_run_step redis_stop "$SYNAPSE_CHAOS_REDIS_STOP_CMD" "$OUT_DIR"
chaos_run_step verify_degraded "$SYNAPSE_CHAOS_VERIFY_CMD" "$OUT_DIR"
chaos_run_step redis_start "$SYNAPSE_CHAOS_REDIS_START_CMD" "$OUT_DIR"
trap - EXIT
chaos_run_step verify_recovered "$SYNAPSE_CHAOS_VERIFY_CMD" "$OUT_DIR"
echo "[chaos] evidence directory: $OUT_DIR"

