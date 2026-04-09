#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

bash "$ROOT_DIR/scripts/ci/run_pytest_checks.sh" "ci:sdk-python" "$ROOT_DIR/sdk/python" "synapse_client/test"
bash "$ROOT_DIR/scripts/ci/run_python_build_check.sh" "ci:sdk-python-package" "$ROOT_DIR/sdk/python"