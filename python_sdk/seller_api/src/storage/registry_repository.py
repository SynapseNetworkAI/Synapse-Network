from typing import Any, Dict, List

from src.storage.base import BaseStorage


class RegistryRepository:
    """Persistence adapter for service registry and health tables."""

    def __init__(self, storage: BaseStorage):
        self._storage = storage

    def load_service_registry(self) -> List[Dict[str, Any]]:
        rows = getattr(self._storage, "read_service_registry_rows")()
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def save_service_registry(self, rows: List[Dict[str, Any]]) -> None:
        getattr(self._storage, "write_service_registry_rows")(rows)

    def load_target_health_rows(self) -> List[Dict[str, Any]]:
        rows = getattr(self._storage, "read_service_target_health_rows")()
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def save_target_health_rows(self, rows: List[Dict[str, Any]]) -> None:
        getattr(self._storage, "write_service_target_health_rows")(rows)

    def load_target_health_history_rows(self) -> List[Dict[str, Any]]:
        rows = getattr(self._storage, "read_service_target_health_history_rows")()
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def save_target_health_history_rows(self, rows: List[Dict[str, Any]]) -> None:
        getattr(self._storage, "write_service_target_health_history_rows")(rows)
