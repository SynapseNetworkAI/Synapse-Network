#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "=== Restarting Synapse local environment ==="

if [[ -x "${SCRIPT_DIR}/stop_local_env.sh" ]]; then
  "${SCRIPT_DIR}/stop_local_env.sh" || true
else
  bash "${SCRIPT_DIR}/stop_local_env.sh" || true
fi

echo "Starting fresh local environment..."
if [[ -x "${SCRIPT_DIR}/setup_local_env.sh" ]]; then
  "${SCRIPT_DIR}/setup_local_env.sh"
else
  bash "${SCRIPT_DIR}/setup_local_env.sh"
fi

if [[ "${SKIP_V2_SMOKE:-1}" == "1" ]]; then
  echo "Skipping V2 smoke regression (SKIP_V2_SMOKE=1 by default)."
  exit 0
fi

echo "Running V2 daily-limit regression smoke..."
rm -f \
  "${ROOT_DIR}/gateway/runtime_storage/deposit_intents.json" \
  "${ROOT_DIR}/gateway/runtime_storage/deposit_event_processed.json" \
  "${ROOT_DIR}/gateway/runtime_storage/balance_ledger.json" \
  "${ROOT_DIR}/gateway/runtime_storage/usage_log.json"

if [[ -x "${ROOT_DIR}/.venv/bin/python" ]]; then
  PYTHON_BIN="${ROOT_DIR}/.venv/bin/python"
elif [[ -x "${ROOT_DIR}/gateway/venv/bin/python" ]]; then
  PYTHON_BIN="${ROOT_DIR}/gateway/venv/bin/python"
else
  PYTHON_BIN="python3"
fi

"${PYTHON_BIN}" "${ROOT_DIR}/gateway/examples/v2_daily_limit_regression.py"
echo "V2 daily-limit regression passed."
