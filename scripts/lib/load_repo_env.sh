#!/usr/bin/env bash
set -euo pipefail

# Load repo-level plain configuration from env.local/env.staging/env.prod.
# Values are exported for child processes, but never printed.

_synapse_repo_env_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
}

load_synapse_repo_env() {
  local env_name="${1:-${SYNAPSE_ENV:-local}}"
  local repo_root="${2:-$(_synapse_repo_env_root)}"
  local env_file="${SYNAPSE_ENV_FILE:-${repo_root}/env.${env_name}}"
  local line key value line_no loaded

  case "${env_name}" in
    local|staging|prod) ;;
    *)
      echo "[repo-env] unsupported environment: ${env_name}" >&2
      return 64
      ;;
  esac

  if [[ ! -f "${env_file}" ]]; then
    echo "[repo-env] env file not found: ${env_file}" >&2
    return 66
  fi

  line_no=0
  loaded=0
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line_no=$((line_no + 1))
    line="${line%$'\r'}"
    [[ "${line}" =~ ^[[:space:]]*$ ]] && continue
    [[ "${line}" =~ ^[[:space:]]*# ]] && continue

    if [[ "${line}" == export[[:space:]]* ]]; then
      line="${line#export }"
    fi

    if [[ "${line}" != *=* ]]; then
      echo "[repo-env] invalid line ${line_no} in env.${env_name}: missing '='" >&2
      return 65
    fi

    key="${line%%=*}"
    value="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"

    if [[ ! "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      echo "[repo-env] invalid key on line ${line_no} in env.${env_name}" >&2
      return 65
    fi

    if [[ "${value}" =~ ^\"(.*)\"$ ]]; then
      value="${BASH_REMATCH[1]}"
    elif [[ "${value}" =~ ^\'(.*)\'$ ]]; then
      value="${BASH_REMATCH[1]}"
    fi

    export "${key}=${value}"
    loaded=$((loaded + 1))
  done < "${env_file}"

  echo "[repo-env] loaded ${loaded} keys from env.${env_name}" >&2
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  load_synapse_repo_env "${1:-${SYNAPSE_ENV:-local}}" "${2:-$(_synapse_repo_env_root)}"
fi
