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
