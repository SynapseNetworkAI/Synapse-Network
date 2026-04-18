#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "[ci:pr] running pull request quality gates"

bash "$ROOT_DIR/scripts/ci/runtime_preflight.sh"
bash "$ROOT_DIR/scripts/ci/security_money_scan.sh"
bash "$ROOT_DIR/scripts/ci/security_money_ts_scan.sh"
bash "$ROOT_DIR/scripts/ci/security_secret_scan.sh"
bash "$ROOT_DIR/scripts/ci/docs_checks.sh"
bash "$ROOT_DIR/scripts/ci/frontend_checks.sh"
bash "$ROOT_DIR/scripts/ci/admin_front_checks.sh"
bash "$ROOT_DIR/scripts/ci/gateway_checks.sh"
bash "$ROOT_DIR/scripts/ci/admin_gateway_checks.sh"
bash "$ROOT_DIR/scripts/ci/provider_service_checks.sh"
bash "$ROOT_DIR/scripts/ci/sdk_python_checks.sh"
bash "$ROOT_DIR/scripts/ci/contracts_checks.sh"
