#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Restarting Provider Service ==="

bash "$SCRIPT_DIR/stop.sh"
bash "$SCRIPT_DIR/start.sh"