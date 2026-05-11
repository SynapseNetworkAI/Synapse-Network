from pathlib import Path

import pytest
from pydantic import ValidationError

from src.core.config import Settings
from src.core.db_migrations import apply_sql_file, apply_sql_files, grant_admin_schema_access
from src.core.totp_secret_migration import migrate_legacy_totp_payload_secrets


def test_cors_origins_include_common_local_ports_in_local_mode() -> None:
    settings = Settings(
        ADMIN_GATEWAY_ALLOWED_ORIGINS="http://localhost:3000",
        environment="local",
    )

    assert "http://localhost:3000" in settings.cors_origins()
    assert "http://localhost:3100" in settings.cors_origins()
    assert "http://localhost:3200" in settings.cors_origins()
    assert "http://127.0.0.1:3200" in settings.cors_origins()


def test_cors_origins_do_not_expand_in_prod() -> None:
    settings = Settings(
        ADMIN_GATEWAY_ALLOWED_ORIGINS="https://admin.synapse.network",
        environment="prod",
        ADMIN_GATEWAY_DEBUG="false",
        ADMIN_SESSION_COOKIE_SECURE="true",
        ADMIN_CSRF_SECRET="csrf-secret-for-prod-0123456789",
        GATEWAY_INTERNAL_JWT_SECRET="jwt-secret-for-prod-01234567890123456789",
        ADMIN_TOTP_SECRET_ENCRYPTION_KEY="ZmFrZS1mZXJuZXQta2V5LWZvci1wcm9kLTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=",
    )

    assert settings.cors_origins() == ["https://admin.synapse.network"]


def test_environment_aliases_normalize_to_three_profiles() -> None:
    assert Settings(environment="development").environment == "local"
    assert Settings(
        environment="stage",
        ADMIN_GATEWAY_DEBUG="false",
        ADMIN_SESSION_COOKIE_SECURE="true",
        ADMIN_CSRF_SECRET="csrf-secret-for-stage-0123456789",
        GATEWAY_INTERNAL_JWT_SECRET="jwt-secret-for-stage-01234567890123456789",
        ADMIN_TOTP_SECRET_ENCRYPTION_KEY="ZmFrZS1mZXJuZXQta2V5LWZvci1zdGFnZS0wMTIzNDU2Nzg5MDEyMzQ1Njc4OTA=",
    ).environment == "staging"
    assert Settings(
        environment="production",
        ADMIN_GATEWAY_DEBUG="false",
        ADMIN_SESSION_COOKIE_SECURE="true",
        ADMIN_CSRF_SECRET="csrf-secret-for-prod-0123456789",
        GATEWAY_INTERNAL_JWT_SECRET="jwt-secret-for-prod-01234567890123456789",
        ADMIN_TOTP_SECRET_ENCRYPTION_KEY="ZmFrZS1mZXJuZXQta2V5LWZvci1wcm9kLTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=",
    ).environment == "prod"


def test_staging_and_prod_fail_closed_on_insecure_defaults() -> None:
    with pytest.raises(ValidationError, match="ADMIN_GATEWAY_DEBUG must be false outside local"):
        Settings(environment="staging")

    settings = Settings(
        environment="prod",
        ADMIN_GATEWAY_DEBUG="false",
        ADMIN_SESSION_COOKIE_SECURE="true",
        ADMIN_CSRF_SECRET="csrf-secret-for-prod-0123456789",
        GATEWAY_INTERNAL_JWT_SECRET="jwt-secret-for-prod-01234567890123456789",
        ADMIN_TOTP_SECRET_ENCRYPTION_KEY="ZmFrZS1mZXJuZXQta2V5LWZvci1wcm9kLTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=",
    )
    assert settings.environment == "prod"


def test_apply_sql_files_executes_all_files_and_commits(tmp_path: Path) -> None:
    (tmp_path / "001_schema.sql").write_text(
        "\\if :{?synapse_admin_db}\nCREATE TABLE example(id INT);\n\\endif",
        encoding="utf-8",
    )
    (tmp_path / "002_seed.sql").write_text("INSERT INTO example VALUES (1);", encoding="utf-8")

    executed: list[str] = []

    class FakeCursor:
        def __enter__(self) -> "FakeCursor":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def execute(self, sql: str) -> None:
            executed.append(sql)

    class FakeConnection:
        def __init__(self) -> None:
            self.commit_called = False
            self.rollback_called = False
            self.close_called = False

        def cursor(self) -> FakeCursor:
            return FakeCursor()

        def commit(self) -> None:
            self.commit_called = True

        def rollback(self) -> None:
            self.rollback_called = True

        def close(self) -> None:
            self.close_called = True

    connection = FakeConnection()

    applied = apply_sql_files(
        "postgresql://example:secret@localhost:5432/synapse_gateway_admin",
        [tmp_path / "001_schema.sql", tmp_path / "002_seed.sql"],
        connect=lambda _: connection,
    )

    assert applied == ["001_schema.sql", "002_seed.sql"]
    assert executed == ["CREATE TABLE example(id INT);", "INSERT INTO example VALUES (1);"]
    assert connection.commit_called is True
    assert connection.rollback_called is False
    assert connection.close_called is True


def test_apply_sql_file_rolls_back_on_failure(tmp_path: Path) -> None:
    (tmp_path / "001_schema.sql").write_text("CREATE TABLE example(id INT);", encoding="utf-8")

    class FakeCursor:
        def __enter__(self) -> "FakeCursor":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def execute(self, sql: str) -> None:
            raise RuntimeError(f"broken sql: {sql}")

    class FakeConnection:
        def __init__(self) -> None:
            self.commit_called = False
            self.rollback_called = False
            self.close_called = False

        def cursor(self) -> FakeCursor:
            return FakeCursor()

        def commit(self) -> None:
            self.commit_called = True

        def rollback(self) -> None:
            self.rollback_called = True

        def close(self) -> None:
            self.close_called = True

    connection = FakeConnection()

    with pytest.raises(RuntimeError, match="broken sql"):
        apply_sql_file("postgresql://example", tmp_path / "001_schema.sql", connect=lambda _: connection)

    assert connection.commit_called is False
    assert connection.rollback_called is True
    assert connection.close_called is True


def test_apply_sql_file_skips_non_matching_conditional_block(tmp_path: Path) -> None:
    (tmp_path / "001_views.sql").write_text(
        "\\if :{?synapse_gateway_db}\nCREATE VIEW example AS SELECT 1;\n\\endif",
        encoding="utf-8",
    )

    executed: list[str] = []

    class FakeCursor:
        def __enter__(self) -> "FakeCursor":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def execute(self, sql: str) -> None:
            executed.append(sql)

    class FakeConnection:
        def __init__(self) -> None:
            self.commit_called = False
            self.rollback_called = False
            self.close_called = False

        def cursor(self) -> FakeCursor:
            return FakeCursor()

        def commit(self) -> None:
            self.commit_called = True

        def rollback(self) -> None:
            self.rollback_called = True

        def close(self) -> None:
            self.close_called = True

    connection = FakeConnection()

    applied = apply_sql_file(
        "postgresql://example:secret@localhost:5432/synapse_gateway_admin",
        tmp_path / "001_views.sql",
        connect=lambda _: connection,
    )

    assert applied == "001_views.sql"
    assert executed == []
    assert connection.commit_called is True
    assert connection.rollback_called is False
    assert connection.close_called is True


def test_grant_admin_schema_access_commits_for_app_and_readonly_users() -> None:
    executed: list[object] = []

    class FakeCursor:
        def __enter__(self) -> "FakeCursor":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def execute(self, sql: object) -> None:
            executed.append(sql)

    class FakeConnection:
        def __init__(self) -> None:
            self.commit_called = False
            self.rollback_called = False
            self.close_called = False

        def cursor(self) -> FakeCursor:
            return FakeCursor()

        def commit(self) -> None:
            self.commit_called = True

        def rollback(self) -> None:
            self.rollback_called = True

        def close(self) -> None:
            self.close_called = True

    connection = FakeConnection()

    grant_admin_schema_access(
        "postgresql://example",
        "synapse_admin_app",
        readonly_user="synapse_admin_ro",
        connect=lambda _: connection,
    )

    assert len(executed) == 6
    assert connection.commit_called is True
    assert connection.rollback_called is False
    assert connection.close_called is True


def test_migrate_legacy_totp_payload_secrets_encrypts_secret_refs() -> None:
    executed: list[tuple[object, object | None]] = []

    class FakeCursor:
        def __enter__(self) -> "FakeCursor":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def execute(self, sql: object, params: object | None = None) -> None:
            executed.append((sql, params))

        def fetchall(self) -> list[dict[str, object]]:
            return [
                {
                    "factor_id": "factor_legacy",
                    "payload_json": {"totpSecret": "JBSWY3DPEHPK3PXP"},
                },
                {
                    "factor_id": "factor_modern",
                    "payload_json": {"secretStorage": "secret_ref"},
                },
            ]

    class FakeConnection:
        def __init__(self) -> None:
            self.commit_called = False

        def __enter__(self) -> "FakeConnection":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def cursor(self) -> FakeCursor:
            return FakeCursor()

        def commit(self) -> None:
            self.commit_called = True

    connection = FakeConnection()

    summary = migrate_legacy_totp_payload_secrets(
        "postgresql://example",
        connect=lambda *args, **kwargs: connection,
    )

    assert summary.scanned == 2
    assert summary.migrated == 1
    update_calls = [call for call in executed if "UPDATE admin_mfa_factors" in str(call[0])]
    assert len(update_calls) == 1
    _, params = update_calls[0]
    assert params is not None
    assert str(params[0]).startswith("inline-fernet:v1:")
    assert params[1]


def test_migrate_legacy_totp_payload_secrets_accepts_migration_only_key(monkeypatch) -> None:
    from cryptography.fernet import Fernet

    for key in (
        "ADMIN_GATEWAY_DEBUG",
        "ADMIN_SESSION_COOKIE_SECURE",
        "ADMIN_CSRF_SECRET",
        "GATEWAY_INTERNAL_JWT_SECRET",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("ENVIRONMENT", "staging")
    monkeypatch.setenv("ADMIN_TOTP_SECRET_ENCRYPTION_KEY", Fernet.generate_key().decode("utf-8"))

    executed: list[tuple[object, object | None]] = []

    class FakeCursor:
        def __enter__(self) -> "FakeCursor":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def execute(self, sql: object, params: object | None = None) -> None:
            executed.append((sql, params))

        def fetchall(self) -> list[dict[str, object]]:
            return [{"factor_id": "factor_legacy", "payload_json": {"totpSecret": "JBSWY3DPEHPK3PXP"}}]

    class FakeConnection:
        def __enter__(self) -> "FakeConnection":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def cursor(self) -> FakeCursor:
            return FakeCursor()

        def commit(self) -> None:
            return None

    summary = migrate_legacy_totp_payload_secrets(
        "postgresql://example",
        connect=lambda *args, **kwargs: FakeConnection(),
    )

    assert summary.scanned == 1
    assert summary.migrated == 1
    assert any("UPDATE admin_mfa_factors" in str(sql) for sql, _ in executed)
