#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/chaos/lib/common.sh"

chaos_require_staging_confirmation
chaos_require_var SYNAPSE_CHAOS_PROVIDER_STOP_CMD
chaos_require_var SYNAPSE_CHAOS_PROVIDER_START_CMD
chaos_require_var SYNAPSE_CHAOS_VERIFY_CMD

OUT_DIR="${SYNAPSE_CHAOS_OUT_DIR:-$(chaos_evidence_dir "$ROOT_DIR" provider-outage)}"
chaos_write_run_metadata "$OUT_DIR" "provider-outage" "$ROOT_DIR"
trap 'chaos_run_step provider_recover "$SYNAPSE_CHAOS_PROVIDER_START_CMD" "$OUT_DIR" || true' EXIT
chaos_run_step provider_stop "$SYNAPSE_CHAOS_PROVIDER_STOP_CMD" "$OUT_DIR"
chaos_run_step verify_drained "$SYNAPSE_CHAOS_VERIFY_CMD" "$OUT_DIR"
chaos_run_step provider_start "$SYNAPSE_CHAOS_PROVIDER_START_CMD" "$OUT_DIR"
trap - EXIT
chaos_run_step verify_recovered "$SYNAPSE_CHAOS_VERIFY_CMD" "$OUT_DIR"
echo "[chaos] evidence directory: $OUT_DIR"

