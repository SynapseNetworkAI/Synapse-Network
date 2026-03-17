#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

echo "[guard] enforcing PostgreSQL-only storage policy"

violations=0

check_pattern() {
    local pattern="$1"
    local scope="$2"
    local label="$3"

    if rg -n --no-heading "$pattern" $scope; then
        echo "[guard] violation: found ${label}"
        violations=1
    fi
}

check_pattern "JsonStorage|json_impl" "gateway/src" "removed JSON storage symbols in gateway runtime"
check_pattern "\bdata_dir\b" "gateway/src" "deprecated data_dir usage in gateway runtime"
check_pattern "get_collection|save_collection|append_to_collection" "gateway/src" "removed collection passthrough storage API"
check_pattern "^\s*STORAGE_BACKEND\s*=\s*json\s*$" "gateway/.env* admin/gateway-admin/.env*" "json storage backend in env files"

if [[ "$violations" -ne 0 ]]; then
    echo "[guard] PostgreSQL-only storage guard failed"
    exit 1
fi

echo "[guard] PostgreSQL-only storage guard passed"