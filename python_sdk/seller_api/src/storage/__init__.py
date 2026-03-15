from fastapi import Request
from .base import BaseStorage
from .postgres_impl import PostgresStorage
from .finance_repository import FinanceRepository
from .registry_repository import RegistryRepository
from .credential_repository import CredentialRepository


def create_storage(settings: object) -> BaseStorage:
    backend = str(getattr(settings, "storage_backend", "postgres") or "postgres").strip().lower()
    if backend != "postgres":
        raise RuntimeError("Only STORAGE_BACKEND=postgres is supported.")
    dsn = str(getattr(settings, "postgres_dsn", "") or "").strip()
    ensure_schema = bool(getattr(settings, "postgres_auto_init", True))
    return PostgresStorage(dsn=dsn, ensure_schema=ensure_schema)

def get_storage(request: Request) -> BaseStorage:
    return request.app.state.storage


__all__ = [
    "BaseStorage",
    "PostgresStorage",
    "FinanceRepository",
    "RegistryRepository",
    "CredentialRepository",
    "create_storage",
    "get_storage",
]
