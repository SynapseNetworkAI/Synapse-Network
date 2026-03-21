#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys

from psycopg.errors import InsufficientPrivilege
from psycopg.conninfo import conninfo_to_dict

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.core.db_migrations import apply_sql_file, grant_admin_schema_access


def _default_sql_file() -> Path:
    return Path(__file__).resolve().parents[3] / "docker-compose" / "postgres" / "init" / "003_gateway_admin_projection_views.sql"


def _env_or_dsn_user(env_key: str, dsn: str) -> str:
    env_value = os.environ.get(env_key, "").strip()
    if env_value:
        return env_value
    if not dsn:
        return ""
    return str(conninfo_to_dict(dsn).get("user", "")).strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply gateway-admin PostgreSQL migrations.")
    parser.add_argument(
        "--dsn",
        default=os.environ.get("ADMIN_DATABASE_MIGRATION_DSN") or os.environ.get("ADMIN_DATABASE_DSN", "postgresql://synapse_admin_app:12345678@localhost:5432/synapse_gateway_admin"),
        help="Admin database migration DSN. Defaults to ADMIN_DATABASE_MIGRATION_DSN, then ADMIN_DATABASE_DSN.",
    )
    parser.add_argument(
        "--sql-file",
        default=str(_default_sql_file()),
        help="Bootstrap SQL file that contains the gateway-admin schema and seed section.",
    )
    parser.add_argument(
        "--app-user",
        default="synapse_admin_app",
        help="Admin app database user that should receive table and sequence grants after migrations.",
    )
    parser.add_argument(
        "--readonly-user",
        default=os.environ.get("ADMIN_DATABASE_READONLY_USER", ""),
        help="Optional readonly database user that should receive SELECT grants after migrations.",
    )
    args = parser.parse_args()

    if not args.dsn:
        raise SystemExit("Set ADMIN_DATABASE_MIGRATION_DSN or ADMIN_DATABASE_DSN before applying gateway-admin migrations.")

    try:
        applied = apply_sql_file(args.dsn, Path(args.sql_file))
        app_user = args.app_user.strip() or _env_or_dsn_user("ADMIN_DATABASE_APP_USER", os.environ.get("ADMIN_DATABASE_DSN", ""))
        if app_user:
            grant_admin_schema_access(args.dsn, app_user, readonly_user=args.readonly_user.strip() or None)
    except InsufficientPrivilege as exc:
        raise SystemExit(
            "Migration DSN lacks CREATE privileges on the admin schema. "
            "Set ADMIN_DATABASE_MIGRATION_DSN to a schema-owner or superuser DSN and rerun."
        ) from exc

    print(f"Applied gateway-admin bootstrap SQL: {applied}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())