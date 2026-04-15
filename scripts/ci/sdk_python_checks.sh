#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SDK_PY_DIR="$ROOT_DIR/sdk/python"

if [[ ! -f "$SDK_PY_DIR/pyproject.toml" && ! -f "$SDK_PY_DIR/requirements.txt" ]]; then
  echo "[ci:sdk-python] skipping: no sdk/python manifest present"
  exit 0
fi

bash "$ROOT_DIR/scripts/ci/run_pytest_checks.sh" "ci:sdk-python" "$SDK_PY_DIR" "synapse_client/test"
bash "$ROOT_DIR/scripts/ci/run_python_build_check.sh" "ci:sdk-python-package" "$SDK_PY_DIR"
