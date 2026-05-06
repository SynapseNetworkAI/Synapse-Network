#!/usr/bin/env bash

if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# scripts/ is a symlink (→ tools/scripts); logical path is Synapse-Network/scripts/local
# so repo root is two levels up from SCRIPT_DIR, not three.
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PID_FILE="${ROOT_DIR}/.local_env.pids"

find_pid_by_port() {
  local port="$1"
  lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

ANVIL_PID=""
PROVIDER_PID=""
FRONTEND_PID=""
DOCS_FRONT_PID=""
ADMIN_FRONT_PID=""
ANALYTICS_OUTBOX_PID=""
NOTIFICATION_OUTBOX_PID=""
GATEWAY_SCREEN_SESSION="synapse-gateway"
ANALYTICS_OUTBOX_SCREEN_SESSION="synapse-gateway-analytics-outbox"
NOTIFICATION_OUTBOX_SCREEN_SESSION="synapse-gateway-notification-outbox"

if [[ -f "$PID_FILE" ]]; then
  source "$PID_FILE"
  DOCS_FRONT_PID="${DOCS_FRONT_PID:-$(find_pid_by_port 3100)}"
  ADMIN_FRONT_PID="${ADMIN_FRONT_PID:-$(find_pid_by_port 3200)}"
else
  echo "No PID file found at: $PID_FILE"
  echo "Trying fallback by port scan (8545 / 8000 / 3000 / 3100 / 3200)..."
  ANVIL_PID="$(find_pid_by_port 8545)"
  PROVIDER_PID="$(find_pid_by_port 8000)"
  FRONTEND_PID="$(find_pid_by_port 3000)"
  DOCS_FRONT_PID="$(find_pid_by_port 3100)"
  ADMIN_FRONT_PID="$(find_pid_by_port 3200)"
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

stop_screen_session() {
  local name="$1"
  local session_name="$2"

  if ! command -v screen >/dev/null 2>&1; then
    echo "${name}: screen unavailable, skip session ${session_name}"
    return
  fi

  if screen -list 2>/dev/null | grep -q "[.]${session_name}[[:space:]]"; then
    screen -S "$session_name" -X quit >/dev/null 2>&1 || true
    echo "${name}: stopped screen session (${session_name})"
  else
    echo "${name}: screen session not running (${session_name})"
  fi
}

echo "=== Stopping Synapse local environment ==="
stop_pid "Anvil" "${ANVIL_PID:-}"
stop_pid "ProviderAPI" "${PROVIDER_PID:-}"
stop_screen_session "ProviderAPI" "$GATEWAY_SCREEN_SESSION"
stop_pid "AnalyticsOutboxWorker" "${ANALYTICS_OUTBOX_PID:-}"
stop_pid "NotificationOutboxWorker" "${NOTIFICATION_OUTBOX_PID:-}"
stop_screen_session "AnalyticsOutboxWorker" "$ANALYTICS_OUTBOX_SCREEN_SESSION"
stop_screen_session "NotificationOutboxWorker" "$NOTIFICATION_OUTBOX_SCREEN_SESSION"
stop_pid "Frontend" "${FRONTEND_PID:-}"
stop_pid "DocsFront" "${DOCS_FRONT_PID:-}"
stop_pid "AdminFront" "${ADMIN_FRONT_PID:-}"

if [[ -f "$PID_FILE" ]]; then
  rm -f "$PID_FILE"
  echo "Removed PID file: $PID_FILE"
fi

echo "Done."
