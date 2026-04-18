#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/perf/lib/common.sh"

synapse_require_staging_confirmation
echo "[perf:money-concurrency] use this harness only with isolated staging wallets and test funds"
echo "[perf:money-concurrency] required evidence: before/after ledger snapshot, vault snapshot, audit sample, summary.json"
synapse_require_var SYNAPSE_MONEY_CONCURRENCY_COMMAND

OUT_DIR="${SYNAPSE_PERF_OUT_DIR:-$(synapse_evidence_dir "$ROOT_DIR" money-concurrency)}"
synapse_write_run_metadata "$OUT_DIR" "money-concurrency" "$ROOT_DIR"
echo "[perf:money-concurrency] running configured command"
bash -lc "$SYNAPSE_MONEY_CONCURRENCY_COMMAND" 2>&1 | tee "$OUT_DIR/run.log"
synapse_print_report_hint "$OUT_DIR"

