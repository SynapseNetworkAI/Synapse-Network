#!/usr/bin/env bash
set -euo pipefail

echo "[guard] Enforcing PostgreSQL-only storage policy"

cd "$(git rev-parse --show-toplevel)"

violations=0

check_pattern() {
  local pattern="$1"
  local scope="$2"
  local label="$3"

  if rg -n --no-heading "$pattern" $scope; then
    echo "[guard] Violation: found $label"
    violations=1
  fi
}

# Runtime code must not reintroduce removed JSON backend or deprecated data_dir settings.
check_pattern "JsonStorage|json_impl" "python_sdk/seller_api/src" "removed JSON storage symbols"
check_pattern "\bdata_dir\b" "python_sdk/seller_api/src" "deprecated data_dir usage in runtime code"

# Environment templates must never default back to json backend.
check_pattern "^\s*STORAGE_BACKEND\s*=\s*json\s*$" "python_sdk/.env*.example" "json storage backend in environment templates"

if [[ "$violations" -ne 0 ]]; then
  echo "[guard] PostgreSQL-only guard failed"
  exit 1
fi

echo "[guard] PostgreSQL-only guard passed"
