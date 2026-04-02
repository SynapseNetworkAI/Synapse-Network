#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-${ADMIN_GATEWAY_START_MODE:-local}}"

"${SCRIPT_DIR}/stop.sh"

case "${MODE}" in
	local)
		bash "${SCRIPT_DIR}/start-local.sh"
		;;
	staging)
		bash "${SCRIPT_DIR}/start-staging.sh"
		;;
	prod)
		bash "${SCRIPT_DIR}/start-prod.sh"
		;;
	*)
		echo "Unsupported restart mode: ${MODE}. Use 'local', 'staging', or 'prod'."
		exit 1
		;;
esac
