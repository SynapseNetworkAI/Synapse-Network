#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

bash "$ROOT_DIR/scripts/ci/run_next_quality_gate.sh" "ci:admin-front" "$ROOT_DIR/services/admin-front" "false"
