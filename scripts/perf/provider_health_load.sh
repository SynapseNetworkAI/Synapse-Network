#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/perf/lib/common.sh"

synapse_require_staging_confirmation
synapse_require_var SYNAPSE_ADMIN_GATEWAY_BASE_URL
synapse_require_var SYNAPSE_ADMIN_TOKEN

OUT_DIR="${SYNAPSE_PERF_OUT_DIR:-$(synapse_evidence_dir "$ROOT_DIR" provider-health-load)}"
synapse_write_run_metadata "$OUT_DIR" "provider-health-load" "$ROOT_DIR"
python3 "$ROOT_DIR/scripts/perf/http_load_runner.py" \
  --scenario "$ROOT_DIR/scripts/perf/scenarios/provider_health.json" \
  --out-dir "$OUT_DIR"
synapse_print_report_hint "$OUT_DIR"
