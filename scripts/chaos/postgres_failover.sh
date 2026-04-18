#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/chaos/lib/common.sh"

chaos_require_staging_confirmation
chaos_require_var SYNAPSE_CHAOS_POSTGRES_FAILOVER_CMD
chaos_require_var SYNAPSE_CHAOS_VERIFY_CMD

OUT_DIR="${SYNAPSE_CHAOS_OUT_DIR:-$(chaos_evidence_dir "$ROOT_DIR" postgres-failover)}"
chaos_write_run_metadata "$OUT_DIR" "postgres-failover" "$ROOT_DIR"
chaos_run_step postgres_failover "$SYNAPSE_CHAOS_POSTGRES_FAILOVER_CMD" "$OUT_DIR"
chaos_run_step verify_post_failover "$SYNAPSE_CHAOS_VERIFY_CMD" "$OUT_DIR"
echo "[chaos] evidence directory: $OUT_DIR"

