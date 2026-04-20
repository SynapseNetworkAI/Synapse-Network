#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_REF="${QUALITY_BASE_REF:-origin/main}"

bash "$ROOT_DIR/scripts/ci/ensure_diff_base.sh" "$BASE_REF"

TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

git diff -U0 "$BASE_REF...HEAD" -- > "$TMP_FILE"

is_finance_path() {
  local path="$1"
  [[ "$path" =~ (finance|withdraw|withdrawal|refund|deposit|balance|ledger|reconciliation|settlement|provider_withdraw_review|withdrawal-reviews) ]]
}

failures=0
current_file=""

while IFS= read -r line; do
  if [[ "$line" == "+++ b/"* ]]; then
    current_file="${line#+++ b/}"
    continue
  fi

  [[ "$line" == +* ]] || continue
  [[ "$line" == "+++"* ]] && continue
  added="${line#+}"

  if [[ "$added" =~ (^|[^A-Za-z0-9_])((it|test|describe)\.skip|\.skip\() ]]; then
    cat >&2 <<EOF
FATAL COVERAGE-ESCAPE-003: ${current_file}
Why dangerous: skipped tests let Agent-generated regressions hide behind green CI.
Agent fix: delete the skip, make the test deterministic, or move the scenario to
an explicit E2E runbook with evidence instead of disabling it.
EOF
    failures=$((failures + 1))
  fi

  if [[ "$added" == *"pragma: no cover"* ]]; then
    if [[ ! "$added" =~ pragma:\ no\ cover:\ .+ ]]; then
      cat >&2 <<EOF
FATAL COVERAGE-ESCAPE-001: ${current_file}
Why dangerous: a coverage ignore without a reason can hide untested money or
control-flow behavior.
Agent fix: either add a focused test, or add a precise reason after
'# pragma: no cover:' that names the non-unit-testable condition.
EOF
      failures=$((failures + 1))
    fi
    if is_finance_path "$current_file" && { [[ "$added" != *"human-review-required"* ]] || [[ ! "$added" =~ (evidence|E2E|report|runbook|BUG-|docs/) ]]; }; then
      cat >&2 <<EOF
FATAL COVERAGE-ESCAPE-002: ${current_file}
Why dangerous: finance-sensitive coverage ignores require human review and
external evidence because unit coverage is the first guard against money bugs.
Agent fix: add a real test, or include 'human-review-required' plus an evidence
id/path such as an E2E report, runbook, or BUG record.
EOF
      failures=$((failures + 1))
    fi
  fi

  if [[ "$added" =~ istanbul\ ignore\ (next|file|else) ]]; then
    if [[ ! "$added" =~ istanbul\ ignore\ (next|file|else):\ .+ ]]; then
      cat >&2 <<EOF
FATAL COVERAGE-ESCAPE-004: ${current_file}
Why dangerous: an Istanbul ignore without a reason can hide untested UI
approval or funds-control behavior.
Agent fix: add a focused test, or add a precise reason after the Istanbul
ignore marker explaining why coverage belongs to E2E/manual evidence.
EOF
      failures=$((failures + 1))
    fi
    if is_finance_path "$current_file" && { [[ "$added" != *"human-review-required"* ]] || [[ ! "$added" =~ (evidence|E2E|report|runbook|BUG-|docs/) ]]; }; then
      cat >&2 <<EOF
FATAL COVERAGE-ESCAPE-005: ${current_file}
Why dangerous: finance-sensitive frontend coverage ignores need explicit human
review and external evidence.
Agent fix: add a component/browser test, or include 'human-review-required'
plus an evidence id/path.
EOF
      failures=$((failures + 1))
    fi
  fi
done < "$TMP_FILE"

if [[ "$failures" -gt 0 ]]; then
  exit 1
fi

echo "[coverage-escape] no new unsafe coverage escape hatches"
