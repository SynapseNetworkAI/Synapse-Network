#!/usr/bin/env bash

[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROVIDER_ROOT="${PROVIDER_ROOT:-${REPO_ROOT}/../Synapse-Network-Provider}"
GATEWAY_URL="${SYNAPSE_GATEWAY:-http://127.0.0.1:8000}"
ACTION="${1:-status}"

case "${ACTION}" in
    onboard)
        exec bash "${PROVIDER_ROOT}/scripts/onboard.local.sh" ensure
        ;;
    probe)
        exec bash "${PROVIDER_ROOT}/scripts/onboard.local.sh" ensure --wait-discoverable
        ;;
    status)
        echo "[provider-local] Gateway: ${GATEWAY_URL}"
        echo
        echo "[provider-local] Discovery:"
        curl -fsS "${GATEWAY_URL%/}/api/v1/services/discover"
        echo
        echo
        echo "[provider-local] Health status:"
        curl -fsS "${GATEWAY_URL%/}/api/v1/services/health/status?intent=svc_&includeInactive=true"
        echo
        ;;
    *)
        echo "Usage: npm run dev:provider:{onboard|probe|status}" >&2
        exit 2
        ;;
esac
