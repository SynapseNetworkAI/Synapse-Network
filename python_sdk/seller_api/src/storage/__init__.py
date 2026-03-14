from fastapi import Request
from .base import BaseStorage
from .json_impl import JsonStorage
from .postgres_impl import PostgresStorage


def create_storage(settings: object) -> BaseStorage:
    backend = str(getattr(settings, "storage_backend", "json") or "json").strip().lower()
    if backend == "postgres":
        dsn = str(getattr(settings, "postgres_dsn", "") or "").strip()
        ensure_schema = bool(getattr(settings, "postgres_auto_init", True))
        return PostgresStorage(dsn=dsn, ensure_schema=ensure_schema)

    data_dir = str(getattr(settings, "data_dir", ".") or ".")
    return JsonStorage(directory=data_dir)

def get_storage(request: Request) -> BaseStorage:
    return request.app.state.storage


__all__ = ["BaseStorage", "JsonStorage", "PostgresStorage", "create_storage", "get_storage"]
