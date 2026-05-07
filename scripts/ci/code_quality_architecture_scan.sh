#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOL_RUNNER="$ROOT_DIR/scripts/ci/run_guardrail_tool.sh"

fail_missing_tool() {
  tool="$1"
  install="$2"
  cat >&2 <<EOF
FATAL ARCH-TOOL-000: ${tool} is required for architecture quality gates.
Why dangerous: without ${tool}, Agent-generated spaghetti code or copy-paste logic can
enter finance paths before review.
Agent fix: ${install}
EOF
  exit 1
}

changed_files() {
  if [[ "${CODE_QUALITY_SCOPE:-changed}" == "full" ]]; then
    git -C "$ROOT_DIR" ls-files
    return
  fi
  base_ref="${QUALITY_BASE_REF:-origin/main}"
  if merge_base="$(git -C "$ROOT_DIR" merge-base HEAD "$base_ref" 2>/dev/null)"; then
    git -C "$ROOT_DIR" diff --name-only "$merge_base" --
  else
    git -C "$ROOT_DIR" diff --name-only HEAD --
  fi
  git -C "$ROOT_DIR" ls-files --others --exclude-standard
}

ALL_CHANGED=()
while IFS= read -r file; do
  [[ -n "$file" ]] && ALL_CHANGED+=("$file")
done < <(changed_files | sort -u)

is_jscpd_baselined() {
  case "$1" in
    services/user-front/src/components/provider-workspace/ProviderSettlementsPage.tsx|\
    services/gateway/src/core/metrics.py|\
    services/gateway-admin/src/core/metrics.py|\
    services/gateway/src/storage/postgres/repositories/gateway_state_refund_mixin.py|\
    services/gateway/src/services/provider/withdraw_helpers_mixin.py|\
    scripts/e2e/admin_front_seed.mjs|\
    scripts/ui/dogfood_admin_analytics_10k.mjs|\
    scripts/ui/dogfood_admin_front.mjs|\
    scripts/ui/dogfood_admin_login_lockout.mjs|\
    scripts/ui/dogfood_admin_withdrawal_approval.mjs)
      return 0
      ;;
  esac
  return 1
}

add_quality_file() {
  local file="$1"
  if is_jscpd_baselined "$file"; then
    echo "[architecture-quality] JSCPD baseline skip: $file"
    return
  fi
  QUALITY_FILES+=("$ROOT_DIR/$file")
}

PY_FILES=()
QUALITY_FILES=()
for file in "${ALL_CHANGED[@]}"; do
  [[ -f "$ROOT_DIR/$file" ]] || continue
  case "$file" in
    services/gateway/src/*.py|services/gateway/src/**/*.py|services/gateway-admin/src/*.py|services/gateway-admin/src/**/*.py|scripts/*.py|scripts/**/*.py)
      PY_FILES+=("$ROOT_DIR/$file")
      add_quality_file "$file"
      ;;
    services/admin-front/src/*.ts|services/admin-front/src/**/*.ts|services/admin-front/src/*.tsx|services/admin-front/src/**/*.tsx|services/user-front/src/*.ts|services/user-front/src/**/*.ts|services/user-front/src/*.tsx|services/user-front/src/**/*.tsx|scripts/*.mjs|scripts/**/*.mjs|infra/**/*.sql)
      add_quality_file "$file"
      ;;
  esac
done

if [[ ${#PY_FILES[@]} -eq 0 && ${#QUALITY_FILES[@]} -eq 0 ]]; then
  echo "[architecture-quality] no changed code files in gated paths"
  exit 0
fi

if command -v jscpd >/dev/null 2>&1; then
  JSCPD_CMD=(jscpd)
elif npx --no-install jscpd --version >/dev/null 2>&1; then
  JSCPD_CMD=(npx --no-install jscpd)
else
  fail_missing_tool "jscpd" "install JSCPD (for example: npm install --save-dev jscpd or npm install -g jscpd) and rerun npm run ci:architecture-quality."
fi

if [[ ${#PY_FILES[@]} -gt 0 ]]; then
  echo "[architecture-quality] running Ruff on ${#PY_FILES[@]} changed Python file(s)"
  "$TOOL_RUNNER" ruff ruff -- check --config "$ROOT_DIR/ruff.toml" "${PY_FILES[@]}" || {
    cat >&2 <<'EOF'
FATAL ARCH-RUFF-001: Ruff failed.
Why dangerous: lint, bugbear, security, and complexity findings indicate code that is
likely brittle or hard to audit.
Agent fix: address each Ruff finding directly; for C901, extract methods/classes until the
function has a small single responsibility.
EOF
    exit 1
  }

  echo "[architecture-quality] running Radon on changed Python file(s)"
  "$TOOL_RUNNER" radon radon -- cc -n B "${PY_FILES[@]}" || {
    cat >&2 <<'EOF'
FATAL ARCH-RADON-001: Radon cyclomatic complexity failed.
Why dangerous: complex finance functions hide rare state transitions and replay bugs.
Agent fix: split validation, state transition, persistence, and audit code into small
functions; prefer explicit state handlers over nested branches.
EOF
    exit 1
  }
  "$TOOL_RUNNER" radon radon -- mi -n B "${PY_FILES[@]}" || {
    cat >&2 <<'EOF'
FATAL ARCH-RADON-002: Radon maintainability index is below B.
Why dangerous: low maintainability code is expensive to review and easy for Agent changes
to break later.
Agent fix: reduce function length, remove duplicated branches, name intermediate concepts,
and add comments only around unavoidable business complexity.
EOF
    exit 1
  }
fi

echo "[architecture-quality] running repo-specific finance shape scan"
python3 "$ROOT_DIR/scripts/ci/code_quality_architecture_scan.py"

echo "[architecture-quality] running source contract quality scan"
python3 "$ROOT_DIR/scripts/ci/source_quality_checks.py"

if rg -n "write_credential_rows|save_credential_rows" "$ROOT_DIR/services/gateway/src" >/tmp/synapse-credential-runtime-dangerous-writes.txt; then
  cat >&2 <<'EOF'
FATAL ARCH-CREDENTIAL-001: Forbidden credential full-list write path found.
Why dangerous: runtime credential lifecycle must never replace or prune the full
credential list because historical quotes, invocations, ledger rows, and audit
evidence keep foreign keys to credential/profile rows.
Agent fix: use create_runtime_credential, rotate_runtime_credential,
revoke_runtime_credential, update_runtime_credential_policy,
update_runtime_credential_metadata, increment_credential_usage, or
decrement_credential_usage.
EOF
  cat >&2 /tmp/synapse-credential-runtime-dangerous-writes.txt
  exit 1
fi

if git -C "$ROOT_DIR" grep -n -i -E "state_key[[:space:]]+LIKE.*service_health_" -- \
  services/gateway/src \
  ':!services/gateway/src/storage/postgres/repositories/service_registry_health_mixin.py' \
  >/tmp/synapse-runtime-state-health-like.txt; then
  cat >&2 <<'EOF'
FATAL ARCH-RUNTIME-STATE-001: Forbidden service_health runtime_state prefix scan found.
Why dangerous: service health is a high-frequency hot path and must use
synapse_service_health_runtime / synapse_service_health_events typed tables.
Agent fix: move the query to typed health tables. Only the controlled legacy
cleanup helper may reference state_key LIKE 'service_health_%'.
EOF
  cat >&2 /tmp/synapse-runtime-state-health-like.txt
  exit 1
fi

if git -C "$ROOT_DIR" grep -n -i "row_to_json" -- services/gateway-admin/src >/tmp/synapse-admin-row-to-json.txt; then
  cat >&2 <<'EOF'
FATAL ARCH-ADMIN-PROJECTION-001: Forbidden SQL-side JSON projection found in gateway-admin.
Why dangerous: row_to_json flattens Postgres NUMERIC/DATE/TIMESTAMPTZ values into
strings before psycopg can map them to Decimal/date/datetime.
Agent fix: query explicit native columns and map them into typed read models in
the repository/data-mapper layer.
EOF
  cat >&2 /tmp/synapse-admin-row-to-json.txt
  exit 1
fi

if git -C "$ROOT_DIR" grep -n -i -E "SELECT[[:space:]]+\\*" -- \
  services/gateway-admin/src/storage/analytics \
  >/tmp/synapse-admin-analytics-select-star.txt; then
  cat >&2 <<'EOF'
FATAL ARCH-ADMIN-PROJECTION-002: Forbidden SELECT * found in gateway-admin analytics projections.
Why dangerous: dashboard projection read models are finance/ops contracts; wildcard
queries hide drift and make column type regressions harder to review.
Agent fix: select explicit projection columns and map them into typed read models.
EOF
  cat >&2 /tmp/synapse-admin-analytics-select-star.txt
  exit 1
fi

if git -C "$ROOT_DIR" grep -n -E "filters\\.(DepositInfo|WithdrawInfo)|queryFilter\\([^)]*(DepositInfo|WithdrawInfo)" -- \
  services/user-front/src \
  ':!services/user-front/src/**/*.test.ts' \
  ':!services/user-front/src/**/*.test.tsx' \
  >/tmp/synapse-user-front-chain-payments-scan.txt; then
  cat >&2 <<'EOF'
FATAL ARCH-FRONT-PAYMENTS-001: Forbidden user-front chain event scan found for Payments/funds history.
Why dangerous: consumer-facing balances, Payments rows, and withdrawal state must come
from Gateway DB/API truth. Frontend chain logs are allowed only for transient wallet
feedback, not persistent ledger rows.
Agent fix: read Gateway deposit intents, withdrawal rows, and refund rows, then do
display-only concat/sort in the client.
EOF
  cat >&2 /tmp/synapse-user-front-chain-payments-scan.txt
  exit 1
fi

if git -C "$ROOT_DIR" grep -n -E "\\.withdrawPlatformFees\\(|encodeFunctionData\\([^)]*withdrawPlatformFees" -- \
  services/user-front/src services/admin-front/src \
  ':!services/user-front/src/**/*.test.ts' \
  ':!services/user-front/src/**/*.test.tsx' \
  ':!services/admin-front/src/**/*.test.ts' \
  ':!services/admin-front/src/**/*.test.tsx' \
  ':!services/user-front/src/**/*ABI.json' \
  >/tmp/synapse-front-platform-fee-direct-exec.txt; then
  cat >&2 <<'EOF'
FATAL ARCH-FRONT-TREASURY-001: Forbidden frontend platform fee withdrawal execution path found.
Why dangerous: platform fee withdrawal must stay server-owned and Safe or owner controlled;
frontend surfaces may display evidence or create drafts, but they must not broadcast
withdrawPlatformFees directly.
Agent fix: move the action behind a backend-owned Safe draft or controlled local E2E helper;
do not execute treasury withdrawal from user-front or admin-front runtime code.
EOF
  cat >&2 /tmp/synapse-front-platform-fee-direct-exec.txt
  exit 1
fi

if git -C "$ROOT_DIR" grep -n -i -E "synapse_runtime_state.*LIKE|state_key[[:space:]]+LIKE" -- \
  services/gateway/src services/gateway-admin/src \
  >/tmp/synapse-runtime-state-like-warning.txt; then
  echo "[architecture-quality] WARNING: runtime_state LIKE usage found; allowed only for cleanup/compat paths." >&2
  cat >&2 /tmp/synapse-runtime-state-like-warning.txt
fi

if [[ ${#QUALITY_FILES[@]} -gt 1 ]]; then
  echo "[architecture-quality] running JSCPD on ${#QUALITY_FILES[@]} changed code file(s)"
  "${JSCPD_CMD[@]}" --config "$ROOT_DIR/.jscpd.json" "${QUALITY_FILES[@]}" || {
    cat >&2 <<'EOF'
FATAL ARCH-DUPLICATION-001: JSCPD found duplicated code.
Why dangerous: copied consumer/provider/refund/withdraw logic drifts and creates money
state inconsistencies.
Agent fix: extract the duplicated logic into a shared service/helper/state-machine layer,
then keep only role-specific policy in the caller.
EOF
    exit 1
  }
else
  echo "[architecture-quality] skipping JSCPD; fewer than two changed code files"
fi

echo "[architecture-quality] passed"
