#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/perf/lib/common.sh"

synapse_require_staging_confirmation
synapse_require_var SYNAPSE_GATEWAY_BASE_URL
synapse_require_var SYNAPSE_AGENT_TOKEN
synapse_require_var SYNAPSE_OWNER_WALLET
synapse_require_var SYNAPSE_PERF_SERVICE_ID

export SYNAPSE_PERF_REQUEST_ID_PREFIX="${SYNAPSE_PERF_REQUEST_ID_PREFIX:-perf-$(synapse_timestamp)}"
OUT_DIR="${SYNAPSE_PERF_OUT_DIR:-$(synapse_evidence_dir "$ROOT_DIR" gateway-load)}"
synapse_write_run_metadata "$OUT_DIR" "gateway-load" "$ROOT_DIR"
python3 "$ROOT_DIR/scripts/perf/http_load_runner.py" \
  --scenario "$ROOT_DIR/scripts/perf/scenarios/gateway_discovery_quote_invoke.json" \
  --out-dir "$OUT_DIR"
synapse_print_report_hint "$OUT_DIR"

