#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-${CLOUDSDK_CORE_PROJECT:-}}}}"
REGION="${REGION:-us-central1}"
ENVIRONMENT="${ENVIRONMENT:-staging}"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${OUT_DIR:-output/security/staging-config-audit/${RUN_ID}}"

usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/deploy/gcp_audit_staging_security_config.sh <gcp-project-id>

Purpose:
  Read-only staging security config audit. It lists Cloud Run env/secret refs,
  Secret Manager placeholders/versions, KMS key rings/keys/versions/IAM, and
  highlights legacy withdrawal signer references. It never reads secret values.
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

write_json_or_empty() {
  local target="$1"
  shift
  if "$@" >"${target}" 2>"${target}.stderr"; then
    return 0
  fi
  printf '[]\n' >"${target}"
  return 0
}

write_run_describes() {
  local target="$1"
  local kind="$2"
  local names
  case "${kind}" in
    services)
      names="$(gcloud run services list --project="${PROJECT_ID}" --region="${REGION}" --format='value(metadata.name)' 2>"${target}.list.stderr" || true)"
      ;;
    jobs)
      names="$(gcloud run jobs list --project="${PROJECT_ID}" --region="${REGION}" --format='value(metadata.name)' 2>"${target}.list.stderr" || true)"
      ;;
    *)
      echo "unsupported Cloud Run kind: ${kind}" >&2
      exit 2
      ;;
  esac

  printf '[\n' >"${target}"
  local first=1
  while IFS= read -r name; do
    [[ -z "${name}" ]] && continue
    if [[ "${first}" -eq 0 ]]; then
      printf ',\n' >>"${target}"
    fi
    first=0
    if [[ "${kind}" == "services" ]]; then
      gcloud run services describe "${name}" --project="${PROJECT_ID}" --region="${REGION}" --format=json >>"${target}"
    else
      gcloud run jobs describe "${name}" --project="${PROJECT_ID}" --region="${REGION}" --format=json >>"${target}"
    fi
  done <<<"${names}"
  printf '\n]\n' >>"${target}"
}

if [[ -z "${PROJECT_ID}" ]]; then
  usage
  exit 2
fi

if [[ "${ENVIRONMENT}" != "staging" ]]; then
  echo "refusing non-staging environment: ${ENVIRONMENT}" >&2
  exit 2
fi

require_cmd gcloud
require_cmd python3

ACTIVE_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
if [[ "${ACTIVE_PROJECT}" != "${PROJECT_ID}" ]]; then
  echo "active gcloud project mismatch: active=${ACTIVE_PROJECT:-<unset>} expected=${PROJECT_ID}" >&2
  echo "Agent fix: run gcloud config set project ${PROJECT_ID}, then retry." >&2
  exit 2
fi

if ! gcloud services list --enabled --project="${PROJECT_ID}" --limit=1 >/dev/null 2>&1; then
  cat >&2 <<'EOF'
FATAL GCP-AUDIT-001: unable to query GCP. Run `gcloud auth login` and ensure
your active account can read Cloud Run, Secret Manager, and Cloud KMS metadata.
EOF
  exit 1
fi

mkdir -p "${OUT_DIR}/raw"

echo "[staging-security-audit] project=${PROJECT_ID} region=${REGION} out=${OUT_DIR}"

write_run_describes "${OUT_DIR}/raw/services.json" services
write_run_describes "${OUT_DIR}/raw/jobs.json" jobs

write_json_or_empty "${OUT_DIR}/raw/secrets.json" \
  gcloud secrets list --project="${PROJECT_ID}" --filter='name~synapse-staging' --format=json

write_json_or_empty "${OUT_DIR}/raw/kms_keyrings.json" \
  gcloud kms keyrings list --project="${PROJECT_ID}" --location="${REGION}" --format=json

write_json_or_empty "${OUT_DIR}/raw/kms_keys.json" \
  gcloud kms keys list --project="${PROJECT_ID}" --location="${REGION}" --keyring="synapse-staging" --format=json

write_json_or_empty "${OUT_DIR}/raw/kms_versions.json" \
  gcloud kms keys versions list --project="${PROJECT_ID}" --location="${REGION}" --keyring="synapse-staging" --key="synapse-staging-withdraw-signer" --format=json

write_json_or_empty "${OUT_DIR}/raw/kms_iam.json" \
  gcloud kms keys get-iam-policy "synapse-staging-withdraw-signer" --project="${PROJECT_ID}" --location="${REGION}" --keyring="synapse-staging" --format=json

python3 - "${PROJECT_ID}" "${REGION}" "${OUT_DIR}" <<'PY'
import json
import sys
from pathlib import Path

project_id, region, out_dir = sys.argv[1:4]
root = Path(out_dir)


def load(name):
    path = root / "raw" / name
    try:
        return json.loads(path.read_text())
    except Exception:
        return []


def env_refs(resource):
    refs = []
    template = resource.get("template") or {}
    containers = template.get("containers") or []
    if "template" in template:
        containers = template.get("template", {}).get("containers") or containers
    for container in containers:
        for env in container.get("env") or []:
            name = env.get("name")
            value = env.get("value")
            secret = (
                env.get("valueSource", {})
                .get("secretKeyRef", {})
                .get("secret")
            )
            refs.append({"name": name, "value": value, "secret": secret})
    return refs


services = load("services.json")
jobs = load("jobs.json")
secrets = load("secrets.json")
kms_keyrings = load("kms_keyrings.json")
kms_keys = load("kms_keys.json")
kms_versions = load("kms_versions.json")
kms_iam = load("kms_iam.json")

cloud_run = []
legacy = []
for kind, resources in (("service", services), ("job", jobs)):
    for resource in resources:
        name = resource.get("metadata", {}).get("name") or resource.get("name", "")
        refs = env_refs(resource)
        item = {"kind": kind, "name": name, "env": refs}
        cloud_run.append(item)
        for ref in refs:
            if ref.get("name") == "PRIVATE_KEY" or ref.get("secret") == "synapse-staging-private-key":
                legacy.append({"kind": kind, "name": name, "env": ref})

secret_names = sorted(
    (item.get("name", "").split("/")[-1] for item in secrets if item.get("name")),
)
kms_key_names = sorted(
    (item.get("name", "").split("/")[-1] for item in kms_keys if item.get("name")),
)

summary = {
    "projectId": project_id,
    "region": region,
    "environment": "staging",
    "cloudRunResourceCount": len(cloud_run),
    "secretCount": len(secret_names),
    "kmsKeyRingCount": len(kms_keyrings),
    "kmsKeyCount": len(kms_key_names),
    "kmsVersionCount": len(kms_versions),
    "legacySignerReferenceCount": len(legacy),
    "stagingPrivateKeySecretPresent": "synapse-staging-private-key" in secret_names,
    "withdrawSignerKmsKeyPresent": "synapse-staging-withdraw-signer" in kms_key_names,
}
report = {
    "status": "success",
    "summary": summary,
    "legacySignerReferences": legacy,
    "cloudRun": cloud_run,
    "secretNames": secret_names,
    "kmsKeyRings": kms_keyrings,
    "kmsKeys": kms_keys,
    "kmsVersions": kms_versions,
    "kmsIamPolicy": kms_iam,
}
(root / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
print(json.dumps(summary, indent=2, sort_keys=True))
PY

echo "[staging-security-audit] report=${OUT_DIR}/report.json"
