from typing import Any, Dict, List, Tuple

from src.storage.base import BaseStorage


class CredentialRepository:
    """Persistence adapter for buyer/seller credential and audit collections."""

    def __init__(self, storage: BaseStorage):
        self._storage = storage

    def load_collection(self, collection_name: str) -> Any:
        if collection_name in {"buyer_credentials", "credentials", "agent_credentials"}:
            return {"credentials": getattr(self._storage, "read_credential_rows")("buyer"), "updatedAt": 0}
        if collection_name in {"seller_secrets", "provider_secrets"}:
            return {"credentials": getattr(self._storage, "read_credential_rows")("seller"), "updatedAt": 0}
        return {}

    def save_collection(self, collection_name: str, payload: Any) -> None:
        rows: List[Dict[str, Any]] = []
        if isinstance(payload, dict) and isinstance(payload.get("credentials"), list):
            rows = [row for row in payload["credentials"] if isinstance(row, dict)]
        elif isinstance(payload, list):
            rows = [row for row in payload if isinstance(row, dict)]

        if collection_name in {"buyer_credentials", "credentials", "agent_credentials"}:
            getattr(self._storage, "write_credential_rows")("buyer", rows)
        elif collection_name in {"seller_secrets", "provider_secrets"}:
            getattr(self._storage, "write_credential_rows")("seller", rows)

    def append_audit_log(self, row: Dict[str, Any]) -> None:
        getattr(self._storage, "append_audit_row")(row)

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
