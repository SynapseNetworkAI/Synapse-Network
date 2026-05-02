#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_REF="${QUALITY_BASE_REF:-origin/main}"

bash "$ROOT_DIR/scripts/ci/ensure_diff_base.sh" "$BASE_REF"

if command -v prettier >/dev/null 2>&1; then
  PRETTIER_CMD=(prettier)
elif npx --no-install prettier --version >/dev/null 2>&1; then
  PRETTIER_CMD=(npx --no-install prettier)
else
  cat >&2 <<'EOF'
FATAL FORMAT-TOOL-000: Prettier is required for format checks.
Why dangerous: formatting drift creates noisy reviews and hides real logic changes.
Agent fix: install Prettier locally or globally, then rerun npm run ci:format-check.
EOF
  exit 1
fi

FILES=()
while IFS= read -r file; do
  [[ -n "$file" ]] && FILES+=("$file")
done < <(
  {
    git -C "$ROOT_DIR" diff --name-only --diff-filter=ACMR "$BASE_REF...HEAD" -- \
      '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' '*.json' '*.yml' '*.yaml' '*.md'
    git -C "$ROOT_DIR" diff --cached --name-only --diff-filter=ACMR -- \
      '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' '*.json' '*.yml' '*.yaml' '*.md'
    git -C "$ROOT_DIR" diff --name-only --diff-filter=ACMR -- \
      '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' '*.json' '*.yml' '*.yaml' '*.md'
  } | sort -u | grep -Ev '(^docs/evidence/|^node_modules/|/node_modules/|^services/.*/\.next/|^output/|^tmp/)'
)

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "[format-check] no changed Prettier-scoped files"
  exit 0
fi

echo "[format-check] checking ${#FILES[@]} file(s)"
(
  cd "$ROOT_DIR"
  "${PRETTIER_CMD[@]}" --check "${FILES[@]}"
)
