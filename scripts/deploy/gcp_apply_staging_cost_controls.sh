#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/deploy/gcp_apply_staging_cost_controls.sh <project-id>

Applies staging storage cost controls:
  - Artifact Registry cleanup policies for synapse-staging.
  - GCS lifecycle policies for static assets, backups, evidence, and Terraform state buckets.

Environment:
  SYNAPSE_GCP_REGION=us-central1
  SYNAPSE_ARTIFACT_REGISTRY_REPOSITORY=synapse-staging
  SYNAPSE_ARTIFACT_CLEANUP_DRY_RUN=1   Keep cleanup policy in dry-run mode.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

project_id="${1:-}"
if [[ -z "${project_id}" ]]; then
  usage >&2
  exit 2
fi

for cmd in gcloud gsutil; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "${cmd} is required. Install Google Cloud SDK or run from Cloud Shell." >&2
    exit 1
  fi
done

active_account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1 || true)"
if [[ -z "${active_account}" ]]; then
  echo "No active gcloud account. Run: gcloud auth login" >&2
  exit 1
fi

configured_project="$(gcloud config get-value project 2>/dev/null || true)"
if [[ "${configured_project}" != "${project_id}" ]]; then
  echo "Active gcloud project is '${configured_project}', expected '${project_id}'." >&2
  echo "Run: gcloud config set project ${project_id}" >&2
  exit 1
fi

region="${SYNAPSE_GCP_REGION:-us-central1}"
repository="${SYNAPSE_ARTIFACT_REGISTRY_REPOSITORY:-synapse-staging}"
static_bucket="synapse-staging-static-assets-${project_id}"
backups_bucket="synapse-staging-backups-${project_id}"
evidence_bucket="synapse-staging-evidence-${project_id}"
tfstate_bucket="synapse-terraform-state-${project_id}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cat >"${tmp_dir}/artifact-cleanup.json" <<'JSON'
[
  {
    "name": "delete-untagged-older-than-7d",
    "action": {"type": "Delete"},
    "condition": {
      "tagState": "untagged",
      "olderThan": "7d"
    }
  },
  {
    "name": "delete-staging-tagged-older-than-45d",
    "action": {"type": "Delete"},
    "condition": {
      "tagState": "tagged",
      "tagPrefixes": ["staging-"],
      "olderThan": "45d"
    }
  },
  {
    "name": "keep-promoted-release-tags",
    "action": {"type": "Keep"},
    "condition": {
      "tagState": "tagged",
      "tagPrefixes": ["prod-", "production-", "promoted-", "release-"]
    }
  },
  {
    "name": "keep-recent-3-per-package",
    "action": {"type": "Keep"},
    "mostRecentVersions": {
      "keepCount": 3
    }
  }
]
JSON

cat >"${tmp_dir}/static-lifecycle.json" <<'JSON'
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {"age": 90, "isLive": false}
    }
  ]
}
JSON

cat >"${tmp_dir}/backups-lifecycle.json" <<'JSON'
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {"age": 30}
    }
  ]
}
JSON

cat >"${tmp_dir}/evidence-lifecycle.json" <<'JSON'
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

cat >"${tmp_dir}/tfstate-lifecycle.json" <<'JSON'
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {"age": 365, "isLive": false}
    }
  ]
}
JSON

echo "[cost-controls] applying Artifact Registry cleanup policies: ${repository}"
artifact_args=(
  artifacts repositories set-cleanup-policies "${repository}"
  --project="${project_id}"
  --location="${region}"
  --policy="${tmp_dir}/artifact-cleanup.json"
  --quiet
)
if [[ "${SYNAPSE_ARTIFACT_CLEANUP_DRY_RUN:-}" == "1" ]]; then
  artifact_args+=(--dry-run)
fi
gcloud "${artifact_args[@]}"

echo "[cost-controls] applying GCS lifecycle policies"
gcloud storage buckets update "gs://${static_bucket}" \
  --project="${project_id}" \
  --uniform-bucket-level-access \
  --versioning \
  --lifecycle-file="${tmp_dir}/static-lifecycle.json" >/dev/null

gcloud storage buckets update "gs://${backups_bucket}" \
  --project="${project_id}" \
  --uniform-bucket-level-access \
  --public-access-prevention \
  --lifecycle-file="${tmp_dir}/backups-lifecycle.json" >/dev/null

gcloud storage buckets update "gs://${evidence_bucket}" \
  --project="${project_id}" \
  --uniform-bucket-level-access \
  --public-access-prevention \
  --lifecycle-file="${tmp_dir}/evidence-lifecycle.json" >/dev/null

gcloud storage buckets update "gs://${tfstate_bucket}" \
  --project="${project_id}" \
  --uniform-bucket-level-access \
  --public-access-prevention \
  --versioning \
  --lifecycle-file="${tmp_dir}/tfstate-lifecycle.json" >/dev/null

cat <<EOF
[cost-controls] ready
Artifact Registry: ${region}/${repository}
Static assets:     gs://${static_bucket}
Backups:           gs://${backups_bucket}
Evidence:          gs://${evidence_bucket}
Terraform state:   gs://${tfstate_bucket}

Verify:
  gcloud artifacts repositories describe ${repository} --project=${project_id} --location=${region} --format=json
  gsutil lifecycle get gs://${evidence_bucket}
  gsutil lifecycle get gs://${tfstate_bucket}
EOF
