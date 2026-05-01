"""Service registry repository — thin composer class."""
from __future__ import annotations

from ..database_manager import DatabaseManager
from .service_registry_core_mixin import ServiceRegistryCoreMixin
from .service_registry_lifecycle_mixin import ServiceRegistryLifecycleMixin
from .service_registry_query_mixin import ServiceRegistryQueryMixin


class ServiceRegistryRepository(
    ServiceRegistryCoreMixin,
    ServiceRegistryLifecycleMixin,
    ServiceRegistryQueryMixin,
):
    """Postgres-backed service registry repository."""

    def __init__(self, db: DatabaseManager):
        self._db = db
