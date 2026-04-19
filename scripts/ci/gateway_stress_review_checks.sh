#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "[ci:gateway-stress-review] scanning gateway reliability hazards"
python3 "$ROOT_DIR/scripts/ci/gateway_stress_review_scan.py"
