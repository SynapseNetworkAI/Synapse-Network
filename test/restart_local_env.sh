#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "=== Restarting A2A Local Environment ==="

if [[ -x "${SCRIPT_DIR}/stop_local_env.sh" ]]; then
  "${SCRIPT_DIR}/stop_local_env.sh" || true
else
  echo "stop_local_env.sh not executable, running with bash..."
  bash "${SCRIPT_DIR}/stop_local_env.sh" || true
fi

echo "Starting fresh environment..."
if [[ -x "${SCRIPT_DIR}/setup_local_env.sh" ]]; then
  "${SCRIPT_DIR}/setup_local_env.sh"
else
  echo "setup_local_env.sh not executable, running with bash..."
  bash "${SCRIPT_DIR}/setup_local_env.sh"
fi

if [[ "${SKIP_V2_SMOKE:-0}" == "1" ]]; then
  echo "Skipping V2 smoke regression (SKIP_V2_SMOKE=1)."
  exit 0
fi

echo "Running V2 daily-limit regression smoke..."
rm -f \
  "${ROOT_DIR}/python_sdk/deposit_intents.json" \
  "${ROOT_DIR}/python_sdk/deposit_event_processed.json" \
  "${ROOT_DIR}/python_sdk/balance_ledger.json" \
  "${ROOT_DIR}/python_sdk/usage_log.json"

if [[ -x "${ROOT_DIR}/.venv/bin/python" ]]; then
  PYTHON_BIN="${ROOT_DIR}/.venv/bin/python"
elif [[ -x "${ROOT_DIR}/python_sdk/venv/bin/python" ]]; then
  PYTHON_BIN="${ROOT_DIR}/python_sdk/venv/bin/python"
else
  PYTHON_BIN="python3"
fi

"${PYTHON_BIN}" "${ROOT_DIR}/python_sdk/examples/v2_daily_limit_regression.py"
echo "V2 daily-limit regression passed."
