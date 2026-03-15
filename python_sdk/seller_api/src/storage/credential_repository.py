from typing import Any, Dict, List, Tuple

from src.storage.base import BaseStorage


class CredentialRepository:
    """Persistence adapter for buyer/seller credential and audit collections."""

    def __init__(self, storage: BaseStorage):
        self._storage = storage

    def load_collection(self, collection_name: str) -> Any:
        return self._storage.get_collection(collection_name)

    def save_collection(self, collection_name: str, payload: Any) -> None:
        self._storage.save_collection(collection_name, payload)

    def append_audit_log(self, row: Dict[str, Any]) -> None:
        self._storage.append_to_collection("audit_log", row)

    def read_audit_rows(self, owner_wallet: str, limit: int) -> Tuple[bool, List[Dict[str, Any]]]:
        if not hasattr(self._storage, "read_audit_rows"):
            return False, []
        try:
            rows = getattr(self._storage, "read_audit_rows")(owner_wallet=owner_wallet, limit=limit)
        except Exception:
            return False, []
        if not isinstance(rows, list):
            return True, []
        return True, [row for row in rows if isinstance(row, dict)]

    def storage_directory(self) -> str:
        if not hasattr(self._storage, "directory"):
            return ""
        value = getattr(self._storage, "directory")
        return str(value or "")
