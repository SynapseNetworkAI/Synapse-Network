from typing import Any, Dict, List

from src.storage.base import BaseStorage


class RegistryRepository:
    """Persistence adapter for service registry and health tables."""

    def __init__(self, storage: BaseStorage):
        self._storage = storage

    def load_service_registry(self) -> List[Dict[str, Any]]:
        rows = self._storage.get_collection("service_registry") or []
        if not isinstance(rows, list):
            return []
        return [row for row in rows if isinstance(row, dict)]

    def save_service_registry(self, rows: List[Dict[str, Any]]) -> None:
        self._storage.save_collection("service_registry", rows)

    def load_target_health_rows(self) -> List[Dict[str, Any]]:
        rows = self._storage.get_collection("service_target_health") or []
        if not isinstance(rows, list):
            return []
        return [row for row in rows if isinstance(row, dict)]

    def save_target_health_rows(self, rows: List[Dict[str, Any]]) -> None:
        self._storage.save_collection("service_target_health", rows)

    def load_target_health_history_rows(self) -> List[Dict[str, Any]]:
        rows = self._storage.get_collection("service_target_health_history") or []
        if not isinstance(rows, list):
            return []
        return [row for row in rows if isinstance(row, dict)]

    def save_target_health_history_rows(self, rows: List[Dict[str, Any]]) -> None:
        self._storage.save_collection("service_target_health_history", rows)
