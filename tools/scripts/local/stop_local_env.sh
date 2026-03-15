#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PID_FILE="${ROOT_DIR}/.local_env.pids"

find_pid_by_port() {
  local port="$1"
  lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

ANVIL_PID=""
SELLER_PID=""
FRONTEND_PID=""

if [[ -f "$PID_FILE" ]]; then
  source "$PID_FILE"
else
  echo "No PID file found at: $PID_FILE"
  echo "Trying fallback by port scan (8545 / 8000 / 3000)..."
  ANVIL_PID="$(find_pid_by_port 8545)"
  SELLER_PID="$(find_pid_by_port 8000)"
  FRONTEND_PID="$(find_pid_by_port 3000)"
fi

stop_pid() {
  local name="$1"
  local pid="$2"

  if [[ -z "${pid:-}" ]]; then
    echo "${name}: PID not set, skip"
    return
  fi

  if kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1 || true
      echo "${name}: force killed (${pid})"
    else
      echo "${name}: stopped (${pid})"
    fi
  else
    echo "${name}: already stopped (${pid})"
  fi
}

echo "=== Stopping Synapse local environment ==="
stop_pid "Anvil" "${ANVIL_PID:-}"
stop_pid "SellerAPI" "${SELLER_PID:-}"
stop_pid "Frontend" "${FRONTEND_PID:-}"

if [[ -f "$PID_FILE" ]]; then
  rm -f "$PID_FILE"
  echo "Removed PID file: $PID_FILE"
fi

echo "Done."
