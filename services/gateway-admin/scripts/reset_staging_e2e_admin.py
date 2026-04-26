from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import NoReturn
from uuid import uuid4

import psycopg
from psycopg.conninfo import conninfo_to_dict
from psycopg.types.json import Jsonb

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.core.security import hash_password  # noqa: E402
from src.core.totp import generate_totp_code  # noqa: E402


DEFAULT_EMAIL = "staging-admin-e2e@synapse-network.ai"
DEFAULT_DISPLAY_NAME = "Staging Admin E2E"
DEFAULT_ROLE_KEY = "finance_reviewer"
LOCAL_HOSTS = {"", "localhost", "127.0.0.1", "::1"}
MIN_PASSWORD_LENGTH = 16
ERROR_MISSING_DSN = "missing admin database DSN"
ERROR_NON_E2E_EMAIL = "refusing to reset a non-staging/non-e2e admin email"
ERROR_CONFIRM_STAGING = "refusing non-local admin DB reset without --confirm-staging"
ERROR_SHORT_PASSWORD = "staging admin E2E password must be at least 16 characters"  # noqa: S105


@dataclass(frozen=True)
class ResetStagingAdminSummary:
    admin_id: str
    email: str
    role_key: str
    factor_label: str
    revoked_sessions: int
    revoked_totp_factors: int
    created_user: bool
    database_host: str
    database_name: str


def fail(message: str) -> NoReturn:
    raise SystemExit(message)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Reset the dedicated staging admin E2E account password and active TOTP factor. "
            "Secrets are read from environment variables so they do not appear in shell history."
        )
    )
    parser.add_argument("--dsn", default=os.getenv("ADMIN_DATABASE_MIGRATION_DSN") or os.getenv("ADMIN_DATABASE_DSN"))
    parser.add_argument("--email", default=os.getenv("STAGING_ADMIN_E2E_EMAIL", DEFAULT_EMAIL))
    parser.add_argument("--display-name", default=os.getenv("STAGING_ADMIN_E2E_DISPLAY_NAME", DEFAULT_DISPLAY_NAME))
    parser.add_argument("--role-key", default=os.getenv("STAGING_ADMIN_E2E_ROLE_KEY", DEFAULT_ROLE_KEY))
    parser.add_argument("--password-env", default="STAGING_ADMIN_E2E_PASSWORD")
    parser.add_argument("--totp-secret-env", default="STAGING_ADMIN_E2E_OTP_SECRET")
    parser.add_argument(
        "--confirm-staging",
        action="store_true",
        help="Required for non-local database DSNs.",
    )
    return parser.parse_args()


def _required_env(name: str) -> str:
    value = os.getenv(name, "")
    if not value.strip():
        fail(f"missing required environment variable: {name}")
    return value.strip()


def _dsn_info(dsn: str) -> tuple[str, str]:
    info = conninfo_to_dict(dsn)
    return str(info.get("host") or ""), str(info.get("dbname") or "")


def _require_staging_target(*, dsn: str, email: str, confirmed: bool) -> tuple[str, str]:
    if not dsn:
        fail(ERROR_MISSING_DSN)
    normalized_email = email.strip().lower()
    if "e2e" not in normalized_email and "staging" not in normalized_email:
        fail(ERROR_NON_E2E_EMAIL)
    host, dbname = _dsn_info(dsn)
    is_local = host in LOCAL_HOSTS
    if not is_local and not confirmed:
        fail(ERROR_CONFIRM_STAGING)
    if not is_local and dbname and "staging" not in dbname:
        fail(f"refusing to reset admin user outside a staging database: {dbname}")
    if is_local and dbname and dbname not in {"synapse_gateway_admin"} and "staging" not in dbname:
        fail(f"refusing to reset admin user outside a local/staging admin database: {dbname}")
    return host or "localhost", dbname


def _validate_totp_secret(secret: str) -> None:
    try:
        generate_totp_code(secret)
    except Exception as exc:
        fail(f"invalid TOTP secret for Google Authenticator-compatible codes: {exc}")


def reset_staging_admin(
    *,
    dsn: str,
    email: str,
    display_name: str,
    role_key: str,
    password: str,
    totp_secret: str,
    confirmed_staging: bool,
) -> ResetStagingAdminSummary:
    database_host, database_name = _require_staging_target(dsn=dsn, email=email, confirmed=confirmed_staging)
    if len(password) < MIN_PASSWORD_LENGTH:
        fail(ERROR_SHORT_PASSWORD)
    _validate_totp_secret(totp_secret)

    now = datetime.now(timezone.utc)
    normalized_email = email.strip().lower()
    admin_id = ""
    created_user = False
    revoked_sessions = 0
    revoked_totp_factors = 0
    factor_label = "staging_e2e_totp"

    with psycopg.connect(dsn, autocommit=False) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT status FROM admin_roles WHERE role_key = %s", (role_key,))
            role_row = cur.fetchone()
            if role_row is None or str(role_row[0]) != "active":
                fail(f"active admin role not found: {role_key}")

            cur.execute("SELECT admin_id FROM admin_users WHERE lower(email) = lower(%s)", (normalized_email,))
            user_row = cur.fetchone()
            if user_row is None:
                admin_id = f"adm_e2e_{uuid4().hex[:16]}"
                created_user = True
                cur.execute(
                    """
                    INSERT INTO admin_users (
                        admin_id, email, display_name, status, auth_source,
                        password_hash, require_mfa, created_at, updated_at
                    )
                    VALUES (%s, %s, %s, 'active', 'bootstrap', %s, TRUE, %s, %s)
                    """,
                    (admin_id, normalized_email, display_name.strip(), hash_password(password), now, now),
                )
            else:
                admin_id = str(user_row[0])
                cur.execute(
                    """
                    UPDATE admin_users
                    SET display_name = %s,
                        status = 'active',
                        auth_source = 'bootstrap',
                        password_hash = %s,
                        require_mfa = TRUE,
                        updated_at = %s,
                        disabled_at = NULL
                    WHERE admin_id = %s
                    """,
                    (display_name.strip(), hash_password(password), now, admin_id),
                )

            cur.execute(
                """
                UPDATE admin_sessions
                SET status = 'revoked',
                    revoked_at = %s
                WHERE admin_id = %s
                  AND status != 'revoked'
                """,
                (now, admin_id),
            )
            revoked_sessions = int(cur.rowcount or 0)

            cur.execute(
                """
                DELETE FROM admin_mfa_enrollment_challenges
                WHERE admin_id = %s
                """,
                (admin_id,),
            )

            cur.execute(
                """
                UPDATE admin_mfa_factors
                SET status = 'revoked',
                    updated_at = %s,
                    revoked_at = %s
                WHERE admin_id = %s
                  AND factor_type = 'totp'
                  AND status != 'revoked'
                """,
                (now, now, admin_id),
            )
            revoked_totp_factors = int(cur.rowcount or 0)

            cur.execute(
                """
                INSERT INTO admin_mfa_factors (
                    factor_id, admin_id, factor_type, factor_label, status,
                    secret_ref, payload_json, last_verified_at, created_at, updated_at, revoked_at
                )
                VALUES (%s, %s, 'totp', %s, 'active', %s, %s, %s, %s, %s, NULL)
                ON CONFLICT (admin_id, factor_type, factor_label) DO UPDATE
                SET status = 'active',
                    secret_ref = EXCLUDED.secret_ref,
                    payload_json = EXCLUDED.payload_json,
                    last_verified_at = EXCLUDED.last_verified_at,
                    updated_at = EXCLUDED.updated_at,
                    revoked_at = NULL
                """,
                (
                    f"mfa_{uuid4().hex[:24]}",
                    admin_id,
                    factor_label,
                    "secret-manager://synapse-staging-admin-e2e-otp-secret",
                    Jsonb({"totpSecret": totp_secret}),
                    now,
                    now,
                    now,
                ),
            )

            cur.execute(
                """
                UPDATE admin_user_role_bindings
                SET status = 'revoked',
                    updated_at = %s
                WHERE admin_id = %s
                  AND status = 'active'
                """,
                (now, admin_id),
            )
            cur.execute(
                """
                INSERT INTO admin_user_role_bindings (
                    binding_id, admin_id, role_key, scope_json, status,
                    granted_by, grant_reason, starts_at, created_at, updated_at
                )
                VALUES (%s, %s, %s, '{}'::jsonb, 'active', %s, %s, %s, %s, %s)
                """,
                (
                    f"bind_e2e_{uuid4().hex[:16]}",
                    admin_id,
                    role_key,
                    "script.reset_staging_e2e_admin",
                    "staging admin e2e credential reset",
                    now,
                    now,
                    now,
                ),
            )

            cur.execute(
                """
                INSERT INTO admin_action_audit (
                    action_type, operator_id, operator_email, operator_role,
                    resource_type, resource_id, result_status, detail_json, created_at
                )
                VALUES (%s, %s, %s, %s, 'admin_user', %s, 'success', %s, %s)
                """,
                (
                    "admin.e2e.credentials.reset",
                    "script.reset_staging_e2e_admin",
                    "script.reset_staging_e2e_admin",
                    "system",
                    admin_id,
                    Jsonb(
                        {
                            "emailHash": "sha256-only-in-evidence",
                            "roleKey": role_key,
                            "createdUser": created_user,
                            "revokedSessions": revoked_sessions,
                            "revokedTotpFactors": revoked_totp_factors,
                        }
                    ),
                    now,
                ),
            )
        conn.commit()

    return ResetStagingAdminSummary(
        admin_id=admin_id,
        email=normalized_email,
        role_key=role_key,
        factor_label=factor_label,
        revoked_sessions=revoked_sessions,
        revoked_totp_factors=revoked_totp_factors,
        created_user=created_user,
        database_host=database_host,
        database_name=database_name,
    )


def main() -> None:
    args = parse_args()
    summary = reset_staging_admin(
        dsn=args.dsn,
        email=args.email,
        display_name=args.display_name,
        role_key=args.role_key,
        password=_required_env(args.password_env),
        totp_secret=_required_env(args.totp_secret_env),
        confirmed_staging=args.confirm_staging,
    )
    print(
        "staging admin e2e credentials reset complete:",
        {
            "adminId": summary.admin_id,
            "email": summary.email,
            "roleKey": summary.role_key,
            "factorLabel": summary.factor_label,
            "createdUser": summary.created_user,
            "revokedSessions": summary.revoked_sessions,
            "revokedTotpFactors": summary.revoked_totp_factors,
            "databaseHost": summary.database_host,
            "databaseName": summary.database_name,
        },
    )
    print("next: read password/TOTP from Secret Manager only when you need to log in.")


if __name__ == "__main__":
    main()
