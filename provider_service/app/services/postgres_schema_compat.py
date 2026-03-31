from __future__ import annotations

from typing import Any, cast


def fetch_table_columns(cursor, *, table_name: str) -> set[str]:
    cursor.execute(
        cast(
            Any,
            (
                "SELECT column_name "
                "FROM information_schema.columns "
                "WHERE table_schema = current_schema() AND table_name = %s"
            ),
        ),
        (table_name,),
    )
    rows = cursor.fetchall() or []
    return {str(row[0]) for row in rows}


def rename_column_if_needed(
    cursor,
    *,
    table_name: str,
    columns: set[str],
    old_name: str,
    new_name: str,
) -> set[str]:
    if old_name not in columns or new_name in columns:
        return columns
    cursor.execute(
        cast(
            Any,
            f"ALTER TABLE {table_name} RENAME COLUMN {old_name} TO {new_name}",
        )
    )
    next_columns = set(columns)
    next_columns.discard(old_name)
    next_columns.add(new_name)
    return next_columns


def add_column_if_missing(
    cursor,
    *,
    table_name: str,
    columns: set[str],
    column_name: str,
    definition_sql: str,
) -> set[str]:
    if column_name in columns:
        return columns
    cursor.execute(
        cast(
            Any,
            f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition_sql}",
        )
    )
    next_columns = set(columns)
    next_columns.add(column_name)
    return next_columns
