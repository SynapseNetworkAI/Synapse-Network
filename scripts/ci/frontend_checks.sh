#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="$ROOT_DIR/services/user-front"
PLAN_FILE="$(mktemp "${TMPDIR:-/tmp}/synapse-user-front-plan.XXXXXX").json"
SCOPE_FILE="${SYNAPSE_CI_SCOPE_FILE:-}"

cleanup() {
  rm -f "$PLAN_FILE"
}
trap cleanup EXIT

if [[ -n "$SCOPE_FILE" && -f "$SCOPE_FILE" ]]; then
  node "$ROOT_DIR/scripts/ci/frontend_scope_plan.mjs" \
    --scope "$SCOPE_FILE" \
    --project user-front \
    --json "$PLAN_FILE" >/dev/null
else
  TEMP_SCOPE_FILE="$(mktemp "${TMPDIR:-/tmp}/synapse-user-front-scope.XXXXXX").json"
  trap 'rm -f "$PLAN_FILE" "$TEMP_SCOPE_FILE"' EXIT
  node "$ROOT_DIR/scripts/ci/resolve_pr_ci_scope.mjs" \
    --mode "${SYNAPSE_CI_SCOPE:-auto}" \
    --json "$TEMP_SCOPE_FILE" >/dev/null
  node "$ROOT_DIR/scripts/ci/frontend_scope_plan.mjs" \
    --scope "$TEMP_SCOPE_FILE" \
    --project user-front \
    --json "$PLAN_FILE" >/dev/null
fi

plan_value() {
  local key="$1"
  node - "$PLAN_FILE" "$key" <<'NODE'
const fs = require("fs");
const plan = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const key = process.argv[3];
const value = plan[key];
if (Array.isArray(value)) {
  for (const item of value) console.log(item);
} else if (typeof value === "boolean") {
  console.log(value ? "true" : "false");
} else if (value !== undefined && value !== null) {
  console.log(String(value));
}
NODE
}

load_plan_array() {
  local key="$1"
  local target="$2"
  local line

  eval "$target=()"
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    eval "$target+=(\"\$line\")"
  done < <(plan_value "$key")
}

if [[ "$(plan_value skip)" == "true" ]]; then
  echo "[ci:frontend] skipping user-front shard: $(plan_value reason)"
  exit 0
fi

# GitHub runners do not have developer-local .env.local files. Keep the
# user-front fail-fast env preflight enabled, but provide non-secret public
# defaults for the build step. Do not export these globally: several unit tests
# intentionally verify no-env local fallback behavior.
echo "[ci:frontend] running next.js quality gate in $APP_DIR"
echo "[ci:frontend] plan: $(plan_value reason)"
cd "$APP_DIR"

if [[ "$(plan_value runExternalLinks)" == "true" ]]; then
  node "$ROOT_DIR/scripts/ci/user_front_external_links_check.mjs"
fi
if [[ "$(plan_value runI18nScan)" == "true" ]]; then
  node "$ROOT_DIR/scripts/ci/user_front_i18n_check.mjs"
fi
if [[ "$(plan_value runUserErrorScan)" == "true" ]]; then
  node "$ROOT_DIR/scripts/ci/user_front_user_error_check.mjs"
fi
if [[ "$(plan_value runErrorDom)" == "true" ]]; then
  (cd "$ROOT_DIR" && npm run ci:user-front-error-dom)
fi
if [[ "$(plan_value runProviderWithdrawMatureDom)" == "true" ]]; then
  (cd "$ROOT_DIR" && npm run ci:provider-withdraw-mature-dom)
fi

if [[ "$(plan_value runLint)" == "true" ]]; then
  load_plan_array "lintFiles" "LINT_FILES"
  echo "[ci:frontend] running targeted lint on ${#LINT_FILES[@]} changed file(s)"
  LINT_ARGS=(next lint)
  for file in "${LINT_FILES[@]}"; do
    LINT_ARGS+=(--file "$file")
  done
  yarn "${LINT_ARGS[@]}"
else
  echo "[ci:frontend] skipping lint: no lintable user-front files in scope"
fi

if [[ "$(plan_value runRelatedTests)" == "true" ]]; then
  load_plan_array "relatedTestFiles" "RELATED_TEST_FILES"
  echo "[ci:frontend] running vitest related on ${#RELATED_TEST_FILES[@]} changed file(s)"
  yarn vitest related --run --passWithNoTests "${RELATED_TEST_FILES[@]}"
else
  echo "[ci:frontend] skipping vitest related: no testable user-front files in scope"
fi

if [[ "$(plan_value runTypecheck)" == "true" ]]; then
  echo "[ci:frontend] running TypeScript noEmit"
  ./node_modules/.bin/tsc --noEmit
fi

if [[ "$(plan_value runBuild)" == "true" ]]; then
  NEXT_PUBLIC_GATEWAY_BASE_URL="${NEXT_PUBLIC_GATEWAY_BASE_URL:-http://127.0.0.1:8000}" \
  NEXT_PUBLIC_ANALYTICS_ENDPOINT="${NEXT_PUBLIC_ANALYTICS_ENDPOINT:-http://127.0.0.1:8000/api/v1/events}" \
  NEXT_PUBLIC_APP_ENV="${NEXT_PUBLIC_APP_ENV:-local}" \
  NEXT_PUBLIC_DOCS_BASE_URL="${NEXT_PUBLIC_DOCS_BASE_URL:-http://localhost:3100}" \
  NEXT_PUBLIC_TX_EXPLORER_BASE_URL="${NEXT_PUBLIC_TX_EXPLORER_BASE_URL:-http://localhost:5100}" \
  NEXT_PUBLIC_RPC_URL="${NEXT_PUBLIC_RPC_URL:-http://127.0.0.1:8545}" \
  NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS="${NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS:-20000}" \
  NEXT_PUBLIC_SUPPORT_EMAIL="${NEXT_PUBLIC_SUPPORT_EMAIL:-support@synapse-network.ai}" \
  NEXT_PUBLIC_SUPPORT_PORTAL_URL="${NEXT_PUBLIC_SUPPORT_PORTAL_URL:-}" \
    yarn build
else
  echo "[ci:frontend] skipping production build: scope is test-only or static-only"
fi
