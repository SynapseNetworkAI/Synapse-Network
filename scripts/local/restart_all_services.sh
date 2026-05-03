#!/usr/bin/env bash

if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Restarting Synapse local app services ==="
echo "[local-apps] Restarting gateway, gateway-admin, user-front, docs-front, and admin-front."
echo "[local-apps] Postgres and Anvil are not stopped by this app-only restart."

bash "${SCRIPT_DIR}/start_all_services.sh" restart
