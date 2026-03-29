from __future__ import annotations

from pathlib import Path
from typing import Callable, Iterable, Protocol, cast

import psycopg
from psycopg.conninfo import conninfo_to_dict


class CursorLike(Protocol):
    def __enter__(self) -> "CursorLike": ...

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None: ...

    def execute(self, query: object) -> object: ...


class ConnectionLike(Protocol):
    def cursor(self) -> CursorLike: ...

    def commit(self) -> None: ...

    def rollback(self) -> None: ...

    def close(self) -> None: ...


ConnectFn = Callable[..., ConnectionLike]


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _connection_psql_variables(dsn: str) -> dict[str, str]:
    dbname = str(conninfo_to_dict(dsn).get("dbname", "")).strip()
    if not dbname:
        return {}
    variables: dict[str, str] = {}
    normalized_name = dbname.lower()
    if "admin" in normalized_name:
        variables["synapse_admin_db"] = dbname
    else:
        variables["synapse_gateway_db"] = dbname
    return variables


def _push_conditional(include_stack: list[bool], stripped_line: str, variables: dict[str, str]) -> bool:
    if not (stripped_line.startswith("\\if :{?") and stripped_line.endswith("}")):
        return False
    variable_name = stripped_line[len("\\if :{?") : -1]
    include_stack.append(include_stack[-1] and bool(variables.get(variable_name)))
    return True


def _flip_conditional(include_stack: list[bool], stripped_line: str) -> bool:
    if stripped_line != "\\else":
        return False
    if len(include_stack) == 1:
        raise ValueError("Encountered \\else without matching \\if in SQL bootstrap file.")
    parent_include = include_stack[-2]
    include_stack[-1] = parent_include and not include_stack[-1]
    return True


def _pop_conditional(include_stack: list[bool], stripped_line: str) -> bool:
    if stripped_line != "\\endif":
        return False
    if len(include_stack) == 1:
        raise ValueError("Encountered \\endif without matching \\if in SQL bootstrap file.")
    include_stack.pop()
    return True


def _render_psql_conditionals(sql: str, variables: dict[str, str]) -> str:
    rendered_lines: list[str] = []
    include_stack: list[bool] = [True]

    for line in sql.splitlines():
        stripped = line.strip()
        if _push_conditional(include_stack, stripped, variables):
            continue
        if _flip_conditional(include_stack, stripped):
            continue
        if _pop_conditional(include_stack, stripped):
            continue
        if include_stack[-1]:
            rendered_lines.append(line)

    if len(include_stack) != 1:
        raise ValueError("Unclosed \\if block in SQL bootstrap file.")

    return "\n".join(rendered_lines).strip()


def apply_sql_files(
    dsn: str,
    sql_files: Iterable[Path],
    *,
    connect: ConnectFn | None = None,
) -> list[str]:
    files = list(sql_files)
    if not files:
        return []

    connect_fn = connect or psycopg.connect
    psql_variables = _connection_psql_variables(dsn)
    connection = cast(ConnectionLike, connect_fn(dsn))
    try:
        for sql_file in files:
            sql = sql_file.read_text(encoding="utf-8").strip()
            if not sql:
                continue
            sql = _render_psql_conditionals(sql, psql_variables)
            if not sql:
                continue
            with connection.cursor() as cursor:
                cursor.execute(sql)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()

    return [path.name for path in files]


def apply_sql_file(
    dsn: str,
    sql_file: Path,
    *,
    connect: ConnectFn | None = None,
) -> str:
    applied = apply_sql_files(dsn, [sql_file], connect=connect)
    if not applied:
        return sql_file.name
    return applied[0]


def grant_admin_schema_access(
    dsn: str,
    app_user: str,
    *,
    readonly_user: str | None = None,
    connect: ConnectFn | None = None,
) -> None:
    connect_fn = connect or psycopg.connect
    connection = cast(ConnectionLike, connect_fn(dsn))
    try:
        with connection.cursor() as cursor:
            for username, table_privileges, sequence_privileges in (
                (app_user, "SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER", "USAGE, SELECT, UPDATE"),
                (readonly_user, "SELECT", "SELECT"),
            ):
                if not username:
                    continue
                quoted_user = _quote_identifier(username)
                cursor.execute(f"GRANT USAGE ON SCHEMA public TO {quoted_user}")
                cursor.execute(f"GRANT {table_privileges} ON ALL TABLES IN SCHEMA public TO {quoted_user}")
                cursor.execute(f"GRANT {sequence_privileges} ON ALL SEQUENCES IN SCHEMA public TO {quoted_user}")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()