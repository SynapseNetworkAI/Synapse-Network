#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import sys
from uuid import uuid4

from psycopg.conninfo import conninfo_to_dict
from psycopg.types.json import Jsonb

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.core.security import hash_password
from src.storage.admin_identity.postgres import _connect

DEFAULT_LOCAL_DSN = "postgresql://synapse_admin_app:local-dev-admin-app-password@localhost:5432/synapse_gateway_admin"


def _local_dsn_guard(dsn: str) -> None:
    info = conninfo_to_dict(dsn)
    host = str(info.get("host") or "localhost").strip().lower()
    dbname = str(info.get("dbname") or "").strip().lower()
    if host not in {"localhost", "127.0.0.1", "::1"}:
        raise SystemExit(f"Refusing to run admin login lockout dogfood against non-local host: {host}")
    if "prod" in dbname or "production" in dbname:
        raise SystemExit(f"Refusing to run admin login lockout dogfood against prod-like database: {dbname}")


def _user_by_email(dsn: str, email: str) -> dict | None:
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM admin_users WHERE lower(email) = lower(%s)", (email,))
        return cur.fetchone()


def _create_user(args: argparse.Namespace) -> dict:
    now = datetime.now(timezone.utc)
    admin_id = f"adm_dogfood_{uuid4().hex[:12]}"
    binding_id = f"bind_dogfood_{uuid4().hex[:12]}"
    existing = _user_by_email(args.dsn, args.email)
    if existing is not None:
        _delete_user(args)
    with _connect(args.dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT role_key FROM admin_roles WHERE role_key = %s AND status = 'active'", (args.role_key,))
        if cur.fetchone() is None:
            raise SystemExit(f"Required admin role is missing or disabled: {args.role_key}")
        cur.execute(
            """
            INSERT INTO admin_users (
                admin_id, email, display_name, status, auth_source, password_hash,
                require_mfa, failed_login_attempts, last_failed_login_at,
                locked_until, created_at, updated_at
            )
            VALUES (%s, lower(%s), %s, 'active', 'bootstrap', %s, %s, 0, NULL, NULL, %s, %s)
            RETURNING admin_id, email, require_mfa
            """,
            (
                admin_id,
                args.email,
                args.display_name,
                hash_password(args.password),
                args.require_mfa,
                now,
                now,
            ),
        )
        user = cur.fetchone()
        cur.execute(
            """
            INSERT INTO admin_user_role_bindings (
                binding_id, admin_id, role_key, scope_json, status,
                granted_by, grant_reason, starts_at, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, 'active', 'dogfood', 'admin login lockout dogfood', %s, %s, %s)
            """,
            (binding_id, admin_id, args.role_key, Jsonb({}), now, now, now),
        )
    return {"adminId": user["admin_id"], "email": user["email"], "requireMfa": user["require_mfa"]}


def _assert_lockout(args: argparse.Namespace) -> dict:
    user = _user_by_email(args.dsn, args.email)
    if user is None:
        raise SystemExit(f"Dogfood admin not found for assertion: {args.email}")
    now = datetime.now(timezone.utc)
    if int(user["failed_login_attempts"] or 0) < args.min_attempts:
        raise SystemExit(f"Expected failed_login_attempts >= {args.min_attempts}, got {user['failed_login_attempts']}")
    if user["locked_until"] is None or user["locked_until"] <= now:
        raise SystemExit(f"Expected locked_until in the future, got {user['locked_until']}")
    with _connect(args.dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT action_type, COUNT(*)::int AS count
            FROM admin_action_audit
            WHERE operator_id = %s
              AND action_type IN ('admin.login.failure', 'admin.login.locked', 'admin.login.blocked_locked')
            GROUP BY action_type
            """,
            (user["admin_id"],),
        )
        counts = {row["action_type"]: row["count"] for row in cur.fetchall()}
    if counts.get("admin.login.failure", 0) < args.min_attempts:
        raise SystemExit(f"Expected at least {args.min_attempts} failure audits, got {counts.get('admin.login.failure', 0)}")
    if counts.get("admin.login.locked", 0) < 1:
        raise SystemExit("Expected admin.login.locked audit")
    if counts.get("admin.login.blocked_locked", 0) < 1:
        raise SystemExit("Expected admin.login.blocked_locked audit")
    return {
        "adminId": user["admin_id"],
        "email": user["email"],
        "failedLoginAttempts": user["failed_login_attempts"],
        "lockedUntil": user["locked_until"].isoformat().replace("+00:00", "Z"),
        "auditCounts": counts,
    }


def _delete_user(args: argparse.Namespace) -> dict:
    user = _user_by_email(args.dsn, args.email)
    if user is None:
        return {"deleted": False, "email": args.email}
    admin_id = user["admin_id"]
    with _connect(args.dsn) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM admin_sessions WHERE admin_id = %s", (admin_id,))
        sessions = cur.rowcount
        cur.execute("DELETE FROM admin_mfa_enrollment_challenges WHERE admin_id = %s", (admin_id,))
        challenges = cur.rowcount
        cur.execute("DELETE FROM admin_mfa_factors WHERE admin_id = %s", (admin_id,))
        factors = cur.rowcount
        cur.execute("DELETE FROM admin_user_role_bindings WHERE admin_id = %s", (admin_id,))
        bindings = cur.rowcount
        cur.execute("DELETE FROM admin_users WHERE admin_id = %s", (admin_id,))
        users = cur.rowcount
    return {
        "deleted": bool(users),
        "adminId": admin_id,
        "email": args.email,
        "deletedRows": {
            "admin_sessions": sessions,
            "admin_mfa_enrollment_challenges": challenges,
            "admin_mfa_factors": factors,
            "admin_user_role_bindings": bindings,
            "admin_users": users,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Manage local admin login lockout dogfood test users.")
    parser.add_argument("action", choices=("create", "assert-locked", "delete"))
    parser.add_argument("--dsn", default=os.environ.get("ADMIN_LOCKOUT_DOGFOOD_DSN") or os.environ.get("ADMIN_DATABASE_DSN", DEFAULT_LOCAL_DSN))
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", default="LockoutDogfood#2026!")
    parser.add_argument("--display-name", default="Admin Lockout Dogfood")
    parser.add_argument("--role-key", default="readonly_analyst")
    parser.add_argument("--require-mfa", action="store_true")
    parser.add_argument("--min-attempts", type=int, default=5)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    _local_dsn_guard(args.dsn)
    if args.action == "create":
        result = _create_user(args)
    elif args.action == "assert-locked":
        result = _assert_lockout(args)
    else:
        result = _delete_user(args)
    print(json.dumps({"status": "success", "action": args.action, **result}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
