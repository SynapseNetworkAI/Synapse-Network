#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VALIDATION="$ROOT_DIR/docs/plans/production-go-live-security-verification/validation.md"
REPORT="$ROOT_DIR/docs/plans/production-go-live-security-verification/staging-verification-report.md"
GATE_DOC="$ROOT_DIR/docs/ops/10_Production_Go_No_Go_Security_Verification.md"
MONITORING_DOC="$ROOT_DIR/docs/ops/13_Production_Monitoring_Alerting_and_Backup_Restore.md"
INTERNAL_AUDIT="$ROOT_DIR/docs/security/SynapseCore_Internal_Production_Security_Audit_Report.md"
CLOSURE_LOG="$ROOT_DIR/docs/security/SynapseCore_Internal_Audit_Closure_Log.md"
RISK_ACCEPTANCE="$ROOT_DIR/docs/security/SynapseCore_Internal_Audit_Risk_Acceptance.md"

echo "[ci:release-go-no-go] validating production launch evidence state"

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "[ci:release-go-no-go] missing required file: $path" >&2
    exit 1
  fi
}

require_grep() {
  local pattern="$1"
  local path="$2"
  local description="$3"
  if ! grep -Eq "$pattern" "$path"; then
    echo "[ci:release-go-no-go] missing $description in $path" >&2
    exit 1
  fi
}

require_file "$VALIDATION"
require_file "$REPORT"
require_file "$GATE_DOC"
require_file "$MONITORING_DOC"
require_file "$INTERNAL_AUDIT"
require_file "$CLOSURE_LOG"
require_file "$RISK_ACCEPTANCE"
require_file "$ROOT_DIR/docs/README.md"
require_file "$ROOT_DIR/docs/ops/README.md"
require_file "$ROOT_DIR/llms.txt"

require_grep "10_Production_Go_No_Go_Security_Verification\\.md" "$ROOT_DIR/docs/README.md" "docs map go/no-go link"
require_grep "13_Production_Monitoring_Alerting_and_Backup_Restore\\.md" "$ROOT_DIR/docs/README.md" "docs map monitoring and restore link"
require_grep "10_Production_Go_No_Go_Security_Verification\\.md" "$ROOT_DIR/docs/ops/README.md" "ops read order go/no-go link"
require_grep "13_Production_Monitoring_Alerting_and_Backup_Restore\\.md" "$ROOT_DIR/docs/ops/README.md" "ops read order monitoring and restore link"
require_grep "production-go-live-security-verification" "$ROOT_DIR/llms.txt" "machine-readable plan entry"

require_grep 'Plan status: `BLOCKED_NO_GO`|Plan status: BLOCKED_NO_GO' "$ROOT_DIR/docs/plans/production-go-live-security-verification/README.md" "plan blocked status"
require_grep 'Production launch decision: `NO-GO for production`' "$VALIDATION" "production no-go decision"
require_grep 'Staging automation result: `PASS`' "$VALIDATION" "staging automation pass status"
require_grep 'Internal audit report: PASS' "$VALIDATION" "internal audit evidence"
require_grep 'Audit finding closure log: PASS' "$VALIDATION" "closure log evidence"
require_grep 'Internal audit risk acceptance: PASS' "$VALIDATION" "risk acceptance evidence"
require_grep 'Independent third-party audit was not performed' "$INTERNAL_AUDIT" "internal audit non-third-party disclaimer"
require_grep 'Independent third-party audit has not been performed' "$RISK_ACCEPTANCE" "risk acceptance non-third-party disclaimer"
require_grep 'SC-AUD-001' "$CLOSURE_LOG" "closure log finding rows"
require_grep "NO-GO blocker" "$VALIDATION" "explicit no-go blockers"
require_grep "ci:backup-restore-evidence" "$VALIDATION" "backup restore evidence gate"
require_grep "METRICS_BEARER_TOKEN" "$MONITORING_DOC" "metrics auth production rule"
require_grep 'Decision: `NO-GO for production`' "$VALIDATION" "final no-go decision"
require_grep "Staging automation passed.*production launch remains \\*\\*NO-GO\\*\\*" "$REPORT" "report final no-go language"

blocker_count="$(grep -c "NO-GO blocker" "$VALIDATION" || true)"
if [[ "$blocker_count" -lt 1 ]]; then
  echo "[ci:release-go-no-go] expected at least one explicit NO-GO blocker while production evidence is incomplete" >&2
  exit 1
fi

if grep -Eq 'Decision: `GO`|Production launch decision: `GO`' "$VALIDATION"; then
  echo "[ci:release-go-no-go] validation cannot claim GO while blockers remain" >&2
  exit 1
fi

echo "[ci:release-go-no-go] staging automation evidence is recorded"
echo "[ci:release-go-no-go] production remains blocked by $blocker_count explicit NO-GO blocker(s)"
