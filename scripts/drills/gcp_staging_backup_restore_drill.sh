#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/drills/lib/common.sh"

drill_require_staging_confirmation

PROJECT_ID="${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-${CLOUDSDK_CORE_PROJECT:-}}}"
SOURCE_INSTANCE="${SOURCE_INSTANCE:-synapse-staging-postgres}"
REGION="${REGION:-us-central1}"
DATABASE_NAME="${RESTORE_DATABASE_NAME:-synapse_gateway_staging}"
DB_USER="${RESTORE_POSTGRES_USER:-synapse_gateway_app}"
PASSWORD_SECRET_ID="${RESTORE_POSTGRES_PASSWORD_SECRET_ID:-synapse-staging-postgres-password}"
RUN_ID="${SYNAPSE_DRILL_RUN_ID:-$(drill_timestamp)}"
RUN_ID_SAFE="$(printf '%s' "${RUN_ID}" | tr '[:upper:]_' '[:lower:]-' | tr -cd 'a-z0-9-' | cut -c1-32)"
RESTORE_INSTANCE="${RESTORE_INSTANCE:-${SOURCE_INSTANCE}-restore-${RUN_ID_SAFE}}"
RESTORE_PORT="${SYNAPSE_RESTORE_POSTGRES_PORT:-15432}"
RESTORE_TIER="${RESTORE_TIER:-db-g1-small}"
RESTORE_EDITION="${RESTORE_EDITION:-ENTERPRISE}"
RESTORE_DATABASE_VERSION="${RESTORE_DATABASE_VERSION:-POSTGRES_16}"
RESTORE_STORAGE_SIZE="${RESTORE_STORAGE_SIZE:-20}"
KEEP_RESTORE_INSTANCE="${SYNAPSE_DRILL_KEEP_RESTORE_INSTANCE:-0}"
PROXY_PID=""
RESTORE_CREATED="0"

usage() {
  cat >&2 <<'EOF'
Usage:
  PROJECT_ID=fabled-archive-494108-k5 \
  SYNAPSE_DRILL_ENV=staging \
  SYNAPSE_DRILL_CONFIRM=I_UNDERSTAND_THIS_CHANGES_STAGING \
    bash scripts/drills/gcp_staging_backup_restore_drill.sh

This restores the latest Cloud SQL backup from synapse-staging-postgres into a
temporary isolated Cloud SQL instance, connects through Cloud SQL Auth Proxy,
sets RESTORE_POSTGRES_DSN in memory, runs the Postgres-only restore evidence
gate, then deletes the temporary instance unless SYNAPSE_DRILL_KEEP_RESTORE_INSTANCE=1.
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[gcp-restore-drill] missing required command: $1" >&2
    exit 1
  fi
}

urlencode() {
  python3 - "$1" <<'PY'
import sys
import urllib.parse
print(urllib.parse.quote(sys.argv[1], safe=""))
PY
}

ensure_proxy() {
  if [[ -n "${CLOUD_SQL_PROXY_BIN:-}" && -x "${CLOUD_SQL_PROXY_BIN}" ]]; then
    printf '%s\n' "${CLOUD_SQL_PROXY_BIN}"
    return
  fi
  if command -v cloud-sql-proxy >/dev/null 2>&1; then
    command -v cloud-sql-proxy
    return
  fi
  if [[ -x /tmp/cloud-sql-proxy ]]; then
    printf '%s\n' /tmp/cloud-sql-proxy
    return
  fi

  local os arch url
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "${arch}" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64) arch="amd64" ;;
    *) echo "[gcp-restore-drill] unsupported architecture for auto-download: ${arch}" >&2; exit 1 ;;
  esac
  case "${os}" in
    darwin|linux) ;;
    *) echo "[gcp-restore-drill] unsupported OS for auto-download: ${os}" >&2; exit 1 ;;
  esac
  url="https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.18.3/cloud-sql-proxy.${os}.${arch}"
  echo "[gcp-restore-drill] downloading Cloud SQL Auth Proxy to /tmp/cloud-sql-proxy" >&2
  curl -fsSL -o /tmp/cloud-sql-proxy "${url}"
  chmod +x /tmp/cloud-sql-proxy
  printf '%s\n' /tmp/cloud-sql-proxy
}

cleanup() {
  if [[ -n "${PROXY_PID}" ]]; then
    kill "${PROXY_PID}" >/dev/null 2>&1 || true
    wait "${PROXY_PID}" >/dev/null 2>&1 || true
  fi
  if [[ "${KEEP_RESTORE_INSTANCE}" == "1" ]]; then
    echo "[gcp-restore-drill] keeping restore instance for debugging: ${RESTORE_INSTANCE}" >&2
    return
  fi
  if [[ "${RESTORE_CREATED}" == "1" ]] && [[ -n "${PROJECT_ID}" ]] && gcloud sql instances describe "${RESTORE_INSTANCE}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    echo "[gcp-restore-drill] deleting restore instance: ${RESTORE_INSTANCE}" >&2
    gcloud sql instances delete "${RESTORE_INSTANCE}" --project="${PROJECT_ID}" --quiet >/dev/null || true
  fi
}
trap cleanup EXIT

if [[ -z "${PROJECT_ID}" ]]; then
  usage
  exit 2
fi

require_cmd gcloud
require_cmd python3
require_cmd psql
require_cmd curl

ACTIVE_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
if [[ "${ACTIVE_PROJECT}" != "${PROJECT_ID}" ]]; then
  echo "[gcp-restore-drill] active gcloud project mismatch: active=${ACTIVE_PROJECT:-<unset>} expected=${PROJECT_ID}" >&2
  echo "Agent fix: run gcloud config set project ${PROJECT_ID}, then retry." >&2
  exit 2
fi

if gcloud sql instances describe "${RESTORE_INSTANCE}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "[gcp-restore-drill] restore instance already exists: ${RESTORE_INSTANCE}" >&2
  echo "Agent fix: delete it or set RESTORE_INSTANCE to a unique name." >&2
  exit 2
fi

BACKUP_NAME="${BACKUP_NAME:-$(gcloud sql backups list \
  --project="${PROJECT_ID}" \
  --filter="instance:${SOURCE_INSTANCE} AND state:SUCCESSFUL" \
  --sort-by='~backupInterval.endTime' \
  --limit=1 \
  --format='value(name)' | head -n1)}"

if [[ -z "${BACKUP_NAME}" ]]; then
  echo "[gcp-restore-drill] no Cloud SQL backups found for ${SOURCE_INSTANCE}" >&2
  echo "Agent fix: confirm automated backups are enabled and a backup has completed." >&2
  exit 1
fi

echo "[gcp-restore-drill] project=${PROJECT_ID}"
echo "[gcp-restore-drill] sourceInstance=${SOURCE_INSTANCE}"
echo "[gcp-restore-drill] backupName=${BACKUP_NAME}"
echo "[gcp-restore-drill] restoreInstance=${RESTORE_INSTANCE}"

RESTORE_CREATED="1"
gcloud sql backups restore "${BACKUP_NAME}" \
  --project="${PROJECT_ID}" \
  --restore-instance="${RESTORE_INSTANCE}" \
  --region="${REGION}" \
  --database-version="${RESTORE_DATABASE_VERSION}" \
  --edition="${RESTORE_EDITION}" \
  --tier="${RESTORE_TIER}" \
  --storage-size="${RESTORE_STORAGE_SIZE}" \
  --storage-type=SSD \
  --no-backup \
  --no-deletion-protection \
  --quiet

PROXY_BIN="$(ensure_proxy)"
"${PROXY_BIN}" --address 127.0.0.1 --port "${RESTORE_PORT}" "${PROJECT_ID}:${REGION}:${RESTORE_INSTANCE}" >/tmp/synapse-restore-cloud-sql-proxy.log 2>&1 &
PROXY_PID="$!"

DB_PASSWORD="$(gcloud secrets versions access latest --secret="${PASSWORD_SECRET_ID}" --project="${PROJECT_ID}")"
DB_PASSWORD_ENCODED="$(urlencode "${DB_PASSWORD}")"
export RESTORE_POSTGRES_DSN="postgresql://${DB_USER}:${DB_PASSWORD_ENCODED}@127.0.0.1:${RESTORE_PORT}/${DATABASE_NAME}"
export SYNAPSE_DRILL_RUN_ID="${RUN_ID}"

echo "[gcp-restore-drill] waiting for restored Postgres connection"
for _ in $(seq 1 60); do
  if psql "${RESTORE_POSTGRES_DSN}" -Atqc "SELECT 1" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
psql "${RESTORE_POSTGRES_DSN}" -Atqc "SELECT 1" >/dev/null

npm run drill:backup-restore:staging
npm run ci:backup-restore-evidence
