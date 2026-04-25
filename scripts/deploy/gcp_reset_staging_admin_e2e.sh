#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-${CLOUDSDK_CORE_PROJECT:-}}}}"
ADMIN_EMAIL="${STAGING_ADMIN_E2E_EMAIL:-staging-admin-e2e@synapse-network.ai}"
ADMIN_DISPLAY_NAME="${STAGING_ADMIN_E2E_DISPLAY_NAME:-Staging Admin E2E}"
ADMIN_ROLE_KEY="${STAGING_ADMIN_E2E_ROLE_KEY:-finance_admin}"
PASSWORD_SECRET_ID="${STAGING_ADMIN_E2E_PASSWORD_SECRET_ID:-synapse-staging-admin-e2e-password}"
OTP_SECRET_ID="${STAGING_ADMIN_E2E_OTP_SECRET_ID:-synapse-staging-admin-e2e-otp-secret}"
ADMIN_DSN_SECRET_ID="${STAGING_ADMIN_E2E_ADMIN_DSN_SECRET_ID:-synapse-staging-admin-database-migration-dsn}"
PYTHON_BIN="${SYNAPSE_GATEWAY_ADMIN_PYTHON:-services/gateway-admin/.venv/bin/python}"

usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/deploy/gcp_reset_staging_admin_e2e.sh <gcp-project-id>

Optional environment overrides:
  STAGING_ADMIN_E2E_EMAIL          default: staging-admin-e2e@synapse-network.ai
  STAGING_ADMIN_E2E_DISPLAY_NAME   default: Staging Admin E2E
  STAGING_ADMIN_E2E_ROLE_KEY       default: finance_admin
  STAGING_ADMIN_E2E_PASSWORD       optional: use this password instead of generating one
  STAGING_ADMIN_E2E_OTP_SECRET     optional: use this TOTP seed instead of generating one
  PRINT_SECRETS_ONCE=true          print generated password/TOTP once to this terminal

This script writes new Secret Manager versions and resets only the dedicated
staging E2E admin account. It refuses non-staging/non-e2e account emails.
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

require_secret_placeholder() {
  local secret_id="$1"
  if ! gcloud secrets describe "${secret_id}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    echo "Secret Manager placeholder does not exist: ${secret_id}" >&2
    echo "Agent fix: run Terraform apply for infra/terraform/gcp-staging first." >&2
    exit 1
  fi
}

put_secret() {
  local secret_id="$1"
  local value="$2"
  printf '%s' "${value}" | PROJECT_ID="${PROJECT_ID}" bash scripts/deploy/gcp_put_secret.sh "${secret_id}" >/dev/null
}

if [[ -z "${PROJECT_ID}" ]]; then
  usage
  exit 2
fi

if [[ "${ADMIN_EMAIL}" != *"e2e"* && "${ADMIN_EMAIL}" != *"staging"* ]]; then
  echo "refusing to reset non-staging/non-e2e admin email: ${ADMIN_EMAIL}" >&2
  exit 2
fi

require_cmd gcloud
if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "missing gateway-admin Python interpreter: ${PYTHON_BIN}" >&2
  echo "Agent fix: run npm run ci:admin-gateway once, or set SYNAPSE_GATEWAY_ADMIN_PYTHON." >&2
  exit 1
fi

ACTIVE_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
if [[ "${ACTIVE_PROJECT}" != "${PROJECT_ID}" ]]; then
  echo "active gcloud project mismatch: active=${ACTIVE_PROJECT:-<unset>} expected=${PROJECT_ID}" >&2
  echo "Agent fix: run gcloud config set project ${PROJECT_ID}, then retry." >&2
  exit 2
fi

require_secret_placeholder "${PASSWORD_SECRET_ID}"
require_secret_placeholder "${OTP_SECRET_ID}"
require_secret_placeholder "${ADMIN_DSN_SECRET_ID}"

ADMIN_PASSWORD="${STAGING_ADMIN_E2E_PASSWORD:-$("${PYTHON_BIN}" - <<'PY'
import secrets
print("SynapseE2E-" + secrets.token_urlsafe(24))
PY
)}"

ADMIN_OTP_SECRET="${STAGING_ADMIN_E2E_OTP_SECRET:-$("${PYTHON_BIN}" - <<'PY'
import sys
from pathlib import Path
root = Path("services/gateway-admin").resolve()
sys.path.insert(0, str(root))
from src.core.totp import generate_totp_secret
print(generate_totp_secret())
PY
)}"

ADMIN_DSN="$(gcloud secrets versions access latest \
  --secret="${ADMIN_DSN_SECRET_ID}" \
  --project="${PROJECT_ID}")"

put_secret "${PASSWORD_SECRET_ID}" "${ADMIN_PASSWORD}"
put_secret "${OTP_SECRET_ID}" "${ADMIN_OTP_SECRET}"

STAGING_ADMIN_E2E_PASSWORD="${ADMIN_PASSWORD}" \
STAGING_ADMIN_E2E_OTP_SECRET="${ADMIN_OTP_SECRET}" \
"${PYTHON_BIN}" services/gateway-admin/scripts/reset_staging_e2e_admin.py \
  --dsn "${ADMIN_DSN}" \
  --email "${ADMIN_EMAIL}" \
  --display-name "${ADMIN_DISPLAY_NAME}" \
  --role-key "${ADMIN_ROLE_KEY}" \
  --confirm-staging

echo "[gcp-reset-staging-admin-e2e] project=${PROJECT_ID}"
echo "[gcp-reset-staging-admin-e2e] email=${ADMIN_EMAIL}"
echo "[gcp-reset-staging-admin-e2e] role=${ADMIN_ROLE_KEY}"
echo "[gcp-reset-staging-admin-e2e] passwordSecret=${PASSWORD_SECRET_ID}"
echo "[gcp-reset-staging-admin-e2e] otpSecret=${OTP_SECRET_ID}"
echo "[gcp-reset-staging-admin-e2e] ok"
echo
echo "To read the password only when needed:"
echo "  gcloud secrets versions access latest --secret=${PASSWORD_SECRET_ID} --project=${PROJECT_ID}"
echo
echo "To read the Google Authenticator manual key only when enrolling/checking:"
echo "  gcloud secrets versions access latest --secret=${OTP_SECRET_ID} --project=${PROJECT_ID}"

if [[ "${PRINT_SECRETS_ONCE:-false}" == "true" ]]; then
  echo
  echo "PRINT_SECRETS_ONCE=true was set. Do not paste this output into tickets or chat."
  echo "password=${ADMIN_PASSWORD}"
  echo "totpManualKey=${ADMIN_OTP_SECRET}"
fi
