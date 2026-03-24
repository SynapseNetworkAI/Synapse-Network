#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_NAME="${1:-local}"

echo "=== Restarting Provider Service (${ENV_NAME}) ==="
echo "Tip: prefer ./scripts/restart.${ENV_NAME}.sh for explicit environment restart."

bash "$SCRIPT_DIR/stop.sh" "${ENV_NAME}"
bash "$SCRIPT_DIR/start.sh" "${ENV_NAME}"