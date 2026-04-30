# ruff: noqa: TRY003

from fastapi import Request
from .base import (
    AuditDomain,
    BaseStorage,
    FinanceDomain,
    SynapseDataManager,
    SynapseUnitOfWork,
    SystemDomain,
)
from .postgres_impl import PostgresStorage
from .postgres.database_manager import normalize_pool_max


def create_storage(settings: object) -> BaseStorage:
    backend = (
        str(getattr(settings, "storage_backend", "postgres") or "postgres")
        .strip()
        .lower()
    )
    if backend != "postgres":
        raise RuntimeError("Only STORAGE_BACKEND=postgres is supported.")
    dsn = str(getattr(settings, "postgres_dsn", "") or "").strip()
    ensure_schema = bool(getattr(settings, "postgres_auto_init", True))
    connect_timeout_sec = int(getattr(settings, "postgres_connect_timeout_sec", 5) or 5)
    raw_pool_max = getattr(settings, "postgres_pool_max", 5)
    pool_max = normalize_pool_max(5 if raw_pool_max in (None, "") else raw_pool_max)
    return PostgresStorage(
        dsn=dsn,
        ensure_schema=ensure_schema,
        connect_timeout_sec=connect_timeout_sec,
        pool_max=pool_max,
        pool_timeout_sec=float(getattr(settings, "postgres_pool_timeout_sec", 5.0) or 5.0),
        pool_max_lifetime_sec=float(
            getattr(settings, "postgres_pool_max_lifetime_sec", 1800.0) or 1800.0
        ),
        pool_max_idle_sec=float(
            getattr(settings, "postgres_pool_max_idle_sec", 300.0) or 300.0
        ),
    )


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
