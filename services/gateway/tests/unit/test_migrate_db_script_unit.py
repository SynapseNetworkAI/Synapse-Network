import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
MIGRATE_SCRIPT = REPO_ROOT / "services/gateway/scripts/deploy/migrate_db.sh"


def _write_fake_tools(tmp_path: Path) -> tuple[Path, Path]:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    psql_calls = tmp_path / "psql-calls.txt"
    psql_sql = tmp_path / "psql-sql.txt"
    (fake_bin / "psql").write_text(
        """#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$1" >> "${FAKE_PSQL_CALLS}"
for arg in "$@"; do
  if [[ "$arg" == "-f" ]]; then
    exit 0
  fi
done
stdin="$(cat || true)"
printf '%s\\n--- psql call ---\\n' "$stdin" >> "${FAKE_PSQL_SQL}"
case "$stdin" in
  *"information_schema.tables"*) echo "40" ;;
  *"string_agg(required_table"*) echo "" ;;
  *"pg_class c"*) echo "0" ;;
  *"has_table_privilege"*"'SELECT')"*) echo "t" ;;
  *"has_table_privilege"*"'INSERT')"*) echo "t" ;;
esac
""",
        encoding="utf-8",
    )
    (fake_bin / "python3").write_text(
        """#!/usr/bin/env bash
set -euo pipefail
cat >/dev/null
echo "schema contract validation passed"
""",
        encoding="utf-8",
    )
    os.chmod(fake_bin / "psql", 0o755)
    os.chmod(fake_bin / "python3", 0o755)
    return fake_bin, psql_calls


def _run_migrate_with_fake_tools(
    tmp_path: Path, env: dict[str, str]
) -> tuple[list[str], str]:
    fake_bin, psql_calls = _write_fake_tools(tmp_path)
    psql_sql = tmp_path / "psql-sql.txt"
    run_env = {
        **os.environ,
        "PATH": f"{fake_bin}:{os.environ['PATH']}",
        "FAKE_PSQL_CALLS": str(psql_calls),
        "FAKE_PSQL_SQL": str(psql_sql),
        "GATEWAY_PYTHON": "python3",
        **env,
    }
    subprocess.run(
        ["bash", str(MIGRATE_SCRIPT), "staging"],
        cwd=REPO_ROOT,
        env=run_env,
        text=True,
        check=True,
        capture_output=True,
    )
    return (
        psql_calls.read_text(encoding="utf-8").splitlines(),
        psql_sql.read_text(encoding="utf-8"),
    )


def test_staging_migration_prefers_split_migrator_fields_over_runtime_dsn(
    tmp_path: Path,
) -> None:
    calls, _sql = _run_migrate_with_fake_tools(
        tmp_path,
        {
            "POSTGRES_DSN": "postgresql://runtime:runtime-pw@runtime-host/db",
            "POSTGRES_HOST": "/cloudsql/project:region:instance",
            "POSTGRES_DB": "synapse_gateway_staging",
            "POSTGRES_USER": "synapse_gateway_app",
            "POSTGRES_PASSWORD": "runtime-pw",
            "POSTGRES_MIGRATOR_USER": "synapse_gateway_migrator",
            "POSTGRES_MIGRATOR_PASSWORD": "migrator-pw",
        },
    )

    assert calls
    assert all("user=synapse_gateway_migrator" in call for call in calls)
    assert all("runtime:runtime-pw" not in call for call in calls)


def test_staging_migration_uses_runtime_dsn_only_as_last_resort(tmp_path: Path) -> None:
    runtime_dsn = "postgresql://runtime:runtime-pw@runtime-host/db"
    calls, _sql = _run_migrate_with_fake_tools(
        tmp_path,
        {
            "POSTGRES_DSN": runtime_dsn,
            "POSTGRES_USER": "synapse_gateway_app",
        },
    )

    assert calls
    assert all(call == runtime_dsn for call in calls)


def test_staging_migration_grants_analytics_outbox_to_readonly_user(
    tmp_path: Path,
) -> None:
    _calls, sql = _run_migrate_with_fake_tools(
        tmp_path,
        {
            "POSTGRES_DSN": "postgresql://runtime:runtime-pw@runtime-host/db",
            "POSTGRES_USER": "synapse_gateway_app",
            "POSTGRES_MIGRATOR_USER": "synapse_gateway_migrator",
            "GATEWAY_READONLY_DB_USER": "synapse_gateway_ro",
        },
    )

    assert "GRANT SELECT ON TABLE public.synapse_analytics_outbox" in sql
    assert "readonly_user" in sql
    assert (
        "has_table_privilege(:'readonly_user', 'public.synapse_analytics_outbox', 'SELECT')"
        in sql
    )
