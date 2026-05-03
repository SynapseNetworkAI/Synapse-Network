from pathlib import Path

import pytest

from src.core.config import Settings
from src.core.db_migrations import apply_sql_file, apply_sql_files, grant_admin_schema_access


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
    )

    assert settings.cors_origins() == ["https://admin.synapse.network"]


def test_environment_aliases_normalize_to_three_profiles() -> None:
    assert Settings(environment="development").environment == "local"
    assert Settings(environment="stage").environment == "staging"
    assert Settings(environment="production").environment == "prod"


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
