from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.core.security import hash_password
from src.storage import PostgresAdminStore


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Set the initial password for a bootstrap admin user.")
    parser.add_argument("--dsn", required=True, help="PostgreSQL DSN for the gateway-admin database")
    parser.add_argument("--email", required=True, help="Bootstrap admin email")
    parser.add_argument("--password", required=True, help="Plaintext initial password")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    store = PostgresAdminStore.from_dsn(args.dsn)
    user = store.identity.get_user_by_email(args.email)
    if user is None:
        raise SystemExit(f"admin user not found: {args.email}")
    store.identity.update_password_hash(user.admin_id, hash_password(args.password))
    print(f"bootstrap password initialized for {user.email} ({user.admin_id})")


if __name__ == "__main__":
    main()