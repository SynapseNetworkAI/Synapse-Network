#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-${CLOUDSDK_CORE_PROJECT:-}}}"
ADMIN_EMAIL="${STAGING_ADMIN_E2E_EMAIL:-staging-admin-e2e@synapse-network.ai}"
ADMIN_DISPLAY_NAME="${STAGING_ADMIN_E2E_DISPLAY_NAME:-Staging Admin E2E}"
ADMIN_ROLE_KEY="${STAGING_ADMIN_E2E_ROLE_KEY:-finance_admin}"
PASSWORD_SECRET_ID="${STAGING_ADMIN_E2E_PASSWORD_SECRET_ID:-synapse-staging-admin-e2e-password}"
OTP_SECRET_ID="${STAGING_ADMIN_E2E_OTP_SECRET_ID:-synapse-staging-admin-e2e-otp-secret}"
ADMIN_DSN_SECRET_ID="${STAGING_ADMIN_E2E_ADMIN_DSN_SECRET_ID:-synapse-staging-admin-database-migration-dsn}"
PYTHON_BIN="${SYNAPSE_GATEWAY_ADMIN_PYTHON:-services/gateway-admin/.venv/bin/python}"
ALLOW_ANY_CONFIRM_VALUE="I_UNDERSTAND_THIS_RESETS_A_STAGING_ADMIN_ACCOUNT"
CLOUD_SQL_INSTANCE="${STAGING_ADMIN_CLOUD_SQL_INSTANCE:-${PROJECT_ID:+${PROJECT_ID}:us-central1:synapse-staging-postgres}}"

usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/deploy/gcp_reset_staging_admin_e2e.sh <gcp-project-id>
  bash scripts/deploy/gcp_reset_staging_admin_e2e.sh <gcp-project-id> --email admin@example.com

Optional environment overrides:
  STAGING_ADMIN_E2E_EMAIL          default: staging-admin-e2e@synapse-network.ai
  STAGING_ADMIN_E2E_DISPLAY_NAME   default: Staging Admin E2E
  STAGING_ADMIN_E2E_ROLE_KEY       default: finance_admin
  STAGING_ADMIN_E2E_PASSWORD       optional: use this password instead of generating one
  STAGING_ADMIN_E2E_OTP_SECRET     optional: use this TOTP seed instead of generating one
  STAGING_ADMIN_RESET_CONFIRM      required for non-staging/non-e2e emails:
                                    I_UNDERSTAND_THIS_RESETS_A_STAGING_ADMIN_ACCOUNT
  STAGING_ADMIN_RESET_STORE_SECRETS true|false; defaults true for the E2E account
                                    and false for custom admin emails
  STAGING_ADMIN_DATABASE_DSN       optional locally reachable admin DB DSN override
  STAGING_ADMIN_CLOUD_SQL_PROXY_PORT
                                    optional port for rewriting /cloudsql DSNs to
                                    127.0.0.1:<port> when Cloud SQL Auth Proxy is running
  PRINT_SECRETS_ONCE=true          print generated password/TOTP once to this terminal

By default this script writes new Secret Manager versions and resets the
dedicated staging E2E admin account. With --email/--username and the explicit
confirmation variable, it can reset an existing staging admin account by email.
Custom admin resets do not write to the shared E2E Secret Manager entries unless
STAGING_ADMIN_RESET_STORE_SECRETS=true and custom secret ids are supplied.
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

port_is_open() {
  local host="$1"
  local port="$2"
  ("${PYTHON_BIN}" - "$host" "$port" <<'PY'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.settimeout(1.0)
    sys.exit(0 if sock.connect_ex((host, port)) == 0 else 1)
PY
  )
}

rewrite_cloudsql_dsn_to_tcp() {
  local raw_dsn="$1"
  local port="$2"
  RAW_ADMIN_DSN="${raw_dsn}" ADMIN_PROXY_PORT="${port}" "${PYTHON_BIN}" - <<'PY'
import os
from urllib.parse import quote, unquote, urlparse

raw = os.environ["RAW_ADMIN_DSN"]
port = os.environ["ADMIN_PROXY_PORT"]
parsed = urlparse(raw)
user = quote(unquote(parsed.username or ""), safe="")
password = quote(unquote(parsed.password or ""), safe="")
database = (parsed.path or "/synapse_gateway_admin").lstrip("/")
print(f"postgresql://{user}:{password}@127.0.0.1:{port}/{database}")
PY
}

print_cloudsql_proxy_hint() {
  cat >&2 <<EOF
The staging admin DB secret uses a Cloud Run /cloudsql Unix socket DSN.
Local machines cannot use that socket directly.

Start Cloud SQL Auth Proxy in one terminal:
  cloud-sql-proxy --address 127.0.0.1 --port 5433 ${CLOUD_SQL_INSTANCE}

Then rerun this reset with:
  STAGING_ADMIN_CLOUD_SQL_PROXY_PORT=5433 \\
  <same command>

Alternatively set STAGING_ADMIN_DATABASE_DSN to a locally reachable admin DB DSN.
EOF
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --email|--username)
      ADMIN_EMAIL="${2:-}"
      shift 2
      ;;
    --display-name)
      ADMIN_DISPLAY_NAME="${2:-}"
      shift 2
      ;;
    --role-key)
      ADMIN_ROLE_KEY="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "unknown option: $1" >&2
      usage
      exit 2
      ;;
    *)
      if [[ -z "${PROJECT_ID}" ]]; then
        PROJECT_ID="$1"
      else
        echo "unexpected positional argument: $1" >&2
        usage
        exit 2
      fi
      shift
      ;;
  esac
done

if [[ -z "${PROJECT_ID}" ]]; then
  usage
  exit 2
fi
if [[ -z "${CLOUD_SQL_INSTANCE}" ]]; then
  CLOUD_SQL_INSTANCE="${PROJECT_ID}:us-central1:synapse-staging-postgres"
fi

IS_DEDICATED_STAGING_EMAIL=0
if [[ "${ADMIN_EMAIL}" == *"e2e"* || "${ADMIN_EMAIL}" == *"staging"* ]]; then
  IS_DEDICATED_STAGING_EMAIL=1
fi

ALLOW_ANY_STAGING_ADMIN=0
if [[ "${IS_DEDICATED_STAGING_EMAIL}" -eq 0 ]]; then
  if [[ "${STAGING_ADMIN_RESET_CONFIRM:-}" != "${ALLOW_ANY_CONFIRM_VALUE}" ]]; then
    echo "refusing to reset non-staging/non-e2e admin email: ${ADMIN_EMAIL}" >&2
    echo "Set STAGING_ADMIN_RESET_CONFIRM=${ALLOW_ANY_CONFIRM_VALUE} to reset an existing staging admin account." >&2
    exit 2
  fi
  ALLOW_ANY_STAGING_ADMIN=1
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

require_secret_placeholder "${ADMIN_DSN_SECRET_ID}"

STORE_SECRETS="${STAGING_ADMIN_RESET_STORE_SECRETS:-}"
if [[ -z "${STORE_SECRETS}" ]]; then
  if [[ "${IS_DEDICATED_STAGING_EMAIL}" -eq 1 ]]; then
    STORE_SECRETS=true
  else
    STORE_SECRETS=false
  fi
fi

if [[ "${STORE_SECRETS}" != "true" && "${STORE_SECRETS}" != "false" ]]; then
  echo "STAGING_ADMIN_RESET_STORE_SECRETS must be true or false" >&2
  exit 2
fi

if [[ "${STORE_SECRETS}" == "true" ]]; then
  if [[ "${IS_DEDICATED_STAGING_EMAIL}" -eq 0 &&
    ( "${PASSWORD_SECRET_ID}" == "synapse-staging-admin-e2e-password" ||
      "${OTP_SECRET_ID}" == "synapse-staging-admin-e2e-otp-secret" ) ]]; then
    echo "custom admin resets must not overwrite the shared E2E Secret Manager entries." >&2
    echo "Either set STAGING_ADMIN_RESET_STORE_SECRETS=false or provide custom STAGING_ADMIN_E2E_PASSWORD_SECRET_ID and STAGING_ADMIN_E2E_OTP_SECRET_ID." >&2
    exit 2
  fi
  require_secret_placeholder "${PASSWORD_SECRET_ID}"
  require_secret_placeholder "${OTP_SECRET_ID}"
fi

PASSWORD_ENV_PROVIDED=0
OTP_ENV_PROVIDED=0
if [[ -n "${STAGING_ADMIN_E2E_PASSWORD:-}" ]]; then
  PASSWORD_ENV_PROVIDED=1
fi
if [[ -n "${STAGING_ADMIN_E2E_OTP_SECRET:-}" ]]; then
  OTP_ENV_PROVIDED=1
fi

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

ADMIN_DSN="${STAGING_ADMIN_DATABASE_DSN:-}"
if [[ -z "${ADMIN_DSN}" ]]; then
  ADMIN_DSN="$(gcloud secrets versions access latest \
    --secret="${ADMIN_DSN_SECRET_ID}" \
    --project="${PROJECT_ID}")"
fi

if [[ "${ADMIN_DSN}" == *"/cloudsql/"* ]]; then
  if [[ -n "${STAGING_ADMIN_CLOUD_SQL_PROXY_PORT:-}" ]]; then
    if ! port_is_open 127.0.0.1 "${STAGING_ADMIN_CLOUD_SQL_PROXY_PORT}"; then
      echo "Cloud SQL Auth Proxy is not listening on 127.0.0.1:${STAGING_ADMIN_CLOUD_SQL_PROXY_PORT}" >&2
      print_cloudsql_proxy_hint
      exit 2
    fi
    ADMIN_DSN="$(rewrite_cloudsql_dsn_to_tcp "${ADMIN_DSN}" "${STAGING_ADMIN_CLOUD_SQL_PROXY_PORT}")"
  elif [[ ! -d /cloudsql ]]; then
    print_cloudsql_proxy_hint
    exit 2
  fi
fi

TOTP_SECRET_REF=""
if [[ "${STORE_SECRETS}" == "true" ]]; then
  put_secret "${PASSWORD_SECRET_ID}" "${ADMIN_PASSWORD}"
  put_secret "${OTP_SECRET_ID}" "${ADMIN_OTP_SECRET}"
  TOTP_SECRET_REF="secret-manager://${OTP_SECRET_ID}"
else
  if [[ "${PRINT_SECRETS_ONCE:-false}" != "true" &&
    ( "${PASSWORD_ENV_PROVIDED}" -eq 0 || "${OTP_ENV_PROVIDED}" -eq 0 ) ]]; then
    echo "custom admin reset generated credentials are not stored; set PRINT_SECRETS_ONCE=true or provide STAGING_ADMIN_E2E_PASSWORD and STAGING_ADMIN_E2E_OTP_SECRET." >&2
    exit 2
  fi
fi

PYTHON_ARGS=(
  services/gateway-admin/scripts/reset_staging_e2e_admin.py
  --dsn "${ADMIN_DSN}"
  --email "${ADMIN_EMAIL}"
  --display-name "${ADMIN_DISPLAY_NAME}"
  --role-key "${ADMIN_ROLE_KEY}"
  --totp-secret-ref "${TOTP_SECRET_REF}"
  --confirm-staging
)
if [[ "${ALLOW_ANY_STAGING_ADMIN}" -eq 1 ]]; then
  PYTHON_ARGS+=(--allow-any-staging-admin)
fi

STAGING_ADMIN_E2E_PASSWORD="${ADMIN_PASSWORD}" \
STAGING_ADMIN_E2E_OTP_SECRET="${ADMIN_OTP_SECRET}" \
"${PYTHON_BIN}" "${PYTHON_ARGS[@]}"

echo "[gcp-reset-staging-admin-e2e] project=${PROJECT_ID}"
echo "[gcp-reset-staging-admin-e2e] email=${ADMIN_EMAIL}"
echo "[gcp-reset-staging-admin-e2e] role=${ADMIN_ROLE_KEY}"
echo "[gcp-reset-staging-admin-e2e] passwordSecret=${PASSWORD_SECRET_ID}"
echo "[gcp-reset-staging-admin-e2e] otpSecret=${OTP_SECRET_ID}"
echo "[gcp-reset-staging-admin-e2e] storeSecrets=${STORE_SECRETS}"
echo "[gcp-reset-staging-admin-e2e] ok"
echo
if [[ "${STORE_SECRETS}" == "true" ]]; then
  echo "To read the password only when needed:"
  echo "  gcloud secrets versions access latest --secret=${PASSWORD_SECRET_ID} --project=${PROJECT_ID}"
  echo
  echo "To read the Google Authenticator manual key only when enrolling/checking:"
  echo "  gcloud secrets versions access latest --secret=${OTP_SECRET_ID} --project=${PROJECT_ID}"
fi

if [[ "${PRINT_SECRETS_ONCE:-false}" == "true" ]]; then
  echo
  echo "PRINT_SECRETS_ONCE=true was set. Do not paste this output into tickets or chat."
  echo "password=${ADMIN_PASSWORD}"
  echo "totpManualKey=${ADMIN_OTP_SECRET}"
fi
