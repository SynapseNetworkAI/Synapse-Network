#!/usr/bin/env bash
set -euo pipefail

base_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

run_group() {
    local group_dir="$1"

    if [[ ! -d "${group_dir}" ]]; then
        return
    fi

    while IFS= read -r script_path; do
        if [[ -n "${script_path}" ]]; then
            echo "[postgres-init] running ${script_path#${base_dir}/}"
            bash "${script_path}"
        fi
    done < <(find "${group_dir}" -maxdepth 1 -type f -name '*.sh' | sort)
}

run_group "${base_dir}/gateway"
run_group "${base_dir}/gateway-admin"
