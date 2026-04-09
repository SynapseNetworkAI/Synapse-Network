#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# provider_service lives in a separate sibling repo: Synapse-Network-Provider
PROVIDER_DIR="${ROOT_DIR}/../Synapse-Network-Provider"

bash "$ROOT_DIR/scripts/ci/run_pytest_checks.sh" "ci:provider-service" "$PROVIDER_DIR" "tests"