#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TIMEOUT_SEC="${CI_RUNTIME_PREFLIGHT_TIMEOUT_SEC:-8}"
COLLECT_ALL_FAILURES="${CI_RUNTIME_PREFLIGHT_COLLECT_ALL:-false}"

failures=0

record_failure() {
  failures=$((failures + 1))
  if [[ "$COLLECT_ALL_FAILURES" != "true" ]]; then
    echo "[ci:runtime-preflight] failed fast after first runtime issue" >&2
    exit 1
  fi
}

run_probe() {
  label="$1"
  shift

  local stdout_file stderr_file pid elapsed status
  stdout_file="$(mktemp -t synapse-ci-preflight-out.XXXXXX)"
  stderr_file="$(mktemp -t synapse-ci-preflight-err.XXXXXX)"

  echo "[ci:runtime-preflight] probing ${label}: $*"

  "$@" >"$stdout_file" 2>"$stderr_file" &
  pid="$!"
  disown "$pid" 2>/dev/null || true
  elapsed=0

  while kill -0 "$pid" >/dev/null 2>&1; do
    if [[ "$elapsed" -ge "$TIMEOUT_SEC" ]]; then
      echo "[ci:runtime-preflight] ERROR: ${label} did not start within ${TIMEOUT_SEC}s; killing PID ${pid}" >&2
      kill "$pid" >/dev/null 2>&1 || true
      sleep 1
      kill -9 "$pid" >/dev/null 2>&1 || true
      wait "$pid" 2>/dev/null || true
      echo "[ci:runtime-preflight] ${label} appears stuck before command output." >&2
      echo "[ci:runtime-preflight] On macOS this can look like processes parked in _dyld_start." >&2
      echo "[ci:runtime-preflight] Restart the affected terminal/Codex session, then rerun: bash scripts/ci/pr_checks.sh" >&2
      rm -f "$stdout_file" "$stderr_file"
      record_failure
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  if wait "$pid"; then
    status=0
  else
    status="$?"
  fi

  if [[ "$status" -ne 0 ]]; then
    echo "[ci:runtime-preflight] ERROR: ${label} exited with ${status}" >&2
    if [[ -s "$stdout_file" ]]; then
      sed 's/^/[stdout] /' "$stdout_file" >&2
    fi
    if [[ -s "$stderr_file" ]]; then
      sed 's/^/[stderr] /' "$stderr_file" >&2
    fi
    record_failure
  else
    local first_line
    first_line="$(head -n 1 "$stdout_file" 2>/dev/null || true)"
    if [[ -n "$first_line" ]]; then
      echo "[ci:runtime-preflight] ${label} ok: ${first_line}"
    else
      echo "[ci:runtime-preflight] ${label} ok"
    fi
  fi

  rm -f "$stdout_file" "$stderr_file"
}

probe_python_if_present() {
  label="$1"
  python_bin="$2"
  if [[ -x "$python_bin" ]]; then
    run_probe "$label" "$python_bin" -V
  else
    echo "[ci:runtime-preflight] skipping ${label}: ${python_bin} not found"
  fi
}

if ! command -v node >/dev/null 2>&1; then
  echo "[ci:runtime-preflight] ERROR: node is not on PATH" >&2
  record_failure
else
  run_probe "node" node -v
fi

probe_python_if_present "gateway python" "$ROOT_DIR/services/gateway/.venv/bin/python"
probe_python_if_present "gateway-admin python" "$ROOT_DIR/services/gateway-admin/.venv/bin/python"
probe_python_if_present "provider-service python" "$ROOT_DIR/../Synapse-Network-Provider/.venv/bin/python"
probe_python_if_present "sdk-python python" "$ROOT_DIR/sdk/python/.venv/bin/python"

if [[ "$failures" -gt 0 ]]; then
  echo "[ci:runtime-preflight] failed with ${failures} runtime issue(s)" >&2
  exit 1
fi

echo "[ci:runtime-preflight] runtime probes passed"
