#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_REF="${QUALITY_BASE_REF:-origin/main}"

bash "$ROOT_DIR/scripts/ci/ensure_diff_base.sh" "$BASE_REF"
bash "$ROOT_DIR/scripts/ci/coverage_escape_hatch_scan.sh"
bash "$ROOT_DIR/scripts/ci/test_quality_scan.sh"

CHANGED_FILES=()
while IFS= read -r file; do
  [[ -n "$file" ]] && CHANGED_FILES+=("$file")
done < <(
  {
    git diff --name-only "$BASE_REF...HEAD"
    git ls-files --others --exclude-standard
  } | sort -u
)

matches_regex() {
  local file="$1"
  local regex="$2"
  [[ "$file" =~ $regex ]]
}

has_match() {
  local regex="$1"
  local file
  if [[ ${#CHANGED_FILES[@]} -eq 0 ]]; then
    return 1
  fi
  for file in "${CHANGED_FILES[@]}"; do
    if matches_regex "$file" "$regex"; then
      return 0
    fi
  done
  return 1
}

run_python_coverage() {
  local label="$1"
  local project_dir="$2"
  local src_pkg="$3"
  local coverage_file="$4"

  bash "$ROOT_DIR/scripts/ci/ensure_python_env.sh" "$label" "$project_dir" requirements pytest pytest-cov
  (
    cd "$project_dir"
    "$project_dir/.venv/bin/python" -m pytest -q tests \
      --cov="$src_pkg" \
      --cov-report=xml:"$coverage_file" \
      --cov-report=term
  )
}

run_frontend_coverage() {
  local project_dir="$1"
  (
    cd "$project_dir"
    yarn test --coverage
  )
}

run_diff_cover() {
  local label="$1"
  local coverage_file="$2"
  local fail_under="$3"
  shift 3
  local args=("$@")

  if [[ ! -f "$coverage_file" ]]; then
    cat >&2 <<EOF
FATAL DIFF-COVERAGE-001: missing coverage file ${coverage_file}
Why dangerous: changed code cannot be coverage-gated without a Cobertura XML
report.
Agent fix: run the matching test command with coverage enabled. Python should
produce coverage.xml via pytest-cov; Vitest should produce
coverage/cobertura-coverage.xml with coverage-v8.
EOF
    exit 1
  fi

  echo "[diff-coverage] ${label}: threshold ${fail_under}%"
  "$ROOT_DIR/scripts/ci/run_guardrail_tool.sh" diff-cover diff-cover -- \
    "$coverage_file" \
    --compare-branch "$BASE_REF" \
    --fail-under "$fail_under" \
    --include-untracked \
    --src-roots "$ROOT_DIR" \
    "${args[@]}"
}

PY_FINANCE_REGEX='^services/(gateway|gateway-admin)/src/.*(finance|withdraw|withdrawal|refund|deposit|balance|ledger|reconciliation|settlement|provider_withdraw_review|approval|review|complete).*\.py$'
PY_BACKEND_REGEX='^services/(gateway|gateway-admin)/src/.*\.py$'
ADMIN_FRONT_REGEX='^services/admin-front/src/.*\.(ts|tsx)$'
USER_FRONT_REGEX='^services/user-front/src/.*\.(ts|tsx)$'
FRONT_HIGH_RISK_REGEX='^services/(admin-front|user-front)/src/.*(withdrawal-reviews|withdraw|finance|reconciliation|billing|credits|payments|analytics|forum-support|approval|risk|audit).*\.(ts|tsx)$'
FRONT_ANY_REGEX='^services/(admin-front|user-front)/src/.*\.(ts|tsx)$'

NEED_GATEWAY=0
NEED_GATEWAY_ADMIN=0
NEED_ADMIN_FRONT=0
NEED_USER_FRONT=0

has_match '^services/gateway/src/.*\.py$' && NEED_GATEWAY=1
has_match '^services/gateway-admin/src/.*\.py$' && NEED_GATEWAY_ADMIN=1
has_match "$ADMIN_FRONT_REGEX" && NEED_ADMIN_FRONT=1
has_match "$USER_FRONT_REGEX" && NEED_USER_FRONT=1

if [[ "$NEED_GATEWAY" -eq 1 ]]; then
  run_python_coverage "diff-coverage:gateway" "$ROOT_DIR/services/gateway" src "$ROOT_DIR/services/gateway/coverage.xml"
fi

if [[ "$NEED_GATEWAY_ADMIN" -eq 1 ]]; then
  run_python_coverage "diff-coverage:gateway-admin" "$ROOT_DIR/services/gateway-admin" src "$ROOT_DIR/services/gateway-admin/coverage.xml"
fi

if [[ "$NEED_ADMIN_FRONT" -eq 1 ]]; then
  run_frontend_coverage "$ROOT_DIR/services/admin-front"
fi

if [[ "$NEED_USER_FRONT" -eq 1 ]]; then
  run_frontend_coverage "$ROOT_DIR/services/user-front"
fi

if has_match "$PY_FINANCE_REGEX"; then
  [[ "$NEED_GATEWAY" -eq 1 ]] && run_diff_cover "python finance-sensitive gateway" "$ROOT_DIR/services/gateway/coverage.xml" 90 --include "services/gateway/src/**/*finance*.py" "services/gateway/src/**/*withdraw*.py" "services/gateway/src/**/*refund*.py" "services/gateway/src/**/*deposit*.py" "services/gateway/src/**/*balance*.py" "services/gateway/src/**/*ledger*.py" "services/gateway/src/**/*reconciliation*.py" "services/gateway/src/**/*settlement*.py" "services/gateway/src/**/*complete*.py"
  [[ "$NEED_GATEWAY_ADMIN" -eq 1 ]] && run_diff_cover "python finance-sensitive gateway-admin" "$ROOT_DIR/services/gateway-admin/coverage.xml" 90 --include "services/gateway-admin/src/**/*finance*.py" "services/gateway-admin/src/**/*withdraw*.py" "services/gateway-admin/src/**/*approval*.py" "services/gateway-admin/src/**/*review*.py" "services/gateway-admin/src/**/*reconciliation*.py"
else
  echo "[diff-coverage] no finance-sensitive Python changed files; skipping 90% segment"
fi

if has_match "$PY_BACKEND_REGEX"; then
  [[ "$NEED_GATEWAY" -eq 1 ]] && run_diff_cover "python ordinary backend gateway" "$ROOT_DIR/services/gateway/coverage.xml" 80 --include "services/gateway/src/**/*.py" --exclude "services/gateway/src/**/*finance*.py" "services/gateway/src/**/*withdraw*.py" "services/gateway/src/**/*refund*.py" "services/gateway/src/**/*deposit*.py" "services/gateway/src/**/*balance*.py" "services/gateway/src/**/*ledger*.py" "services/gateway/src/**/*reconciliation*.py" "services/gateway/src/**/*settlement*.py" "services/gateway/src/**/*complete*.py"
  [[ "$NEED_GATEWAY_ADMIN" -eq 1 ]] && run_diff_cover "python ordinary backend gateway-admin" "$ROOT_DIR/services/gateway-admin/coverage.xml" 80 --include "services/gateway-admin/src/**/*.py" --exclude "services/gateway-admin/src/**/*finance*.py" "services/gateway-admin/src/**/*withdraw*.py" "services/gateway-admin/src/**/*approval*.py" "services/gateway-admin/src/**/*review*.py" "services/gateway-admin/src/**/*reconciliation*.py"
else
  echo "[diff-coverage] no Python backend changed files; skipping 80% segment"
fi

if has_match "$FRONT_HIGH_RISK_REGEX"; then
  [[ "$NEED_ADMIN_FRONT" -eq 1 ]] && run_diff_cover "frontend high-risk admin-front" "$ROOT_DIR/services/admin-front/coverage/cobertura-coverage.xml" 80 --include "services/admin-front/src/**/*withdrawal-reviews*.ts" "services/admin-front/src/**/*withdrawal-reviews*.tsx" "services/admin-front/src/**/*finance*.ts" "services/admin-front/src/**/*finance*.tsx" "services/admin-front/src/**/*analytics*.ts" "services/admin-front/src/**/*analytics*.tsx" "services/admin-front/src/**/*forum-support*.ts" "services/admin-front/src/**/*forum-support*.tsx" "services/admin-front/src/**/*approval*.ts" "services/admin-front/src/**/*approval*.tsx" "services/admin-front/src/**/*risk*.ts" "services/admin-front/src/**/*risk*.tsx" "services/admin-front/src/**/*audit*.ts" "services/admin-front/src/**/*audit*.tsx"
  [[ "$NEED_USER_FRONT" -eq 1 ]] && run_diff_cover "frontend high-risk user-front" "$ROOT_DIR/services/user-front/coverage/cobertura-coverage.xml" 80 --include "services/user-front/src/**/*withdraw*.ts" "services/user-front/src/**/*withdraw*.tsx" "services/user-front/src/**/*billing*.ts" "services/user-front/src/**/*billing*.tsx" "services/user-front/src/**/*credits*.ts" "services/user-front/src/**/*credits*.tsx" "services/user-front/src/**/*payments*.ts" "services/user-front/src/**/*payments*.tsx" "services/user-front/src/**/*audit*.ts" "services/user-front/src/**/*audit*.tsx"
else
  echo "[diff-coverage] no high-risk frontend changed files; skipping 80% frontend segment"
fi

if has_match "$FRONT_ANY_REGEX"; then
  [[ "$NEED_ADMIN_FRONT" -eq 1 ]] && run_diff_cover "frontend ordinary admin-front" "$ROOT_DIR/services/admin-front/coverage/cobertura-coverage.xml" 70 --include "services/admin-front/src/**/*.ts" "services/admin-front/src/**/*.tsx" --exclude "services/admin-front/src/**/*withdrawal-reviews*.ts" "services/admin-front/src/**/*withdrawal-reviews*.tsx" "services/admin-front/src/**/*finance*.ts" "services/admin-front/src/**/*finance*.tsx" "services/admin-front/src/**/*analytics*.ts" "services/admin-front/src/**/*analytics*.tsx" "services/admin-front/src/**/*forum-support*.ts" "services/admin-front/src/**/*forum-support*.tsx" "services/admin-front/src/**/*approval*.ts" "services/admin-front/src/**/*approval*.tsx" "services/admin-front/src/**/*risk*.ts" "services/admin-front/src/**/*risk*.tsx" "services/admin-front/src/**/*audit*.ts" "services/admin-front/src/**/*audit*.tsx"
  [[ "$NEED_USER_FRONT" -eq 1 ]] && run_diff_cover "frontend ordinary user-front" "$ROOT_DIR/services/user-front/coverage/cobertura-coverage.xml" 70 --include "services/user-front/src/**/*.ts" "services/user-front/src/**/*.tsx" --exclude "services/user-front/src/**/*withdraw*.ts" "services/user-front/src/**/*withdraw*.tsx" "services/user-front/src/**/*billing*.ts" "services/user-front/src/**/*billing*.tsx" "services/user-front/src/**/*credits*.ts" "services/user-front/src/**/*credits*.tsx" "services/user-front/src/**/*payments*.ts" "services/user-front/src/**/*payments*.tsx" "services/user-front/src/**/*audit*.ts" "services/user-front/src/**/*audit*.tsx"
else
  echo "[diff-coverage] no frontend source changed files; skipping 70% frontend segment"
fi

echo "[diff-coverage] completed"
