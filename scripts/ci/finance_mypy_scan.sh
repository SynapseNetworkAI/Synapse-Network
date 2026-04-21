#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOL_RUNNER="$ROOT_DIR/scripts/ci/run_guardrail_tool.sh"

changed_files() {
  if [[ "${FINANCE_MYPY_SCOPE:-changed}" == "full" ]]; then
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

TARGETS=()
while IFS= read -r file; do
  [[ -n "$file" && -f "$ROOT_DIR/$file" ]] || continue
  case "$file" in
    services/gateway/src/*finance*.py|services/gateway/src/**/*finance*.py|\
services/gateway/src/*withdraw*.py|services/gateway/src/**/*withdraw*.py|\
services/gateway/src/*refund*.py|services/gateway/src/**/*refund*.py|\
services/gateway/src/*balance*.py|services/gateway/src/**/*balance*.py|\
services/gateway/src/*ledger*.py|services/gateway/src/**/*ledger*.py|\
services/gateway/src/*settlement*.py|services/gateway/src/**/*settlement*.py|\
services/gateway/src/utils/money.py)
      TARGETS+=("$ROOT_DIR/$file")
      ;;
  esac
done < <(changed_files | sort -u)

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  echo "[finance-mypy] no changed finance-core Python files"
  exit 0
fi

echo "[finance-mypy] running mypy on ${#TARGETS[@]} finance-core Python file(s)"
if command -v uvx >/dev/null 2>&1; then
  MYPY_CMD=(
    uvx
    --from mypy
    --with pydantic
    --with fastapi
    --with web3
    --with eth-account
    mypy
  )
else
  MYPY_CMD=("$TOOL_RUNNER" mypy mypy --)
fi

if ! "${MYPY_CMD[@]}" --config-file "$ROOT_DIR/mypy-finance.ini" "${TARGETS[@]}"; then
  cat >&2 <<'EOF'
FATAL FIN-MYPY-001: finance type gate failed.
Why dangerous: Semgrep catches explicit syntax hazards, but mypy catches implicit
float/data-flow pollution that can drift Decimal money calculations.
Agent fix: remove float sources from finance code, type money helpers as Decimal/string
only, and keep boundary serialization as strings.
EOF
  exit 1
fi

echo "[finance-mypy] passed"
