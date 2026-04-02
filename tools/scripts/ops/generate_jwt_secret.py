#!/usr/bin/env python3
"""Generate secure .env-style secrets for JWT/Auth usage.

Examples:
  python scripts/generate_jwt_secret.py
  python scripts/generate_jwt_secret.py --length 48
  python scripts/generate_jwt_secret.py --name AUTH_SECRET
"""

from __future__ import annotations

import argparse
import secrets
import string


def build_secret(length: int) -> str:
    alphabet = string.ascii_letters + string.digits + "-_"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a random secret for .env files.")
    parser.add_argument("--length", type=int, default=32, help="Secret length, minimum 32.")
    parser.add_argument("--name", default="JWT_SECRET", help="Environment variable name.")
    args = parser.parse_args()

    length = max(32, int(args.length or 32))
    name = str(args.name or "JWT_SECRET").strip() or "JWT_SECRET"

    print(f"{name}={build_secret(length)}")


if __name__ == "__main__":
    main()
