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
    services/gateway/src/services/provider/withdraw_helpers_mixin.py)
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
