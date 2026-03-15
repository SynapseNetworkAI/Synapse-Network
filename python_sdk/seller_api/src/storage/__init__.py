from fastapi import Request
from .base import BaseStorage
from .postgres_impl import PostgresStorage
from .repository_provider import (
    AuditDomain,
    FinanceDomain,
    SynapseDataManager,
    SynapseUnitOfWork,
    SystemDomain,
)


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
    "SynapseDataManager",
    "SynapseUnitOfWork",
    "FinanceDomain",
    "SystemDomain",
    "AuditDomain",
    "create_storage",
    "get_storage",
]
