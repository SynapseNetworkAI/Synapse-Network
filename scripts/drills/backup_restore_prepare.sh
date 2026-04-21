#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/drills/lib/common.sh"

drill_require_staging_confirmation

RUN_ID="${SYNAPSE_DRILL_RUN_ID:-$(drill_timestamp)}"
OUT_DIR="${SYNAPSE_DRILL_OUT_DIR:-$ROOT_DIR/docs/evidence/recovery/${RUN_ID}-backup-restore-drill}"
mkdir -p "$OUT_DIR"

cat > "$OUT_DIR/environment-manifest.json" <<EOF
{
  "runId": "$RUN_ID",
  "environment": "${SYNAPSE_DRILL_ENV}",
  "gitCommit": "$(cd "$ROOT_DIR" && git rev-parse --short HEAD)",
  "generatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "restoreCompose": "infra/docker/restore/docker-compose.restore.yml",
  "syntheticDrillTenantId": "drill_synthetic"
}
EOF

cat > "$OUT_DIR/backup-manifest.json" <<EOF
{
  "runId": "$RUN_ID",
  "backupStartedAt": "${SYNAPSE_BACKUP_STARTED_AT:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}",
  "postgresBackupPath": "${SYNAPSE_POSTGRES_BACKUP_PATH:-}",
  "clickhouseBackupPath": "${SYNAPSE_CLICKHOUSE_BACKUP_PATH:-}",
  "notes": "v1 restore drill validates restored DB/schema/counts/freshness; chain replay is intentionally out of scope."
}
EOF

echo "[drill:backup-restore] prepared evidence directory: $OUT_DIR"
