#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# provider_service lives in a separate sibling repo: Synapse-Network-Provider
PROVIDER_DIR="${ROOT_DIR}/../Synapse-Network-Provider"

if [[ ! -d "$PROVIDER_DIR" ]]; then
  echo "[ci:provider-service] skipping: sibling repo not checked out at $PROVIDER_DIR"
  exit 0
fi

if [[ ! -f "$PROVIDER_DIR/requirements.txt" && ! -f "$PROVIDER_DIR/pyproject.toml" ]]; then
  echo "[ci:provider-service] skipping: no Python manifest found in sibling repo at $PROVIDER_DIR"
  exit 0
fi

bash "$ROOT_DIR/scripts/ci/run_pytest_checks.sh" "ci:provider-service" "$PROVIDER_DIR" "tests"
