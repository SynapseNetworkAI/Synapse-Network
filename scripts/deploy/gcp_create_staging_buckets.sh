#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/deploy/gcp_create_staging_buckets.sh <project-id>

Creates the MVP staging Cloud Storage buckets:
  - synapse-staging-static-assets-<project-id>
  - synapse-staging-backups-<project-id>
  - synapse-staging-evidence-<project-id>
  - synapse-terraform-state-<project-id>

The script is idempotent: existing buckets are left in place and updated with
the expected safety settings. It does not upload website assets and does not
make static assets public; add CDN or public-read intentionally later if
required.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

project_id="${1:-}"
if [[ -z "$project_id" ]]; then
  usage >&2
  exit 2
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud is required. Install Google Cloud SDK or run from Cloud Shell." >&2
  exit 1
fi

active_account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1 || true)"
if [[ -z "$active_account" ]]; then
  echo "No active gcloud account. Run: gcloud auth login" >&2
  exit 1
fi

configured_project="$(gcloud config get-value project 2>/dev/null || true)"
if [[ "$configured_project" != "$project_id" ]]; then
  echo "Active gcloud project is '$configured_project', expected '$project_id'." >&2
  echo "Run: gcloud config set project $project_id" >&2
  exit 1
fi

region="${SYNAPSE_GCS_REGION:-us-central1}"
static_bucket="synapse-staging-static-assets-${project_id}"
backups_bucket="synapse-staging-backups-${project_id}"
evidence_bucket="synapse-staging-evidence-${project_id}"
tfstate_bucket="synapse-terraform-state-${project_id}"

create_bucket_if_missing() {
  local bucket="$1"
  shift
  if gcloud storage buckets describe "gs://${bucket}" --project="$project_id" >/dev/null 2>&1; then
    echo "[bucket] exists: gs://${bucket}"
  else
    echo "[bucket] creating: gs://${bucket}"
    gcloud storage buckets create "gs://${bucket}" \
      --project="$project_id" \
      --location="$region" \
      --uniform-bucket-level-access \
      "$@"
  fi
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cat >"$tmp_dir/static-lifecycle.json" <<'JSON'
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {"age": 90, "isLive": false}
    }
  ]
}
JSON

cat >"$tmp_dir/backups-lifecycle.json" <<'JSON'
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {"age": 30}
    }
  ]
}
JSON

cat >"$tmp_dir/evidence-lifecycle.json" <<'JSON'
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {
        "age": 30,
        "matchesPrefix": [
          "debug/",
          "failed/",
          "tmp/",
          "staging/debug/",
          "staging/failed/",
          "deployments/failed/"
        ]
      }
    },
    {
      "action": {"type": "Delete"},
      "condition": {"age": 365}
    }
  ]
}
JSON

cat >"$tmp_dir/tfstate-lifecycle.json" <<'JSON'
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {"age": 365, "isLive": false}
    }
  ]
}
JSON

create_bucket_if_missing "$static_bucket"
create_bucket_if_missing "$backups_bucket" --public-access-prevention
create_bucket_if_missing "$evidence_bucket" --public-access-prevention
create_bucket_if_missing "$tfstate_bucket" --public-access-prevention

echo "[bucket] applying safety settings"
gcloud storage buckets update "gs://${static_bucket}" \
  --uniform-bucket-level-access \
  --versioning \
  --lifecycle-file="$tmp_dir/static-lifecycle.json" >/dev/null

gcloud storage buckets update "gs://${backups_bucket}" \
  --uniform-bucket-level-access \
  --public-access-prevention \
  --lifecycle-file="$tmp_dir/backups-lifecycle.json" >/dev/null

gcloud storage buckets update "gs://${evidence_bucket}" \
  --uniform-bucket-level-access \
  --public-access-prevention \
  --lifecycle-file="$tmp_dir/evidence-lifecycle.json" >/dev/null

gcloud storage buckets update "gs://${tfstate_bucket}" \
  --uniform-bucket-level-access \
  --public-access-prevention \
  --versioning \
  --lifecycle-file="$tmp_dir/tfstate-lifecycle.json" >/dev/null

cat <<EOF
[bucket] ready
Static assets: gs://${static_bucket}
Backups:       gs://${backups_bucket}
Evidence:      gs://${evidence_bucket}
Terraform:     gs://${tfstate_bucket}
EOF
