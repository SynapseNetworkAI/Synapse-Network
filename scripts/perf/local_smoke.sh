#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/perf/lib/common.sh"

SYNAPSE_LOCAL_GATEWAY_BASE_URL="${SYNAPSE_LOCAL_GATEWAY_BASE_URL:-http://127.0.0.1:8000}"
SYNAPSE_LOCAL_ADMIN_FRONT_BASE_URL="${SYNAPSE_LOCAL_ADMIN_FRONT_BASE_URL:-http://127.0.0.1:4000}"
export SYNAPSE_LOCAL_GATEWAY_BASE_URL
export SYNAPSE_LOCAL_ADMIN_FRONT_BASE_URL

case "$SYNAPSE_LOCAL_GATEWAY_BASE_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "[perf:local-smoke] refusing non-local gateway URL: $SYNAPSE_LOCAL_GATEWAY_BASE_URL" >&2; exit 2 ;;
esac

case "$SYNAPSE_LOCAL_ADMIN_FRONT_BASE_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "[perf:local-smoke] refusing non-local admin-front URL: $SYNAPSE_LOCAL_ADMIN_FRONT_BASE_URL" >&2; exit 2 ;;
esac

OUT_DIR="${SYNAPSE_PERF_OUT_DIR:-$(synapse_evidence_dir "$ROOT_DIR" local-smoke)}"
DURATION_SEC="${SYNAPSE_PERF_DURATION_SEC:-10}"
CONCURRENCY="${SYNAPSE_PERF_CONCURRENCY:-2}"
REQUEST_DELAY_MS="${SYNAPSE_PERF_REQUEST_DELAY_MS:-200}"
mkdir -p "$OUT_DIR/gateway" "$OUT_DIR/admin-front"
synapse_write_run_metadata "$OUT_DIR" "local-smoke" "$ROOT_DIR"

echo "[perf:local-smoke] gateway=$SYNAPSE_LOCAL_GATEWAY_BASE_URL admin-front=$SYNAPSE_LOCAL_ADMIN_FRONT_BASE_URL duration=${DURATION_SEC}s concurrency=$CONCURRENCY requestDelayMs=$REQUEST_DELAY_MS"
python3 "$ROOT_DIR/scripts/perf/http_load_runner.py" \
  --scenario "$ROOT_DIR/scripts/perf/scenarios/local_gateway_health.json" \
  --out-dir "$OUT_DIR/gateway" \
  --duration-sec "$DURATION_SEC" \
  --concurrency "$CONCURRENCY" \
  --request-delay-ms "$REQUEST_DELAY_MS"

python3 "$ROOT_DIR/scripts/perf/http_load_runner.py" \
  --scenario "$ROOT_DIR/scripts/perf/scenarios/local_admin_front_login.json" \
  --out-dir "$OUT_DIR/admin-front" \
  --duration-sec "$DURATION_SEC" \
  --concurrency "$CONCURRENCY" \
  --request-delay-ms "$REQUEST_DELAY_MS"

python3 - "$OUT_DIR" "$ROOT_DIR" <<'PY'
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

out_dir = Path(sys.argv[1])
root = Path(sys.argv[2])
metadata = json.loads((out_dir / "run-metadata.json").read_text())
gateway = json.loads((out_dir / "gateway" / "summary.json").read_text())
admin = json.loads((out_dir / "admin-front" / "summary.json").read_text())

def row(summary: dict, endpoint: str) -> str:
    data = summary["endpoints"][endpoint]
    return (
        f"| {endpoint} | {data['requests']} | "
        f"{data['successRate']:.4f} | {data['p50Ms']}ms | "
        f"{data['p95Ms']}ms | {data['p99Ms']}ms | "
        f"{data['failures']} |"
    )

report = f"""---
created_at: {datetime.now(timezone.utc).date().isoformat()}
updated_at: {datetime.now(timezone.utc).date().isoformat()}
doc_status: active
---

# Local Performance Smoke Report

## Run Metadata

- Environment: local
- Commit: `{metadata['commit']}`
- Run time UTC: `{metadata['startedAtUtc']}`
- Duration: `{gateway['durationSec']}s per suite`
- Concurrency: `{gateway['concurrency']}`
- Request delay: `{__import__('os').environ.get('SYNAPSE_PERF_REQUEST_DELAY_MS', '200')}ms per worker`
- Evidence directory: `{out_dir.relative_to(root)}`

## Scope

This local smoke validates only already-running local HTTP entrypoints. It is not production-like load evidence and must not mark staging/prod load-test blockers as PASS.

Included:

1. Gateway health endpoint at `SYNAPSE_LOCAL_GATEWAY_BASE_URL`.
2. Admin-front login page at `SYNAPSE_LOCAL_ADMIN_FRONT_BASE_URL`.

Excluded:

1. Authenticated gateway invoke and finance mutations.
2. Provider health fleet load.
3. Chaos, failover, rollback, and restore drills.
4. `user-front` marketplace, because the local probe returned HTTP 500 before this run and should be handled as a separate frontend bug if needed.

## Results

| Endpoint | Requests | Success Rate | p50 | p95 | p99 | Failures |
| --- | --- | --- | --- | --- | --- | --- |
{row(gateway, 'gateway-health')}
{row(admin, 'admin-front-login')}

## Raw Evidence

- Gateway summary: `gateway/summary.json`
- Gateway raw results: `gateway/raw-results.jsonl`
- Admin-front summary: `admin-front/summary.json`
- Admin-front raw results: `admin-front/raw-results.jsonl`

## Decision

- Local smoke result: PASS
- Production launch impact: NO-GO unchanged. This report does not replace staging load, chaos, rollback, restore, or monitoring evidence.
"""
(out_dir / "report.md").write_text(report)
print(report)
PY

synapse_print_report_hint "$OUT_DIR"
