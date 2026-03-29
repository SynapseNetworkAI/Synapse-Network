#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

bash "$ROOT_DIR/scripts/ci/run_pytest_checks.sh" "ci:admin-gateway" "$ROOT_DIR/admin/gateway-admin"
