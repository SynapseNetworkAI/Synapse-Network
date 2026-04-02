#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

LOCAL_ENV_FILE="$(resolve_local_env_file)"

if [[ -z "${LOCAL_ENV_FILE}" ]]; then
  echo "Error: no local env file found. Expected ${ENV_FILE_DEFAULT} or ${ENV_FILE_FALLBACK}."
  exit 1
fi

export ADMIN_GATEWAY_ENV_FILE="${LOCAL_ENV_FILE}"
start_gateway_admin "${LOCAL_ENV_FILE}" "local"