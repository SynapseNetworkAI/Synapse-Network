#!/usr/bin/env bash

[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROVIDER_ROOT="${PROVIDER_ROOT:-${REPO_ROOT}/../Synapse-Network-Provider}"
GATEWAY_URL="${SYNAPSE_GATEWAY:-http://127.0.0.1:8000}"
ACTION="${1:-status}"

if [[ -x "${PROVIDER_ROOT}/scripts/onboard.local.sh" ]]; then
    ONBOARD_SCRIPT="${PROVIDER_ROOT}/scripts/onboard.local.sh"
elif [[ -x "${PROVIDER_ROOT}/scripts/local/onboard.sh" ]]; then
    ONBOARD_SCRIPT="${PROVIDER_ROOT}/scripts/local/onboard.sh"
else
    echo "Provider onboarding script not found under ${PROVIDER_ROOT}." >&2
    echo "Expected scripts/local/onboard.sh from Synapse-Network-Provider." >&2
    exit 1
fi

case "${ACTION}" in
    onboard)
        exec bash "${ONBOARD_SCRIPT}" ensure
        ;;
    probe)
        exec bash "${ONBOARD_SCRIPT}" ensure --wait-discoverable
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
