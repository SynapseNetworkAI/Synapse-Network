#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${SYNAPSE_LOAD_OUT_DIR:-${ROOT_DIR}/docs/evidence/performance/${TIMESTAMP}-local-production-load-rehearsal}"
LOG_FILE="${OUT_DIR}/local-production-load-rehearsal.log"

mkdir -p "$OUT_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "[local-production-load] evidence=${OUT_DIR}"
echo "[local-production-load] profile=${SYNAPSE_LOAD_PROFILE:-local-mvp}"

if [[ "${SYNAPSE_LOAD_PROFILE:-local-mvp}" != "local-mvp" ]]; then
  echo "FATAL: this runner only supports SYNAPSE_LOAD_PROFILE=local-mvp." >&2
  exit 1
fi

if [[ "${SYNAPSE_LOAD_SKIP_LOCAL_BOOTSTRAP:-0}" != "1" ]]; then
  echo "[local-production-load] bootstrapping local Gateway/contracts"
  bash "${ROOT_DIR}/scripts/local/setup_local_env.sh"

  echo "[local-production-load] starting local gateway-admin"
  bash "${ROOT_DIR}/services/gateway-admin/scripts/ops/restart.sh" local
else
  echo "[local-production-load] skipping local bootstrap; expecting Gateway, gateway-admin, RPC, and contracts to be running"
fi

export SYNAPSE_LOAD_OUT_DIR="$OUT_DIR"
export SYNAPSE_GATEWAY_BASE_URL="${SYNAPSE_GATEWAY_BASE_URL:-http://127.0.0.1:8000}"
export SYNAPSE_ADMIN_GATEWAY_BASE_URL="${SYNAPSE_ADMIN_GATEWAY_BASE_URL:-http://127.0.0.1:8300}"
export RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
export CHAIN_ID="${CHAIN_ID:-31337}"

node "${ROOT_DIR}/scripts/perf/local_production_load_rehearsal.mjs"

echo "[local-production-load] PASSED"
