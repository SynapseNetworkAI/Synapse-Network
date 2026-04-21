#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/drills/lib/common.sh"

drill_require_staging_confirmation
drill_require_var SYNAPSE_DRILL_OUT_DIR

CLICKHOUSE_URL="${RESTORE_CLICKHOUSE_URL:-http://127.0.0.1:18123}"
CLICKHOUSE_DB="${RESTORE_CLICKHOUSE_DB:-synapse_analytics_restore}"
THRESHOLD="${SYNAPSE_CLICKHOUSE_FRESHNESS_THRESHOLD_SEC:-300}"

python3 - "$SYNAPSE_DRILL_OUT_DIR" "$CLICKHOUSE_URL" "$CLICKHOUSE_DB" "$THRESHOLD" <<'PY'
import datetime as dt
import json
import pathlib
import sys
import urllib.parse
import urllib.request

out_dir = pathlib.Path(sys.argv[1])
base_url = sys.argv[2].rstrip("/")
database = sys.argv[3]
threshold = int(sys.argv[4])

def query(sql: str) -> str:
    data = sql.encode()
    with urllib.request.urlopen(base_url + "/", data=data, timeout=10) as response:
        return response.read().decode().strip()

schema_count = int(query(f"SELECT count() FROM system.tables WHERE database='{database}'"))
event_count = int(query(f"SELECT count() FROM {database}.events"))
latest_raw = query(f"SELECT max(timestamp) FROM {database}.events")
latest = dt.datetime.fromisoformat(latest_raw.replace("Z", "+00:00")) if latest_raw else dt.datetime.now(dt.UTC)
lag = max(0, int((dt.datetime.now(dt.UTC) - latest).total_seconds()))

path = out_dir / "restore-validation.json"
existing = {}
if path.exists():
    existing = json.loads(path.read_text())
existing["clickhouse"] = {
    "status": "success",
    "database": database,
    "schemaTableCount": schema_count,
    "criticalEventCount": event_count,
    "latestFreshnessLagSeconds": lag,
    "freshnessThresholdSeconds": threshold,
}
path.write_text(json.dumps(existing, indent=2, sort_keys=True) + "\n")
PY
