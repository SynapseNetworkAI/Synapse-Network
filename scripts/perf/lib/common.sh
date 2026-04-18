#!/usr/bin/env bash

set -euo pipefail

synapse_repo_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd
}

synapse_require_staging_confirmation() {
  local env_name="${SYNAPSE_PERF_ENV:-}"
  local confirm="${SYNAPSE_PERF_CONFIRM:-}"
  if [[ "$env_name" != "staging" ]]; then
    echo "[perf] refusing to run: set SYNAPSE_PERF_ENV=staging" >&2
    exit 2
  fi
  if [[ "$confirm" != "I_UNDERSTAND_THIS_HITS_STAGING" ]]; then
    echo "[perf] refusing to run: set SYNAPSE_PERF_CONFIRM=I_UNDERSTAND_THIS_HITS_STAGING" >&2
    exit 2
  fi
}

synapse_require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "[perf] missing required environment variable: $name" >&2
    exit 2
  fi
}

synapse_timestamp() {
  date -u +"%Y%m%dT%H%M%SZ"
}

synapse_evidence_dir() {
  local root="$1"
  local suite="$2"
  local timestamp="${SYNAPSE_PERF_RUN_ID:-$(synapse_timestamp)}"
  printf "%s/docs/evidence/performance/%s-%s" "$root" "$timestamp" "$suite"
}

synapse_write_run_metadata() {
  local out_dir="$1"
  local suite="$2"
  local root="$3"
  mkdir -p "$out_dir"
  {
    echo "{"
    echo "  \"suite\": \"$suite\","
    echo "  \"environment\": \"${SYNAPSE_PERF_ENV:-}\","
    echo "  \"commit\": \"$(cd "$root" && git rev-parse --short HEAD)\","
    echo "  \"startedAtUtc\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\""
    echo "}"
  } > "$out_dir/run-metadata.json"
}

synapse_print_report_hint() {
  local out_dir="$1"
  echo "[perf] evidence directory: $out_dir"
  echo "[perf] attach report.md, summary.json, logs, screenshots, and reconciliation files before marking validation PASS"
}

