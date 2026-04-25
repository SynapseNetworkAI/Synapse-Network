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


def _default_sql_files() -> list[Path]:
    candidates = [
        PROJECT_ROOT / "migrations",
        Path(__file__).resolve().parents[3] / "infra" / "postgres" / "init" / "gateway-admin",
        Path(__file__).resolve().parents[3] / "docker-compose" / "postgres" / "init",
    ]
    for init_dir in candidates:
        sql_files = sorted(init_dir.glob("[0-9][0-9][0-9]_*.sql"))
        if sql_files:
            return sql_files
    return []


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
        default=os.environ.get("ADMIN_DATABASE_MIGRATION_DSN") or os.environ.get("ADMIN_DATABASE_DSN", "postgresql://synapse_admin_app:local-dev-admin-app-password@localhost:5432/synapse_gateway_admin"),
        help="Admin database migration DSN. Defaults to ADMIN_DATABASE_MIGRATION_DSN, then ADMIN_DATABASE_DSN.",
    )
    parser.add_argument(
        "--sql-file",
        action="append",
        default=None,
        help="SQL file to apply. Repeat this flag to apply multiple files. Defaults to all docker-compose/postgres/init/*.sql files in order.",
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
        sql_files = [Path(path) for path in args.sql_file] if args.sql_file else _default_sql_files()
        applied_names: list[str] = []
        for sql_file in sql_files:
            applied_names.append(apply_sql_file(args.dsn, sql_file))
        app_user = args.app_user.strip() or _env_or_dsn_user("ADMIN_DATABASE_APP_USER", os.environ.get("ADMIN_DATABASE_DSN", ""))
        if app_user:
            grant_admin_schema_access(args.dsn, app_user, readonly_user=args.readonly_user.strip() or None)
    except InsufficientPrivilege as exc:
        raise SystemExit(
            "Migration DSN lacks CREATE privileges on the admin schema. "
            "Set ADMIN_DATABASE_MIGRATION_DSN to a schema-owner or superuser DSN and rerun."
        ) from exc

    print(f"Applied gateway-admin bootstrap SQL: {', '.join(applied_names)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
