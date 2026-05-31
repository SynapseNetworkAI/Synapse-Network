import os
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
MIGRATE_SCRIPT = REPO_ROOT / "services/gateway/scripts/deploy/migrate_db.sh"


def _write_fake_tools(tmp_path: Path) -> tuple[Path, Path, Path]:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    psql_calls = tmp_path / "psql-calls.txt"
    psql_stdin = tmp_path / "psql-stdin.txt"
    (fake_bin / "psql").write_text(
        """#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${FAKE_PSQL_CALLS}"
for arg in "$@"; do
  if [[ "$arg" == "-f" ]]; then
    exit 0
  fi
done
stdin="$(cat || true)"
printf -- '---STDIN---\\n%s\\n' "$stdin" >> "${FAKE_PSQL_STDIN}"
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
    return fake_bin, psql_calls, psql_stdin


def _run_migrate_with_fake_tools(tmp_path: Path, env: dict[str, str]) -> tuple[list[str], str]:
    fake_bin, psql_calls, psql_stdin = _write_fake_tools(tmp_path)
    run_env = {
        **os.environ,
        "PATH": f"{fake_bin}:{os.environ['PATH']}",
        "FAKE_PSQL_CALLS": str(psql_calls),
        "FAKE_PSQL_STDIN": str(psql_stdin),
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
        psql_stdin.read_text(encoding="utf-8"),
    )


def test_staging_migration_prefers_split_migrator_fields_over_runtime_dsn(
    tmp_path: Path,
) -> None:
    calls, _stdin_log = _run_migrate_with_fake_tools(
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
    calls, _stdin_log = _run_migrate_with_fake_tools(
        tmp_path,
        {
            "POSTGRES_DSN": runtime_dsn,
            "POSTGRES_USER": "synapse_gateway_app",
        },
    )

    assert calls
    assert all(call.startswith(runtime_dsn) for call in calls)


def test_staging_migration_grants_projection_select_to_gateway_readonly_user(tmp_path: Path) -> None:
    calls, stdin_log = _run_migrate_with_fake_tools(
        tmp_path,
        {
            "POSTGRES_DSN": "postgresql://runtime:runtime-pw@runtime-host/db",
            "POSTGRES_HOST": "/cloudsql/project:region:instance",
            "POSTGRES_DB": "synapse_gateway_staging",
            "POSTGRES_USER": "synapse_gateway_app",
            "POSTGRES_PASSWORD": "runtime-pw",
            "POSTGRES_MIGRATOR_USER": "synapse_gateway_migrator",
            "POSTGRES_MIGRATOR_PASSWORD": "migrator-pw",
            "POSTGRES_READONLY_USER": "synapse_gateway_ro",
        },
    )

    projection_sql_calls = [call for call in calls if "gateway-admin/00" in call]
    assert any("003_gateway_admin_projection_views.sql" in call for call in projection_sql_calls)
    assert any("004_admin_funds_observability_projection_upgrade.sql" in call for call in projection_sql_calls)
    assert any("005_admin_task_monitoring_projection_upgrade.sql" in call for call in projection_sql_calls)
    assert "GRANT SELECT ON TABLE %I.%I TO %I" in stdin_log
    assert "readonly_user" in stdin_log
    assert "has_table_privilege(:'readonly_user', 'public.synapse_admin_dashboard_operations_projection', 'SELECT')" in stdin_log
