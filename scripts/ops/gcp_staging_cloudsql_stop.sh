#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-fabled-archive-494108-k5}"
INSTANCE="${INSTANCE:-synapse-staging-postgres}"
DRY_RUN=false

usage() {
  cat >&2 <<'USAGE'
Usage:
  bash scripts/ops/gcp_staging_cloudsql_stop.sh [--dry-run]

Stops the staging Cloud SQL instance by setting activationPolicy=NEVER.
Manual start:
  gcloud sql instances patch synapse-staging-postgres --project=fabled-archive-494108-k5 --activation-policy=ALWAYS --quiet
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

current_policy="$(gcloud sql instances describe "${INSTANCE}" \
  --project="${PROJECT_ID}" \
  --format='value(settings.activationPolicy)')"
state="$(gcloud sql instances describe "${INSTANCE}" \
  --project="${PROJECT_ID}" \
  --format='value(state)')"

echo "[cloudsql-stop] project=${PROJECT_ID} instance=${INSTANCE} state=${state} activationPolicy=${current_policy}"

if [[ "${current_policy}" == "NEVER" ]]; then
  echo "[cloudsql-stop] already stopped by activation policy"
  exit 0
fi

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "[dry-run] gcloud sql instances patch ${INSTANCE} --project=${PROJECT_ID} --activation-policy=NEVER --quiet"
  exit 0
fi

gcloud sql instances patch "${INSTANCE}" \
  --project="${PROJECT_ID}" \
  --activation-policy=NEVER \
  --quiet

gcloud sql instances describe "${INSTANCE}" \
  --project="${PROJECT_ID}" \
  --format='json(name,state,settings.activationPolicy)'
