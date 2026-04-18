#!/usr/bin/env bash

set -euo pipefail

drill_repo_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd
}

drill_require_staging_confirmation() {
  if [[ "${SYNAPSE_DRILL_ENV:-}" != "staging" ]]; then
    echo "[drill] refusing to run: set SYNAPSE_DRILL_ENV=staging" >&2
    exit 2
  fi
  if [[ "${SYNAPSE_DRILL_CONFIRM:-}" != "I_UNDERSTAND_THIS_CHANGES_STAGING" ]]; then
    echo "[drill] refusing to run: set SYNAPSE_DRILL_CONFIRM=I_UNDERSTAND_THIS_CHANGES_STAGING" >&2
    exit 2
  fi
}

drill_require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "[drill] missing required environment variable: $name" >&2
    exit 2
  fi
}

drill_timestamp() {
  date -u +"%Y%m%dT%H%M%SZ"
}

drill_evidence_dir() {
  local root="$1"
  local suite="$2"
  local timestamp="${SYNAPSE_DRILL_RUN_ID:-$(drill_timestamp)}"
  printf "%s/docs/evidence/performance/%s-%s" "$root" "$timestamp" "$suite"
}

drill_write_run_metadata() {
  local out_dir="$1"
  local suite="$2"
  local root="$3"
  mkdir -p "$out_dir"
  {
    echo "{"
    echo "  \"suite\": \"$suite\","
    echo "  \"environment\": \"${SYNAPSE_DRILL_ENV:-}\","
    echo "  \"commit\": \"$(cd "$root" && git rev-parse --short HEAD)\","
    echo "  \"startedAtUtc\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\""
    echo "}"
  } > "$out_dir/run-metadata.json"
}

drill_run_step() {
  local label="$1"
  local command="$2"
  local out_dir="$3"
  echo "[drill] $label"
  bash -lc "$command" 2>&1 | tee "$out_dir/${label// /_}.log"
}

