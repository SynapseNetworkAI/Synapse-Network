from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import psycopg

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.core.security import hash_password
from src.domain import AdminUser, AdminUserRoleBinding
from src.domain.enums import AdminUserStatus, AuthSource, RoleBindingStatus, RoleStatus
from src.storage import PostgresAdminStore


DEFAULT_EMAIL = "mfa-enroll-test@synapse.network"
DEFAULT_PASSWORD = "".join(("EnrollUser#", "2026!"))
DEFAULT_DISPLAY_NAME = "MFA Enrollment Test"
DEFAULT_ROLE_KEY = "platform_ops_admin"


@dataclass(frozen=True)
class ResetSummary:
    admin_id: str
    email: str
    role_key: str
    require_mfa: bool
    deleted_sessions: int
    deleted_challenges: int
    deleted_factors: int
    deleted_bindings: int
    deleted_users: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Reset a deterministic gateway-admin test user that requires MFA but has no active TOTP factor."
    )
    parser.add_argument("--dsn", required=True, help="PostgreSQL DSN for the gateway-admin database")
    parser.add_argument("--email", default=DEFAULT_EMAIL, help=f"Test admin email. Default: {DEFAULT_EMAIL}")
    parser.add_argument("--password", default=DEFAULT_PASSWORD, help="Plaintext password to initialize for the test admin")
    parser.add_argument("--display-name", default=DEFAULT_DISPLAY_NAME, help="Display name for the test admin")
    parser.add_argument("--role-key", default=DEFAULT_ROLE_KEY, help="Role key to bind after reset")
    parser.add_argument(
        "--unsafe-allow-non-test-email",
        action="store_true",
        help="Allow operating on a non-default email. Dangerous: can overwrite a real admin account.",
    )
    parser.add_argument(
        "--require-mfa",
        dest="require_mfa",
        action="store_true",
        default=True,
        help="Require MFA for the test admin. Enabled by default.",
    )
    parser.add_argument(
        "--no-require-mfa",
        dest="require_mfa",
        action="store_false",
        help="Create the test admin without the MFA requirement.",
    )
    parser.add_argument(
        "--cleanup-only",
        action="store_true",
        help="Delete the target test admin and its session/MFA state without recreating it.",
    )
    return parser.parse_args()


def _ensure_safe_target_email(email: str, unsafe_allow_non_test_email: bool) -> None:
    normalized_email = email.strip().lower()
    if unsafe_allow_non_test_email:
        return
    if normalized_email != DEFAULT_EMAIL:
        raise SystemExit(
            "reset_mfa_enrollment_test_admin.py only allows the dedicated test email by default. "
            f"Use {DEFAULT_EMAIL} or pass --unsafe-allow-non-test-email if you intentionally want to override another admin."
        )


def _ensure_role_available(store: PostgresAdminStore, role_key: str) -> None:
    role = store.authorization.get_role(role_key)
    if role is None or role.status != RoleStatus.ACTIVE:
        raise SystemExit(f"role is not available: {role_key}")


def _ensure_no_approval_dependencies(cursor: psycopg.Cursor, admin_id: str) -> None:
    cursor.execute(
        """
        SELECT COUNT(*)
        FROM admin_approvals
        WHERE requester_id = %s OR current_approver_id = %s
        """,
        (admin_id, admin_id),
    )
    approval_row = cursor.fetchone()
    approval_count = int(approval_row[0]) if approval_row else 0
    cursor.execute(
        """
        SELECT COUNT(*)
        FROM admin_approval_steps
        WHERE approver_id = %s
        """,
        (admin_id,),
    )
    approval_step_row = cursor.fetchone()
    approval_step_count = int(approval_step_row[0]) if approval_step_row else 0
    if approval_count or approval_step_count:
        raise SystemExit(
            f"refusing to delete {admin_id}: linked approvals={approval_count}, approval_steps={approval_step_count}"
        )


def _delete_existing_admin_state(dsn: str, email: str) -> tuple[str | None, dict[str, int]]:
    counters = {
        "deleted_sessions": 0,
        "deleted_challenges": 0,
        "deleted_factors": 0,
        "deleted_bindings": 0,
        "deleted_users": 0,
    }
    with psycopg.connect(dsn, autocommit=False) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT admin_id FROM admin_users WHERE lower(email) = lower(%s)", (email,))
            row = cur.fetchone()
            if row is None:
                conn.commit()
                return None, counters

            admin_id = str(row[0])
            _ensure_no_approval_dependencies(cur, admin_id)

            cur.execute("DELETE FROM admin_sessions WHERE admin_id = %s", (admin_id,))
            counters["deleted_sessions"] = cur.rowcount

            cur.execute("DELETE FROM admin_mfa_enrollment_challenges WHERE admin_id = %s", (admin_id,))
            counters["deleted_challenges"] = cur.rowcount

            cur.execute("DELETE FROM admin_mfa_factors WHERE admin_id = %s", (admin_id,))
            counters["deleted_factors"] = cur.rowcount

            cur.execute("DELETE FROM admin_user_role_bindings WHERE admin_id = %s", (admin_id,))
            counters["deleted_bindings"] = cur.rowcount

            cur.execute("DELETE FROM admin_users WHERE admin_id = %s", (admin_id,))
            counters["deleted_users"] = cur.rowcount
        conn.commit()
        return admin_id, counters


def reset_test_admin(
    *,
    dsn: str,
    email: str,
    password: str,
    display_name: str,
    role_key: str,
    require_mfa: bool,
    cleanup_only: bool,
) -> ResetSummary | None:
    store = PostgresAdminStore.from_dsn(dsn)
    _ensure_role_available(store, role_key)

    deleted_admin_id, counters = _delete_existing_admin_state(dsn, email)
    if cleanup_only:
        print(
            "cleanup complete:",
            {
                "email": email,
                "previousAdminId": deleted_admin_id,
                **counters,
            },
        )
        return None

    now = datetime.now(timezone.utc)
    admin = store.identity.create_user(
        AdminUser(
            admin_id=f"adm_{uuid4().hex[:16]}",
            email=email.strip().lower(),
            display_name=display_name.strip(),
            status=AdminUserStatus.ACTIVE,
            auth_source=AuthSource.BOOTSTRAP,
            password_hash=hash_password(password),
            require_mfa=require_mfa,
            created_at=now,
            updated_at=now,
        )
    )
    store.authorization.create_role_binding(
        AdminUserRoleBinding(
            binding_id=f"bind_{uuid4().hex[:16]}",
            admin_id=admin.admin_id,
            role_key=role_key,
            scope={},
            status=RoleBindingStatus.ACTIVE,
            granted_by="script.reset_mfa_enrollment_test_admin",
            grant_reason="repeatable MFA enrollment verification reset",
            starts_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    return ResetSummary(
        admin_id=admin.admin_id,
        email=admin.email,
        role_key=role_key,
        require_mfa=require_mfa,
        deleted_sessions=counters["deleted_sessions"],
        deleted_challenges=counters["deleted_challenges"],
        deleted_factors=counters["deleted_factors"],
        deleted_bindings=counters["deleted_bindings"],
        deleted_users=counters["deleted_users"],
    )


def main() -> None:
    args = parse_args()
    _ensure_safe_target_email(args.email, args.unsafe_allow_non_test_email)
    summary = reset_test_admin(
        dsn=args.dsn,
        email=args.email,
        password=args.password,
        display_name=args.display_name,
        role_key=args.role_key,
        require_mfa=args.require_mfa,
        cleanup_only=args.cleanup_only,
    )
    if summary is None:
        return
    print(
        "test admin reset complete:",
        {
            "adminId": summary.admin_id,
            "email": summary.email,
            "roleKey": summary.role_key,
            "requireMfa": summary.require_mfa,
            "deletedSessions": summary.deleted_sessions,
            "deletedChallenges": summary.deleted_challenges,
            "deletedFactors": summary.deleted_factors,
            "deletedBindings": summary.deleted_bindings,
            "deletedUsers": summary.deleted_users,
        },
    )
    print("next: login with email/password only and expect 428 MFA_ENROLLMENT_REQUIRED")


if __name__ == "__main__":
    main()