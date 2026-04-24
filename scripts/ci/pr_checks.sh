#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REQUESTED_SCOPE="${SYNAPSE_CI_SCOPE:-auto}"
SCOPE_FILE="${SYNAPSE_CI_SCOPE_FILE:-}"

echo "[ci:pr] running pull request quality gates"
echo "[ci:pr] requested scope: ${REQUESTED_SCOPE}"

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
node - "$SCOPE_FILE" > "$COMMANDS_FILE" <<'NODE'
const fs = require("fs");
const scope = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const command of scope.commands || []) {
  console.log(command);
}
NODE

run_gate() {
  local gate="$1"
  echo "[ci:pr] RUN ${gate}"
  case "$gate" in
    runtime_preflight)
      bash "$ROOT_DIR/scripts/ci/runtime_preflight.sh"
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
    migration_seed_guard_scan)
      node "$ROOT_DIR/scripts/ci/migration_seed_guard_scan.mjs"
      ;;
    code_quality_architecture_scan)
      bash "$ROOT_DIR/scripts/ci/code_quality_architecture_scan.sh"
      ;;
    diff_coverage_gate)
      bash "$ROOT_DIR/scripts/ci/diff_coverage_gate.sh"
      ;;
    security_secret_scan)
      bash "$ROOT_DIR/scripts/ci/security_secret_scan.sh"
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

if [[ ! -s "$COMMANDS_FILE" ]]; then
  echo "FATAL CI-SCOPE-003: resolver returned no commands" >&2
  exit 2
fi

while IFS= read -r gate; do
  [[ -n "$gate" ]] || continue
  run_gate "$gate"
done < "$COMMANDS_FILE"

echo "[ci:pr] completed selected quality gates"
