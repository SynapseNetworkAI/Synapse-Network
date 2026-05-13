#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODE="${1:-${SYNAPSE_PR_LOCAL_MODE:-auto}}"
SCOPE_FILE="$(mktemp "${TMPDIR:-/tmp}/synapse-pr-local-scope.XXXXXX")"

case "$MODE" in
  fast|auto|local|full) ;;
  *)
    echo "Usage: bash scripts/ci/pr_local.sh [fast|auto|local|full]" >&2
    exit 2
    ;;
esac

REQUESTED_SCOPE="auto"
if [[ "$MODE" == "full" ]]; then
  REQUESTED_SCOPE="full"
fi

node "$ROOT_DIR/scripts/ci/resolve_pr_ci_scope.mjs" \
  --mode "$REQUESTED_SCOPE" \
  --base "${QUALITY_BASE_REF:-origin/main}" \
  --head HEAD \
  --json "$SCOPE_FILE" >/dev/null

echo "[ci:pr:local] mode=${MODE}"

if [[ "$MODE" == "fast" ]]; then
  FAST_HAS_PRETTIER=0
  if [[ -x "$ROOT_DIR/node_modules/.bin/prettier" ]] ||
    command -v prettier >/dev/null 2>&1 ||
    npx --no-install prettier --version >/dev/null 2>&1; then
    FAST_HAS_PRETTIER=1
  fi
  FAST_COMMANDS="$(
    SYNAPSE_FAST_HAS_PRETTIER="$FAST_HAS_PRETTIER" node - "$SCOPE_FILE" <<'NODE'
const fs = require("fs");
const scope = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const fastAllowed = new Set([
  "github_actions_runtime_check",
  "ci_meta_checks",
  "local_runtime_guard_scan",
  "quality_budget_check",
  "security_secret_scan",
  "docs_checks",
  "release_go_no_go_checks",
  "frontend_checks",
  "admin_front_checks",
  "gateway_checks",
  "admin_gateway_checks",
  "provider_service_checks",
  "sdk_python_checks",
  "contracts_checks",
  "terraform_staging_validate",
]);
if (process.env.SYNAPSE_FAST_HAS_PRETTIER === "1") {
  fastAllowed.add("format_check");
}
console.log((scope.commands || []).filter((command) => fastAllowed.has(command)).join(","));
NODE
  )"
  if [[ "$FAST_HAS_PRETTIER" != "1" ]]; then
    echo "[ci:pr:local] fast mode skipped format_check because Prettier is not installed"
  fi
  SYNAPSE_CI_SCOPE_FILE="$SCOPE_FILE" \
    SYNAPSE_CI_SCOPE="$REQUESTED_SCOPE" \
    SYNAPSE_CI_COMMANDS="$FAST_COMMANDS" \
    bash "$ROOT_DIR/scripts/ci/pr_checks.sh"
else
  SYNAPSE_CI_SCOPE_FILE="$SCOPE_FILE" \
    SYNAPSE_CI_SCOPE="$REQUESTED_SCOPE" \
    bash "$ROOT_DIR/scripts/ci/pr_checks.sh"
fi
