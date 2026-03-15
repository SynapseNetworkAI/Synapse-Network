#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Restarting Synapse prod profile ==="

if [[ -x "${SCRIPT_DIR}/stop_prod_env.sh" ]]; then
  "${SCRIPT_DIR}/stop_prod_env.sh" || true
else
  bash "${SCRIPT_DIR}/stop_prod_env.sh" || true
fi

if [[ -x "${SCRIPT_DIR}/start_prod_env.sh" ]]; then
  "${SCRIPT_DIR}/start_prod_env.sh"
else
  bash "${SCRIPT_DIR}/start_prod_env.sh"
fi
