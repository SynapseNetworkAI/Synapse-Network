#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-fabled-archive-494108-k5}"
REGION="${REGION:-us-central1}"
APPLY=false

usage() {
  cat >&2 <<'USAGE'
Usage:
  bash scripts/ops/gcp_migrate_staging_plain_secret_config.sh [--apply]

Migrates allowlisted non-credential staging values out of Secret Manager:
  - synapse-staging-gmail-username -> GMAIL_SMTP_USERNAME
  - synapse-staging-gateway-admin-wallet -> GATEWAY_INTERNAL_ADMIN_WALLET,
    PLATFORM_FEE_ADMIN_WALLETS, INDEXER_ADMIN_WALLETS

The script writes env.staging without printing values, patches live Cloud Run
services/jobs to use plain env vars, verifies no live references remain, and
only deletes the two allowlisted Secret Manager secrets when --apply is set.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      APPLY=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/env.staging"
ENV_EXAMPLE="${ROOT_DIR}/env.staging.example"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

secret_value() {
  local secret_id="$1"
  gcloud secrets versions access latest \
    --project="${PROJECT_ID}" \
    --secret="${secret_id}"
}

update_env_file() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    cp "${ENV_EXAMPLE}" "${ENV_FILE}"
    chmod 600 "${ENV_FILE}"
  fi

  GMAIL_SMTP_USERNAME_VALUE="${GMAIL_SMTP_USERNAME_VALUE}" \
  STAGING_ADMIN_WALLET_VALUE="${STAGING_ADMIN_WALLET_VALUE}" \
  ENV_FILE="${ENV_FILE}" \
  python3 - <<'PY'
import os
from pathlib import Path

path = Path(os.environ["ENV_FILE"])
updates = {
    "GMAIL_SMTP_USERNAME": os.environ["GMAIL_SMTP_USERNAME_VALUE"],
    "GATEWAY_INTERNAL_ADMIN_WALLET": os.environ["STAGING_ADMIN_WALLET_VALUE"],
    "PLATFORM_FEE_ADMIN_WALLETS": os.environ["STAGING_ADMIN_WALLET_VALUE"],
    "INDEXER_ADMIN_WALLETS": os.environ["STAGING_ADMIN_WALLET_VALUE"],
}

lines = path.read_text().splitlines()
seen: set[str] = set()
out: list[str] = []
for line in lines:
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in line:
        out.append(line)
        continue
    key = line.split("=", 1)[0].strip()
    if key in updates:
        out.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        out.append(line)

missing = [key for key in updates if key not in seen]
if missing:
    out.append("")
    out.append("# Migrated from staging Secret Manager plain config.")
    out.extend(f"{key}={updates[key]}" for key in missing)

path.write_text("\n".join(out) + "\n")
path.chmod(0o600)
PY
}

update_service_env() {
  local service="$1"
  local remove_secrets="$2"
  local vars="$3"
  echo "[plain-config-migrate] updating service ${service}" >&2
  if [[ "${APPLY}" == "true" ]]; then
    gcloud run services update "${service}" \
      --project="${PROJECT_ID}" \
      --region="${REGION}" \
      --remove-secrets="${remove_secrets}" \
      --quiet >/dev/null
    gcloud run services update "${service}" \
      --project="${PROJECT_ID}" \
      --region="${REGION}" \
      --update-env-vars="${vars}" \
      --quiet >/dev/null
  fi
}

update_job_env() {
  local job="$1"
  local remove_secrets="$2"
  local vars="$3"
  echo "[plain-config-migrate] updating job ${job}" >&2
  if [[ "${APPLY}" == "true" ]]; then
    gcloud run jobs update "${job}" \
      --project="${PROJECT_ID}" \
      --region="${REGION}" \
      --remove-secrets="${remove_secrets}" \
      --quiet >/dev/null
    gcloud run jobs update "${job}" \
      --project="${PROJECT_ID}" \
      --region="${REGION}" \
      --update-env-vars="${vars}" \
      --quiet >/dev/null
  fi
}

verify_no_live_refs() {
  python3 - <<'PY'
import json
import os
import subprocess
import sys

project = os.environ["PROJECT_ID"]
region = os.environ["REGION"]
targets = {
    "synapse-staging-gmail-username",
    "synapse-staging-gateway-admin-wallet",
}

def run(args: list[str]) -> str:
    return subprocess.check_output(args, text=True)

def containers(data: dict, kind: str) -> list[dict]:
    if kind == "services":
        return data.get("spec", {}).get("template", {}).get("spec", {}).get("containers", [])
    return (
        data.get("spec", {})
        .get("template", {})
        .get("spec", {})
        .get("template", {})
        .get("spec", {})
        .get("containers", [])
    )

hits: list[tuple[str, str, str, str]] = []
for kind in ("services", "jobs"):
    names = run([
        "gcloud", "run", kind, "list",
        "--project", project,
        "--region", region,
        "--format=value(metadata.name)",
    ]).splitlines()
    for name in names:
        raw = run([
            "gcloud", "run", kind, "describe", name,
            "--project", project,
            "--region", region,
            "--format=json",
        ])
        data = json.loads(raw)
        for container in containers(data, kind):
            for env in container.get("env", []) or []:
                ref = (env.get("valueFrom") or {}).get("secretKeyRef") or {}
                secret = ref.get("name")
                if secret in targets:
                    hits.append((kind, name, env.get("name", ""), secret))

if hits:
    for hit in hits:
        print("live secret ref remains:", " ".join(hit), file=sys.stderr)
    sys.exit(1)
print("[plain-config-migrate] no live Cloud Run references remain", file=sys.stderr)
PY
}

delete_secret() {
  local secret_id="$1"
  echo "[plain-config-migrate] deleting Secret Manager secret ${secret_id}" >&2
  if [[ "${APPLY}" == "true" ]]; then
    gcloud secrets delete "${secret_id}" \
      --project="${PROJECT_ID}" \
      --quiet >/dev/null
  fi
}

require_cmd gcloud
require_cmd python3

GMAIL_SMTP_USERNAME_VALUE="$(secret_value synapse-staging-gmail-username)"
STAGING_ADMIN_WALLET_VALUE="$(secret_value synapse-staging-gateway-admin-wallet)"

if [[ -z "${GMAIL_SMTP_USERNAME_VALUE}" || -z "${STAGING_ADMIN_WALLET_VALUE}" ]]; then
  echo "one or more allowlisted Secret Manager values are empty; refusing to migrate" >&2
  exit 1
fi

update_env_file

gateway_vars="^|^GMAIL_SMTP_USERNAME=${GMAIL_SMTP_USERNAME_VALUE}|PLATFORM_FEE_ADMIN_WALLETS=${STAGING_ADMIN_WALLET_VALUE}|INDEXER_ADMIN_WALLETS=${STAGING_ADMIN_WALLET_VALUE}"
admin_vars="^|^GATEWAY_INTERNAL_ADMIN_WALLET=${STAGING_ADMIN_WALLET_VALUE}"
gateway_remove_secrets="GMAIL_SMTP_USERNAME,PLATFORM_FEE_ADMIN_WALLETS,INDEXER_ADMIN_WALLETS"
admin_remove_secrets="GATEWAY_INTERNAL_ADMIN_WALLET"

update_service_env synapse-staging-gateway "${gateway_remove_secrets}" "${gateway_vars}"
update_service_env synapse-staging-gateway-admin "${admin_remove_secrets}" "${admin_vars}"

gateway_jobs=(
  synapse-staging-consumer-withdraw-chain-recovery
  synapse-staging-db-migrate
  synapse-staging-deposit-indexer
  synapse-staging-in-app-notification-cleanup
  synapse-staging-notification-outbox-drain
  synapse-staging-withdrawal-expiry-sweeper
)
for job in "${gateway_jobs[@]}"; do
  update_job_env "${job}" "${gateway_remove_secrets}" "${gateway_vars}"
done
update_job_env synapse-staging-gateway-admin-db-migrate "${admin_remove_secrets}" "${admin_vars}"

if [[ "${APPLY}" == "true" ]]; then
  PROJECT_ID="${PROJECT_ID}" REGION="${REGION}" verify_no_live_refs
  delete_secret synapse-staging-gmail-username
  delete_secret synapse-staging-gateway-admin-wallet
  echo "[plain-config-migrate] migration applied; env.staging updated and allowlisted secrets deleted" >&2
else
  echo "[plain-config-migrate] dry-run only; rerun with --apply to patch Cloud Run and delete secrets" >&2
fi
