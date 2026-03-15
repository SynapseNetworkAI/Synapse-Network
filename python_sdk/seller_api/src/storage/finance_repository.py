from typing import Any, Dict, List
import time

from src.storage.base import BaseStorage


class FinanceRepository:
    """Persistence adapter for finance domain collections."""

    def __init__(self, storage: BaseStorage):
        self._storage = storage

    def _normalize_rows(self, raw: Any) -> List[Dict[str, Any]]:
        if isinstance(raw, list):
            return [item for item in raw if isinstance(item, dict)]
        if isinstance(raw, dict) and isinstance(raw.get("rows"), list):
            return [item for item in raw["rows"] if isinstance(item, dict)]
        return []

    def _normalize_intents(self, raw: Any) -> List[Dict[str, Any]]:
        if isinstance(raw, list):
            return [item for item in raw if isinstance(item, dict)]
        if isinstance(raw, dict) and isinstance(raw.get("intents"), list):
            return [item for item in raw["intents"] if isinstance(item, dict)]
        return []

    def load_deposit_intents(self) -> List[Dict[str, Any]]:
        return self._normalize_intents(self._storage.get_collection("deposit_intents"))

    def save_deposit_intents(self, rows: List[Dict[str, Any]]) -> None:
        self._storage.save_collection("deposit_intents", rows)

    def load_refund_intents(self) -> List[Dict[str, Any]]:
        return self._normalize_rows(self._storage.get_collection("refund_intents"))

    def save_refund_intents(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        self._storage.save_collection("refund_intents", {"rows": rows, "updatedAt": int(updated_at)})

    def load_withdrawal_intents(self) -> List[Dict[str, Any]]:
        rows = self._normalize_rows(self._storage.get_collection("provider_withdrawal_intents"))
        for row in rows:
            row.setdefault("status", "PENDING")
        return rows

    def save_withdrawal_intents(self, rows: List[Dict[str, Any]]) -> None:
        self._storage.save_collection("provider_withdrawal_intents", {"rows": rows, "updatedAt": int(time.time())})

    def load_balance_ledger(self) -> Dict[str, Any]:
        ledger = self._storage.get_collection("balance_ledger") or {}
        if not isinstance(ledger, dict):
            ledger = {}
        buyers = ledger.get("buyers") if isinstance(ledger.get("buyers"), dict) else {}
        buyers_locked = ledger.get("buyersLocked") if isinstance(ledger.get("buyersLocked"), dict) else {}
        sellers = ledger.get("sellers") if isinstance(ledger.get("sellers"), dict) else {}
        sellers_locked = ledger.get("sellersLocked") if isinstance(ledger.get("sellersLocked"), dict) else {}
        platform = ledger.get("platform") if isinstance(ledger.get("platform"), dict) else {}
        platform.setdefault("feeAccrued", 0.0)
        ledger["buyers"] = buyers
        ledger["buyersLocked"] = buyers_locked
        ledger["sellers"] = sellers
        ledger["sellersLocked"] = sellers_locked
        ledger["platform"] = platform
        ledger.setdefault("updatedAt", int(time.time()))
        return ledger

    def save_balance_ledger(self, ledger: Dict[str, Any]) -> None:
        next_ledger = dict(ledger)
        next_ledger["updatedAt"] = int(time.time())
        self._storage.save_collection("balance_ledger", next_ledger)

    def load_router_config_rows(self) -> List[Dict[str, Any]]:
        return self._normalize_rows(self._storage.get_collection("router_config"))

    def save_router_config_rows(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        self._storage.save_collection("router_config", {"rows": rows, "updatedAt": int(updated_at)})

    def load_usage_log_rows(self) -> List[Dict[str, Any]]:
        rows = self._storage.get_collection("usage_log") or []
        if not isinstance(rows, list):
            return []
        return [row for row in rows if isinstance(row, dict)]

    def save_usage_log_rows(self, rows: List[Dict[str, Any]]) -> None:
        self._storage.save_collection("usage_log", rows)

    def append_audit_log(self, row: Dict[str, Any]) -> None:
        self._storage.append_to_collection("audit_log", row)

    def load_processed_deposit_event_keys(self) -> List[str]:
        raw = self._storage.get_collection("deposit_event_processed")
        if isinstance(raw, dict) and isinstance(raw.get("keys"), list):
            return [str(item) for item in raw["keys"]]
        if isinstance(raw, list):
            return [str(item) for item in raw]
        return []

    def save_processed_deposit_event_keys(self, keys: List[str], updated_at: int) -> None:
        self._storage.save_collection("deposit_event_processed", {"keys": keys, "updatedAt": int(updated_at)})
