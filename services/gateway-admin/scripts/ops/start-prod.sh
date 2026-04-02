#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

PROD_ENV_FILE="$(resolve_prod_env_file)"

if [[ -z "${PROD_ENV_FILE}" ]]; then
  echo "Error: no production env file found."
  echo "Set ADMIN_GATEWAY_ENV_FILE or create ${PROD_ENV_FILE_DEFAULT}."
  exit 1
fi

if [[ "${PROD_ENV_FILE}" == "${APP_DIR}/.env.example" ]]; then
  echo "Error: .env.example is a template and cannot be used directly in production."
  exit 1
fi

export ADMIN_GATEWAY_ENV_FILE="${PROD_ENV_FILE}"
start_gateway_admin "${PROD_ENV_FILE}" "prod"