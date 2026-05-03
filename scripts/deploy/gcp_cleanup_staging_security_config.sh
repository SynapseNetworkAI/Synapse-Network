#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-${CLOUDSDK_CORE_PROJECT:-}}}}"
ENVIRONMENT="${ENVIRONMENT:-staging}"
AUDIT_REPORT="${STAGING_SECURITY_AUDIT_REPORT:-}"
KMS_E2E_REPORT="${STAGING_KMS_WITHDRAWAL_E2E_REPORT:-}"
CONFIRM="${STAGING_SECURITY_CLEANUP_CONFIRM:-}"
TERRAFORM_DISABLED="${STAGING_LEGACY_WITHDRAW_SECRET_TERRAFORM_DISABLED:-}"

usage() {
  cat >&2 <<'EOF'
Usage:
  STAGING_SECURITY_CLEANUP_CONFIRM=I_UNDERSTAND_THIS_DELETES_STAGING_SECURITY_RESOURCES \
  STAGING_LEGACY_WITHDRAW_SECRET_TERRAFORM_DISABLED=1 \
  STAGING_SECURITY_AUDIT_REPORT=output/security/staging-config-audit/<timestamp>/report.json \
  STAGING_KMS_WITHDRAWAL_E2E_REPORT=<withdrawal-e2e-report.json> \
    bash scripts/deploy/gcp_cleanup_staging_security_config.sh <gcp-project-id>

Purpose:
  Deletes the obsolete staging withdrawal signer Secret Manager secret only
  after Cloud Run no longer references it and KMS withdrawal E2E evidence has
  passed. It does not delete KMS key rings or crypto keys; Cloud KMS key material
  cleanup must use key-version destroy/disable workflows explicitly.
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

if [[ -z "${PROJECT_ID}" ]]; then
  usage
  exit 2
fi

if [[ "${ENVIRONMENT}" != "staging" ]]; then
  echo "refusing non-staging environment: ${ENVIRONMENT}" >&2
  exit 2
fi

if [[ "${CONFIRM}" != "I_UNDERSTAND_THIS_DELETES_STAGING_SECURITY_RESOURCES" ]]; then
  usage
  echo "missing required STAGING_SECURITY_CLEANUP_CONFIRM" >&2
  exit 2
fi

if [[ "${TERRAFORM_DISABLED}" != "1" ]]; then
  cat >&2 <<'EOF'
FATAL STAGING-CLEANUP-000: set
legacy_withdraw_private_key_secret_enabled=false in Terraform vars, apply that
change, then rerun with STAGING_LEGACY_WITHDRAW_SECRET_TERRAFORM_DISABLED=1.
Otherwise Terraform will recreate synapse-staging-private-key after cleanup.
EOF
  exit 2
fi

if [[ -z "${AUDIT_REPORT}" || ! -f "${AUDIT_REPORT}" ]]; then
  echo "missing STAGING_SECURITY_AUDIT_REPORT file: ${AUDIT_REPORT:-<unset>}" >&2
  exit 2
fi

if [[ -z "${KMS_E2E_REPORT}" || ! -f "${KMS_E2E_REPORT}" ]]; then
  echo "missing STAGING_KMS_WITHDRAWAL_E2E_REPORT file: ${KMS_E2E_REPORT:-<unset>}" >&2
  exit 2
fi

require_cmd gcloud
require_cmd python3

ACTIVE_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
if [[ "${ACTIVE_PROJECT}" != "${PROJECT_ID}" ]]; then
  echo "active gcloud project mismatch: active=${ACTIVE_PROJECT:-<unset>} expected=${PROJECT_ID}" >&2
  exit 2
fi

python3 - "${AUDIT_REPORT}" "${KMS_E2E_REPORT}" <<'PY'
import json
import sys
from pathlib import Path

audit_path, e2e_path = map(Path, sys.argv[1:3])
audit = json.loads(audit_path.read_text())
e2e = json.loads(e2e_path.read_text())

summary = audit.get("summary") or {}
if summary.get("legacySignerReferenceCount") != 0:
    raise SystemExit(
        "FATAL STAGING-CLEANUP-001: Cloud Run still references PRIVATE_KEY or synapse-staging-private-key"
    )
if not summary.get("withdrawSignerKmsKeyPresent"):
    raise SystemExit("FATAL STAGING-CLEANUP-002: staging KMS withdrawal signer key is missing")
if e2e.get("failed"):
    raise SystemExit("FATAL STAGING-CLEANUP-003: KMS withdrawal E2E report has failures")
text = e2e_path.read_text().lower()
if "gcp_kms" not in text or "withdraw" not in text:
    raise SystemExit(
        "FATAL STAGING-CLEANUP-004: E2E report does not prove gcp_kms withdrawal signing"
    )
PY

echo "[staging-security-cleanup] deleting obsolete Secret Manager secret synapse-staging-private-key"
gcloud secrets delete synapse-staging-private-key --project="${PROJECT_ID}" --quiet

cat <<'EOF'
[staging-security-cleanup] done

KMS note:
  Cloud KMS key rings and crypto keys cannot be physically deleted. If an unused
  staging KMS key version must be retired, use `gcloud kms keys versions destroy`
  on that explicit version after confirming it is not configured in Terraform,
  Cloud Run, or SynapseCore.platformSigner().
EOF
