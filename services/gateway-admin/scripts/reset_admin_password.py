from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import psycopg
from psycopg.conninfo import conninfo_to_dict

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.core.security import hash_password
from src.storage import PostgresAdminStore


DEFAULT_EMAIL = "super@synapse.network"
DEFAULT_PASSWORD = "qwer@1234"
DEFAULT_LOCAL_DSN = "postgresql://synapse_admin_app:12345678@localhost:5432/synapse_gateway_admin"
LOCAL_HOSTS = {"", "localhost", "127.0.0.1", "::1"}


@dataclass(frozen=True)
class ResetPasswordSummary:
    admin_id: str
    email: str
    revoked_sessions: int
    dsn_host: str
    dsn_dbname: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Reset a gateway-admin user's password with the same PBKDF2 hashing used by the app. "
            "Defaults are intentionally set for local super-admin recovery."
        )
    )
    parser.add_argument(
        "--dsn",
        default=os.environ.get("ADMIN_DATABASE_DSN", DEFAULT_LOCAL_DSN),
        help="PostgreSQL DSN for the gateway-admin database. Defaults to ADMIN_DATABASE_DSN, then the local dev DSN.",
    )
    parser.add_argument("--email", default=DEFAULT_EMAIL, help=f"Admin email to reset. Default: {DEFAULT_EMAIL}")
    parser.add_argument("--password", default=DEFAULT_PASSWORD, help="New plaintext password. Default: qwer@1234")
    parser.add_argument(
        "--keep-sessions",
        action="store_true",
        help="Do not revoke active sessions for this admin. Default behavior revokes existing sessions.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Required when the DSN does not point at localhost. This prevents accidental production resets.",
    )
    return parser.parse_args()


def _dsn_info(dsn: str) -> tuple[str, str]:
    info = conninfo_to_dict(dsn)
    return str(info.get("host") or ""), str(info.get("dbname") or "")


def _require_confirmation_for_remote_dsn(dsn: str, confirmed: bool) -> None:
    host, dbname = _dsn_info(dsn)
    if host in LOCAL_HOSTS:
        return
    if confirmed:
        return
    raise SystemExit(
        f"refusing to reset password on non-local database host={host!r} dbname={dbname!r}. "
        "Pass --yes only after confirming this is the intended environment."
    )


def _revoke_admin_sessions(dsn: str, admin_id: str) -> int:
    with psycopg.connect(dsn, autocommit=False) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE admin_sessions
                SET status = 'revoked',
                    revoked_at = NOW()
                WHERE admin_id = %s
                  AND status != 'revoked'
                """,
                (admin_id,),
            )
            revoked = cur.rowcount
        conn.commit()
    return int(revoked or 0)


def reset_admin_password(
    *,
    dsn: str,
    email: str,
    password: str,
    revoke_sessions: bool,
    confirmed_remote: bool,
) -> ResetPasswordSummary:
    normalized_email = email.strip().lower()
    if not normalized_email:
        raise SystemExit("email is required")
    if not password:
        raise SystemExit("password is required")

    _require_confirmation_for_remote_dsn(dsn, confirmed_remote)
    host, dbname = _dsn_info(dsn)
    store = PostgresAdminStore.from_dsn(dsn)
    user = store.identity.get_user_by_email(normalized_email)
    if user is None:
        raise SystemExit(f"admin user not found: {normalized_email}")

    store.identity.update_password_hash(user.admin_id, hash_password(password))
    revoked_sessions = _revoke_admin_sessions(dsn, user.admin_id) if revoke_sessions else 0
    return ResetPasswordSummary(
        admin_id=user.admin_id,
        email=user.email,
        revoked_sessions=revoked_sessions,
        dsn_host=host or "localhost",
        dsn_dbname=dbname,
    )


def main() -> None:
    args = parse_args()
    summary = reset_admin_password(
        dsn=args.dsn,
        email=args.email,
        password=args.password,
        revoke_sessions=not args.keep_sessions,
        confirmed_remote=args.yes,
    )
    print(
        "admin password reset complete:",
        {
            "adminId": summary.admin_id,
            "email": summary.email,
            "revokedSessions": summary.revoked_sessions,
            "databaseHost": summary.dsn_host,
            "databaseName": summary.dsn_dbname,
        },
    )
    print("next: sign in again; MFA/OTP is unchanged and may still be required.")


if __name__ == "__main__":
    main()
