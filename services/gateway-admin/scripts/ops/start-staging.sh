#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

STAGING_ENV_FILE="$(resolve_staging_env_file)"

if [[ -z "${STAGING_ENV_FILE}" ]]; then
  echo "Error: no staging env file found."
  echo "Set ADMIN_GATEWAY_ENV_FILE or create ${STAGING_ENV_FILE_DEFAULT}."
  exit 1
fi

if [[ "${STAGING_ENV_FILE}" == "${APP_DIR}/.env.example" ]]; then
  echo "Error: .env.example is a template and cannot be used directly in staging."
  exit 1
fi

export ADMIN_GATEWAY_ENV_FILE="${STAGING_ENV_FILE}"
start_gateway_admin "${STAGING_ENV_FILE}" "staging"
