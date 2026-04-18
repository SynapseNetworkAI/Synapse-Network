#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "[ci:performance-reliability] running local performance/reliability smoke"
bash "$ROOT_DIR/scripts/ci/run_pytest_checks.sh" \
  "ci:performance-reliability:gateway" \
  "$ROOT_DIR/services/gateway" \
  "performance_tests"

