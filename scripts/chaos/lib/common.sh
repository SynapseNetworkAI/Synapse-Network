#!/usr/bin/env bash

set -euo pipefail

chaos_repo_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd
}

chaos_require_staging_confirmation() {
  if [[ "${SYNAPSE_CHAOS_ENV:-}" != "staging" ]]; then
    echo "[chaos] refusing to run: set SYNAPSE_CHAOS_ENV=staging" >&2
    exit 2
  fi
  if [[ "${SYNAPSE_CHAOS_CONFIRM:-}" != "I_UNDERSTAND_THIS_BREAKS_STAGING" ]]; then
    echo "[chaos] refusing to run: set SYNAPSE_CHAOS_CONFIRM=I_UNDERSTAND_THIS_BREAKS_STAGING" >&2
    exit 2
  fi
}

chaos_require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "[chaos] missing required environment variable: $name" >&2
    exit 2
  fi
}

chaos_timestamp() {
  date -u +"%Y%m%dT%H%M%SZ"
}

chaos_evidence_dir() {
  local root="$1"
  local suite="$2"
  local timestamp="${SYNAPSE_CHAOS_RUN_ID:-$(chaos_timestamp)}"
  printf "%s/docs/evidence/performance/%s-%s" "$root" "$timestamp" "$suite"
}

chaos_write_run_metadata() {
  local out_dir="$1"
  local suite="$2"
  local root="$3"
  mkdir -p "$out_dir"
  {
    echo "{"
    echo "  \"suite\": \"$suite\","
    echo "  \"environment\": \"${SYNAPSE_CHAOS_ENV:-}\","
    echo "  \"commit\": \"$(cd "$root" && git rev-parse --short HEAD)\","
    echo "  \"startedAtUtc\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\""
    echo "}"
  } > "$out_dir/run-metadata.json"
}

chaos_run_step() {
  local label="$1"
  local command="$2"
  local out_dir="$3"
  echo "[chaos] $label"
  bash -lc "$command" 2>&1 | tee "$out_dir/${label// /_}.log"
}

