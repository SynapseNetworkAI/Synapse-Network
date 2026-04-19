#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/perf/lib/common.sh"

OUT_DIR="${SYNAPSE_PERF_OUT_DIR:-$(synapse_evidence_dir "$ROOT_DIR" local-reliability-suite)}"
LOG_DIR="$OUT_DIR/logs"
REPORT="$OUT_DIR/report.md"
mkdir -p "$LOG_DIR"
synapse_write_run_metadata "$OUT_DIR" "local-reliability-suite" "$ROOT_DIR"

PASS_COUNT=0
SKIP_COUNT=0
FAIL_COUNT=0
ROWS=()

record_row() {
  local status="$1"
  local name="$2"
  local evidence="$3"
  local note="$4"
  ROWS+=("| $status | $name | $evidence | $note |")
  case "$status" in
    PASS) PASS_COUNT=$((PASS_COUNT + 1)) ;;
    SKIP) SKIP_COUNT=$((SKIP_COUNT + 1)) ;;
    FAIL) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
  esac
}

run_step() {
  local name="$1"
  local log_name="$2"
  shift 2
  local log_file="$LOG_DIR/$log_name.log"
  echo "[local-reliability] $name"
  if "$@" >"$log_file" 2>&1; then
    record_row "PASS" "$name" "logs/$log_name.log" "completed"
  else
    record_row "FAIL" "$name" "logs/$log_name.log" "command failed"
    return 1
  fi
}

expect_exit_2() {
  local name="$1"
  local log_name="$2"
  shift 2
  local log_file="$LOG_DIR/$log_name.log"
  echo "[local-reliability] $name"
  set +e
  "$@" >"$log_file" 2>&1
  local code=$?
  set -e
  if [[ "$code" -eq 2 ]]; then
    record_row "PASS" "$name" "logs/$log_name.log" "refused unsafe run as expected"
  else
    record_row "FAIL" "$name" "logs/$log_name.log" "expected exit 2, got $code"
    return 1
  fi
}

write_report() {
  local decision="PASS"
  if [[ "$FAIL_COUNT" -gt 0 ]]; then
    decision="FAIL"
  fi

  {
    cat <<EOF
---
created_at: $(date -u +"%Y-%m-%d")
updated_at: $(date -u +"%Y-%m-%d")
doc_status: active
---

# Local Reliability Suite Report

## Run Metadata

- Environment: local
- Commit: \`$(cd "$ROOT_DIR" && git rev-parse --short HEAD)\`
- Run time UTC: \`$(date -u +"%Y-%m-%dT%H:%M:%SZ")\`
- Evidence directory: \`$(python3 - "$ROOT_DIR" "$OUT_DIR" <<'PY'
from pathlib import Path
import sys
root = Path(sys.argv[1]).resolve()
out_dir = Path(sys.argv[2]).resolve()
try:
    print(out_dir.relative_to(root))
except ValueError:
    print(out_dir)
PY
)\`

## Scope

This suite validates safe local automation for performance and reliability evidence. It does not execute staging load, chaos, failover, rollback, restore, or signer procedures.

Local PASS means the harness, scheduler regression checks, scenario files, and destructive-operation guards are working. Production launch remains NO-GO until staging/prod-like reports are attached.

## Results

| Status | Check | Evidence | Note |
| --- | --- | --- | --- |
EOF
    printf '%s\n' "${ROWS[@]}"
    cat <<EOF

## Summary

- Passed: $PASS_COUNT
- Skipped: $SKIP_COUNT
- Failed: $FAIL_COUNT
- Decision: $decision

## Launch Impact

- Local reliability automation: $decision
- Production load/chaos/rollback evidence: unchanged; still requires staging reports and operator sign-off.
EOF
  } > "$REPORT"
}

main() {
  trap write_report EXIT

  run_step "Provider probe concurrency and slow-lane regression smoke" "ci-performance-reliability" \
    npm run ci:performance-reliability

  run_step "Gateway pre-launch stress static review" "ci-gateway-stress-review" \
    npm run ci:gateway-stress-review

  run_step "Release Go/No-Go document gate" "ci-release-go-no-go" \
    npm run ci:release-go-no-go

  run_step "Docs governance gate" "ci-docs" \
    npm run ci:docs

  run_step "Performance, chaos, and drill shell syntax" "shell-syntax" \
    bash -lc "bash -n scripts/perf/*.sh scripts/perf/lib/*.sh scripts/chaos/*.sh scripts/chaos/lib/*.sh scripts/drills/*.sh scripts/drills/lib/*.sh"

  run_step "Performance scenario JSON parse" "scenario-json-parse" \
    python3 - <<'PY'
import json
from pathlib import Path

root = Path("scripts/perf/scenarios")
for path in sorted(root.glob("*.json")):
    json.loads(path.read_text())
    print(f"ok {path}")
PY

  run_step "HTTP load runner help" "http-load-runner-help" \
    python3 "$ROOT_DIR/scripts/perf/http_load_runner.py" --help

  expect_exit_2 "Gateway load script refuses missing staging confirmation" "guard-gateway-load" \
    bash "$ROOT_DIR/scripts/perf/gateway_load.sh"

  expect_exit_2 "Finance load script refuses missing staging confirmation" "guard-finance-load" \
    bash "$ROOT_DIR/scripts/perf/finance_load.sh"

  expect_exit_2 "Provider health load script refuses missing staging confirmation" "guard-provider-health-load" \
    bash "$ROOT_DIR/scripts/perf/provider_health_load.sh"

  expect_exit_2 "Admin load script refuses missing staging confirmation" "guard-admin-load" \
    bash "$ROOT_DIR/scripts/perf/admin_load.sh"

  expect_exit_2 "Money concurrency script refuses missing staging confirmation" "guard-money-concurrency" \
    bash "$ROOT_DIR/scripts/perf/money_concurrency.sh"

  expect_exit_2 "Provider outage chaos refuses missing staging confirmation" "guard-provider-outage" \
    bash "$ROOT_DIR/scripts/chaos/provider_outage.sh"

  expect_exit_2 "Gateway restart chaos refuses missing staging confirmation" "guard-gateway-restart" \
    bash "$ROOT_DIR/scripts/chaos/gateway_restart.sh"

  expect_exit_2 "Gateway-admin restart chaos refuses missing staging confirmation" "guard-gateway-admin-restart" \
    bash "$ROOT_DIR/scripts/chaos/gateway_admin_restart.sh"

  expect_exit_2 "Analytics outage chaos refuses missing staging confirmation" "guard-analytics-outage" \
    bash "$ROOT_DIR/scripts/chaos/analytics_outage.sh"

  expect_exit_2 "RPC outage chaos refuses missing staging confirmation" "guard-rpc-outage" \
    bash "$ROOT_DIR/scripts/chaos/rpc_outage.sh"

  expect_exit_2 "Postgres failover chaos refuses missing staging confirmation" "guard-postgres-failover" \
    bash "$ROOT_DIR/scripts/chaos/postgres_failover.sh"

  expect_exit_2 "Redis unavailable chaos refuses missing staging confirmation" "guard-redis-unavailable" \
    bash "$ROOT_DIR/scripts/chaos/redis_unavailable.sh"

  expect_exit_2 "Application rollback drill refuses missing staging confirmation" "guard-application-rollback" \
    bash "$ROOT_DIR/scripts/drills/application_rollback.sh"

  expect_exit_2 "Config rollback drill refuses missing staging confirmation" "guard-config-rollback" \
    bash "$ROOT_DIR/scripts/drills/config_rollback.sh"

  expect_exit_2 "Signer rollback drill refuses missing staging confirmation" "guard-signer-rollback" \
    bash "$ROOT_DIR/scripts/drills/signer_rollback.sh"

  if [[ "${SYNAPSE_LOCAL_SUITE_SKIP_HTTP_SMOKE:-0}" == "1" ]]; then
    record_row "SKIP" "Local HTTP smoke" "-" "SYNAPSE_LOCAL_SUITE_SKIP_HTTP_SMOKE=1"
  else
    local smoke_out="$OUT_DIR/local-smoke"
    echo "[local-reliability] Local HTTP smoke"
    if SYNAPSE_PERF_OUT_DIR="$smoke_out" npm run perf:local-smoke >"$LOG_DIR/local-http-smoke.log" 2>&1; then
      record_row "PASS" "Local HTTP smoke" "local-smoke/report.md" "gateway and admin-front local endpoints responded"
    elif [[ "${SYNAPSE_LOCAL_SUITE_REQUIRE_HTTP:-0}" == "1" ]]; then
      record_row "FAIL" "Local HTTP smoke" "logs/local-http-smoke.log" "required local HTTP smoke failed"
      return 1
    else
      record_row "SKIP" "Local HTTP smoke" "logs/local-http-smoke.log" "local services unavailable; set SYNAPSE_LOCAL_SUITE_REQUIRE_HTTP=1 to make this hard-fail"
    fi
  fi

  echo "[local-reliability] evidence directory: $OUT_DIR"
  echo "[local-reliability] report: $REPORT"
}

main "$@"
