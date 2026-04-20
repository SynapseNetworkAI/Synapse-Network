#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "[ci:pr] running pull request quality gates"

bash "$ROOT_DIR/scripts/ci/runtime_preflight.sh"
bash "$ROOT_DIR/scripts/ci/security_money_scan.sh"
bash "$ROOT_DIR/scripts/ci/security_money_ts_scan.sh"
bash "$ROOT_DIR/scripts/ci/finance_approval_safety_scan.sh"
bash "$ROOT_DIR/scripts/ci/finance_mypy_scan.sh"
bash "$ROOT_DIR/scripts/ci/local_runtime_guard_scan.sh"
node "$ROOT_DIR/scripts/ci/e2e_script_model_drift_scan.mjs"
bash "$ROOT_DIR/scripts/ci/code_quality_architecture_scan.sh"
bash "$ROOT_DIR/scripts/ci/diff_coverage_gate.sh"
bash "$ROOT_DIR/scripts/ci/security_secret_scan.sh"
bash "$ROOT_DIR/scripts/ci/gateway_stress_review_checks.sh"
bash "$ROOT_DIR/scripts/ci/docs_checks.sh"
bash "$ROOT_DIR/scripts/ci/release_go_no_go_checks.sh"
bash "$ROOT_DIR/scripts/ci/frontend_checks.sh"
bash "$ROOT_DIR/scripts/ci/admin_front_checks.sh"
bash "$ROOT_DIR/scripts/ci/gateway_checks.sh"
bash "$ROOT_DIR/scripts/ci/performance_reliability_checks.sh"
bash "$ROOT_DIR/scripts/ci/admin_gateway_checks.sh"
bash "$ROOT_DIR/scripts/ci/provider_service_checks.sh"
bash "$ROOT_DIR/scripts/ci/sdk_python_checks.sh"
bash "$ROOT_DIR/scripts/ci/contracts_checks.sh"
