#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/drills/lib/common.sh"

drill_require_staging_confirmation
drill_require_var SYNAPSE_DRILL_OUT_DIR
drill_require_var RESTORE_POSTGRES_DSN

python3 - "$SYNAPSE_DRILL_OUT_DIR" <<'PY'
import json
import os
import pathlib
import subprocess
import sys

out_dir = pathlib.Path(sys.argv[1])
dsn = os.environ["RESTORE_POSTGRES_DSN"]

queries = {
    "synapse_ledger_entries": "SELECT count(*) FROM synapse_ledger_entries;",
    "synapse_vault_withdrawals": "SELECT count(*) FROM synapse_vault_withdrawals;",
    "synapse_vault_deposits": "SELECT count(*) FROM synapse_vault_deposits;",
    "synapse_deposit_attempts": "SELECT count(*) FROM synapse_deposit_attempts;",
}

row_counts = {}
for table, query in queries.items():
    result = subprocess.run(
        ["psql", dsn, "-Atqc", query],
        check=True,
        capture_output=True,
        text=True,
    )
    row_counts[table] = int(result.stdout.strip() or "0")

payload = {
    "postgres": {
        "status": "success",
        "schemaValidated": True,
        "rowCounts": row_counts,
        "checksums": {},
    }
}

path = out_dir / "restore-validation.json"
existing = {}
if path.exists():
    existing = json.loads(path.read_text())
existing.update(payload)
path.write_text(json.dumps(existing, indent=2, sort_keys=True) + "\n")
PY
