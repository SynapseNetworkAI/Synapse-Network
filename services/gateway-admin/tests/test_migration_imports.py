from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _migration_env() -> dict[str, str]:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(ROOT)
    env["ENVIRONMENT"] = "staging"
    for key in (
        "ADMIN_GATEWAY_DEBUG",
        "ADMIN_SESSION_COOKIE_SECURE",
        "ADMIN_CSRF_SECRET",
        "GATEWAY_INTERNAL_JWT_SECRET",
        "ADMIN_TOTP_SECRET_ENCRYPTION_KEY",
    ):
        env.pop(key, None)
    return env


def test_db_migrations_import_does_not_construct_app_settings() -> None:
    result = subprocess.run(
        [sys.executable, "-c", "import src.core.db_migrations"],
        cwd=ROOT,
        env=_migration_env(),
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr


def test_apply_migrations_help_does_not_construct_app_settings() -> None:
    result = subprocess.run(
        [sys.executable, "scripts/apply_migrations.py", "--help"],
        cwd=ROOT,
        env=_migration_env(),
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "Apply gateway-admin PostgreSQL migrations" in result.stdout
