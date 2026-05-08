#!/usr/bin/env bash

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

PID="$(find_running_pid)"
if [[ -z "${PID}" ]]; then
  echo "gateway-admin is not running"
  rm -f "${PID_FILE}"
  exit 0
fi

stop_pid "${PID}"
stop_screen_session
rm -f "${PID_FILE}"

echo "gateway-admin stopped: PID ${PID}"
