#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_REF="${QUALITY_BASE_REF:-origin/main}"

bash "$ROOT_DIR/scripts/ci/ensure_diff_base.sh" "$BASE_REF"

TEST_FILES=()
while IFS= read -r file; do
  [[ -n "$file" ]] && TEST_FILES+=("$file")
done < <(
  {
    git diff --name-only --diff-filter=ACMR "$BASE_REF...HEAD" -- '*.py' '*.ts' '*.tsx' '*.js' '*.jsx'
    git ls-files --others --exclude-standard -- '*.py' '*.ts' '*.tsx' '*.js' '*.jsx'
  } | awk '
    /(^|\/)tests\/.*\.py$/ ||
    /(^|\/)test_[^\/]*\.py$/ ||
    /_test\.py$/ ||
    /\.test\.(ts|tsx|js|jsx)$/ ||
    /\.spec\.(ts|tsx|js|jsx)$/ { print }
  ' | sort -u
)

if [[ ${#TEST_FILES[@]} -eq 0 ]]; then
  echo "[test-quality] no changed test files"
  exit 0
fi

echo "[test-quality] checking ${#TEST_FILES[@]} changed test file(s)"
"$ROOT_DIR/scripts/ci/run_guardrail_tool.sh" semgrep semgrep -- \
  --config "$ROOT_DIR/semgrep/test-quality.yml" \
  --error \
  --quiet \
  "${TEST_FILES[@]}"
