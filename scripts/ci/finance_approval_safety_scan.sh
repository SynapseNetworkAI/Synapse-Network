#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOL_RUNNER="$ROOT_DIR/scripts/ci/run_guardrail_tool.sh"
CONFIG_FILES=(
  "$ROOT_DIR/semgrep/finance-approval-safety.yml"
  "$ROOT_DIR/semgrep/gateway-financial-security.yml"
)

changed_targets() {
  if [[ "${FINANCE_SECURITY_SCOPE:-changed}" == "full" ]]; then
    printf '%s\n' "$ROOT_DIR"
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

TARGETS=()
if [[ "${FINANCE_SECURITY_SCOPE:-changed}" == "full" ]]; then
  TARGETS=("$ROOT_DIR")
else
  while IFS= read -r file; do
    [[ -n "$file" && -f "$ROOT_DIR/$file" ]] || continue
    case "$file" in
      services/gateway/src/*.py|services/gateway/src/**/*.py|services/gateway-admin/src/*.py|services/gateway-admin/src/**/*.py|services/admin-front/src/*.ts|services/admin-front/src/**/*.ts|services/admin-front/src/*.tsx|services/admin-front/src/**/*.tsx|scripts/ci/*.sh|scripts/ci/*.py|scripts/ci/*.mjs|scripts/ci/**/*.mjs|scripts/lib/*.mjs|semgrep/*.yml)
        TARGETS+=("$ROOT_DIR/$file")
        ;;
    esac
  done < <(changed_targets | sort -u)
fi

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  echo "[finance-approval-safety] no changed files in Semgrep-gated paths"
  exit 0
fi

status=0
for config_file in "${CONFIG_FILES[@]}"; do
  echo "[finance-approval-safety] running Semgrep rules: ${config_file#$ROOT_DIR/}"
  if ! "$TOOL_RUNNER" semgrep semgrep -- \
    --config "$config_file" \
    --error \
    --quiet \
    --exclude node_modules \
    --exclude .next \
    --exclude .venv \
    --exclude venv \
    "${TARGETS[@]}"; then
    status=1
  fi
done

if [[ "$status" -ne 0 ]]; then
  cat >&2 <<'EOF'
FATAL FIN-SEMGREP-001: one or more financial Semgrep gates failed.
Why dangerous: security, money, approval, logging, SQL, or transaction hazards can enter
the funds path before review.
Agent fix: read each Semgrep finding above and apply its Agent fix instruction before
rerunning `npm run ci:financial-security`.
EOF
  exit "$status"
fi

echo "[finance-approval-safety] passed"
