#!/usr/bin/env bash

if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

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

if [[ -x "${ROOT_DIR}/.venv/bin/python" ]]; then
  PYTHON_BIN="${ROOT_DIR}/.venv/bin/python"
elif [[ -x "${ROOT_DIR}/gateway/.venv/bin/python" ]]; then
  PYTHON_BIN="${ROOT_DIR}/gateway/.venv/bin/python"
elif [[ -x "${ROOT_DIR}/gateway/venv/bin/python" ]]; then
  PYTHON_BIN="${ROOT_DIR}/gateway/venv/bin/python"
else
  PYTHON_BIN="$(bash "${ROOT_DIR}/scripts/python/resolve_python_311.sh")"
fi

"${PYTHON_BIN}" "${ROOT_DIR}/gateway/examples/v2_daily_limit_regression.py"
echo "V2 daily-limit regression passed."
