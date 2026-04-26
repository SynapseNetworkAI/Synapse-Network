#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/perf/lib/common.sh"

synapse_require_staging_confirmation
synapse_require_var SYNAPSE_GATEWAY_BASE_URL
synapse_require_var SYNAPSE_OWNER_TOKEN
synapse_require_var SYNAPSE_OWNER_WALLET
export SYNAPSE_PERF_WITHDRAW_AMOUNT_USDC="${SYNAPSE_PERF_WITHDRAW_AMOUNT_USDC:-0.01}"
SCENARIO="$ROOT_DIR/scripts/perf/scenarios/finance_read_only.json"
if [[ "${SYNAPSE_PERF_ENABLE_MONEY_WRITE_LOAD:-0}" == "1" ]]; then
  SCENARIO="$ROOT_DIR/scripts/perf/scenarios/finance_balance_withdrawal.json"
fi

OUT_DIR="${SYNAPSE_PERF_OUT_DIR:-$(synapse_evidence_dir "$ROOT_DIR" finance-load)}"
synapse_write_run_metadata "$OUT_DIR" "finance-load" "$ROOT_DIR"
python3 "$ROOT_DIR/scripts/perf/http_load_runner.py" \
  --scenario "$SCENARIO" \
  --out-dir "$OUT_DIR"
synapse_print_report_hint "$OUT_DIR"
