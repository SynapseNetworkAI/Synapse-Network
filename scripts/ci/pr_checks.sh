#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REQUESTED_SCOPE="${SYNAPSE_CI_SCOPE:-auto}"
SCOPE_FILE="${SYNAPSE_CI_SCOPE_FILE:-}"
COMMAND_FILTER="${SYNAPSE_CI_COMMANDS:-${SYNAPSE_CI_ONLY_GATES:-}}"
SKIP_AGENT_LESSONS="${SYNAPSE_SKIP_AGENT_LESSONS:-${SYNAPSE_CI_SKIP_AGENT_LESSONS:-0}}"

echo "[ci:pr] running pull request quality gates"
echo "[ci:pr] requested scope: ${REQUESTED_SCOPE}"
if [[ -n "$COMMAND_FILTER" ]]; then
  echo "[ci:pr] command filter: ${COMMAND_FILTER}"
fi

if [[ "$SKIP_AGENT_LESSONS" == "1" ]]; then
  echo "[ci:pr] skipping agent lessons gate for this shard"
else
  npm run ci:agent-lessons
fi

if [[ "$REQUESTED_SCOPE" != "auto" && "$REQUESTED_SCOPE" != "full" ]]; then
  echo "FATAL CI-SCOPE-001: SYNAPSE_CI_SCOPE must be auto or full" >&2
  exit 2
fi

if [[ -z "$SCOPE_FILE" || ! -f "$SCOPE_FILE" ]]; then
  SCOPE_FILE="$(mktemp "${TMPDIR:-/tmp}/synapse-pr-ci-scope.XXXXXX")"
  node "$ROOT_DIR/scripts/ci/resolve_pr_ci_scope.mjs" \
    --mode "$REQUESTED_SCOPE" \
    --json "$SCOPE_FILE" >/dev/null
fi

node - "$SCOPE_FILE" <<'NODE'
const fs = require("fs");
const scope = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log(`[ci:pr] resolved mode: ${scope.mode}${scope.failClosed ? " (fail-closed)" : ""}`);
console.log(`[ci:pr] affected projects: ${(scope.affectedProjects || []).join(", ") || "none"}`);
console.log(`[ci:pr] risk scopes: ${(scope.riskScopes || []).join(", ") || "none"}`);
console.log(`[ci:pr] commands: ${(scope.commands || []).join(", ") || "none"}`);
for (const reason of scope.reasons || []) {
  console.log(`[ci:pr] reason: ${reason}`);
}
NODE

COMMANDS_FILE="$(mktemp "${TMPDIR:-/tmp}/synapse-pr-ci-commands.XXXXXX")"
TIMINGS_FILE="$(mktemp "${TMPDIR:-/tmp}/synapse-pr-ci-timings.XXXXXX")"
node - "$SCOPE_FILE" "$COMMAND_FILTER" > "$COMMANDS_FILE" <<'NODE'
const fs = require("fs");
const scope = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const requested = String(process.argv[3] || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const allowed = new Set(requested);
const available = new Set(scope.commands || []);
for (const command of requested) {
  if (!available.has(command)) {
    console.error(
      `FATAL CI-SCOPE-004: requested command '${command}' is not in resolved PR scope`
    );
    process.exit(2);
  }
}
const commands = requested.length
  ? (scope.commands || []).filter((command) => allowed.has(command))
  : scope.commands || [];
for (const command of commands) {
  console.log(command);
}
NODE

run_gate_command() {
  local gate="$1"
  case "$gate" in
    runtime_preflight)
      bash "$ROOT_DIR/scripts/ci/runtime_preflight.sh"
      ;;
    github_actions_runtime_check)
      npm run ci:github-actions-runtime
      ;;
    ci_meta_checks)
      bash "$ROOT_DIR/scripts/ci/ci_meta_checks.sh"
      ;;
    security_money_scan)
      bash "$ROOT_DIR/scripts/ci/security_money_scan.sh"
      ;;
    security_money_ts_scan)
      bash "$ROOT_DIR/scripts/ci/security_money_ts_scan.sh"
      ;;
    finance_approval_safety_scan)
      bash "$ROOT_DIR/scripts/ci/finance_approval_safety_scan.sh"
      ;;
    finance_mypy_scan)
      bash "$ROOT_DIR/scripts/ci/finance_mypy_scan.sh"
      ;;
    local_runtime_guard_scan)
      bash "$ROOT_DIR/scripts/ci/local_runtime_guard_scan.sh"
      ;;
    e2e_script_model_drift_scan)
      node "$ROOT_DIR/scripts/ci/e2e_script_model_drift_scan.mjs"
      ;;
    code_quality_architecture_scan)
      bash "$ROOT_DIR/scripts/ci/code_quality_architecture_scan.sh"
      ;;
    quality_budget_check)
      npm run ci:quality-budget
      ;;
    format_check)
      npm run ci:format-check
      ;;
    diff_coverage_gate)
      bash "$ROOT_DIR/scripts/ci/diff_coverage_gate.sh"
      ;;
    security_secret_scan)
      bash "$ROOT_DIR/scripts/ci/security_secret_scan.sh"
      ;;
    e2e_env_isolation_check)
      node "$ROOT_DIR/scripts/ci/e2e_env_isolation_check.mjs"
      ;;
    gateway_stress_review_checks)
      bash "$ROOT_DIR/scripts/ci/gateway_stress_review_checks.sh"
      ;;
    monitoring_alert_rules)
      npm run ci:monitoring-alert-rules
      ;;
    docs_checks)
      bash "$ROOT_DIR/scripts/ci/docs_checks.sh"
      ;;
    release_go_no_go_checks)
      bash "$ROOT_DIR/scripts/ci/release_go_no_go_checks.sh"
      ;;
    frontend_checks)
      bash "$ROOT_DIR/scripts/ci/frontend_checks.sh"
      ;;
    admin_front_checks)
      bash "$ROOT_DIR/scripts/ci/admin_front_checks.sh"
      ;;
    gateway_checks)
      bash "$ROOT_DIR/scripts/ci/gateway_checks.sh"
      ;;
    performance_reliability_checks)
      bash "$ROOT_DIR/scripts/ci/performance_reliability_checks.sh"
      ;;
    admin_gateway_checks)
      bash "$ROOT_DIR/scripts/ci/admin_gateway_checks.sh"
      ;;
    provider_service_checks)
      bash "$ROOT_DIR/scripts/ci/provider_service_checks.sh"
      ;;
    sdk_python_checks)
      bash "$ROOT_DIR/scripts/ci/sdk_python_checks.sh"
      ;;
    contracts_checks)
      bash "$ROOT_DIR/scripts/ci/contracts_checks.sh"
      ;;
    terraform_staging_validate)
      terraform -chdir="$ROOT_DIR/infra/terraform/gcp-staging" fmt -check
      terraform -chdir="$ROOT_DIR/infra/terraform/gcp-staging" init -backend=false -input=false
      terraform -chdir="$ROOT_DIR/infra/terraform/gcp-staging" validate
      ;;
    *)
      echo "FATAL CI-SCOPE-002: unknown PR CI gate '${gate}'" >&2
      exit 2
      ;;
  esac
}

run_gate() {
  local gate="$1"
  local started_at ended_at duration status
  started_at="$(date +%s)"
  echo "[ci:pr] RUN ${gate}"
  if run_gate_command "$gate"; then
    status="passed"
  else
    status="failed"
  fi
  ended_at="$(date +%s)"
  duration="$((ended_at - started_at))"
  printf '%s\t%s\t%s\n' "$gate" "$duration" "$status" >> "$TIMINGS_FILE"
  echo "[ci:pr] DONE ${gate} status=${status} duration=${duration}s"
  if [[ "$status" != "passed" ]]; then
    return 1
  fi
}

if [[ ! -s "$COMMANDS_FILE" ]]; then
  if [[ -n "$COMMAND_FILTER" ]]; then
    echo "[ci:pr] no commands selected for this shard; skipping"
    exit 0
  fi
  echo "FATAL CI-SCOPE-003: resolver returned no commands" >&2
  exit 2
fi

while IFS= read -r gate; do
  [[ -n "$gate" ]] || continue
  run_gate "$gate"
done < "$COMMANDS_FILE"

echo "[ci:pr] gate duration summary"
while IFS=$'\t' read -r gate duration status; do
  [[ -n "$gate" ]] || continue
  printf '[ci:pr] summary gate=%s status=%s duration=%ss\n' "$gate" "$status" "$duration"
done < "$TIMINGS_FILE"

echo "[ci:pr] completed selected quality gates"
