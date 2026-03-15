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
        rows = getattr(self._storage, "read_deposit_intents")()
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def save_deposit_intents(self, rows: List[Dict[str, Any]]) -> None:
        getattr(self._storage, "write_deposit_intents")(rows)

    def load_refund_intents(self) -> List[Dict[str, Any]]:
        rows = getattr(self._storage, "read_refund_intents")()
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def save_refund_intents(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        getattr(self._storage, "write_refund_intents")(rows, int(updated_at))

    def load_withdrawal_intents(self) -> List[Dict[str, Any]]:
        raw_rows = getattr(self._storage, "read_withdrawal_intents")()
        rows = [row for row in raw_rows if isinstance(row, dict)] if isinstance(raw_rows, list) else []
        for row in rows:
            status = str(row.get("status") or "").upper()
            if not status:
                row["status"] = "REQUESTED"
            elif status == "PENDING":
                row["status"] = "REQUESTED"
            else:
                row["status"] = status
        return rows

    def save_withdrawal_intents(self, rows: List[Dict[str, Any]]) -> None:
        getattr(self._storage, "write_withdrawal_intents")(rows, int(time.time()))

    def load_balance_ledger(self) -> Dict[str, Any]:
        ledger = getattr(self._storage, "read_balance_ledger")() or {}
        if not isinstance(ledger, dict):
            ledger = {}
        buyers = ledger.get("buyers") if isinstance(ledger.get("buyers"), dict) else {}
        buyers_locked = ledger.get("buyersLocked") if isinstance(ledger.get("buyersLocked"), dict) else {}
        buyers_frozen = ledger.get("buyersFrozen") if isinstance(ledger.get("buyersFrozen"), dict) else {}
        sellers = ledger.get("sellers") if isinstance(ledger.get("sellers"), dict) else {}
        sellers_locked = ledger.get("sellersLocked") if isinstance(ledger.get("sellersLocked"), dict) else {}
        sellers_frozen = ledger.get("sellersFrozen") if isinstance(ledger.get("sellersFrozen"), dict) else {}
        platform = ledger.get("platform") if isinstance(ledger.get("platform"), dict) else {}
        platform.setdefault("feeAccrued", 0.0)
        ledger["buyers"] = buyers
        ledger["buyersLocked"] = buyers_locked
        ledger["buyersFrozen"] = buyers_frozen
        ledger["sellers"] = sellers
        ledger["sellersLocked"] = sellers_locked
        ledger["sellersFrozen"] = sellers_frozen
        ledger["platform"] = platform
        ledger.setdefault("updatedAt", int(time.time()))
        return ledger

    def save_balance_ledger(self, ledger: Dict[str, Any]) -> None:
        next_ledger = dict(ledger)
        next_ledger["updatedAt"] = int(time.time())
        getattr(self._storage, "write_balance_ledger")(next_ledger)

    def load_router_config_rows(self) -> List[Dict[str, Any]]:
        rows = getattr(self._storage, "read_router_config_rows")()
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def save_router_config_rows(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        getattr(self._storage, "write_router_config_rows")(rows, int(updated_at))

    def load_usage_log_rows(self) -> List[Dict[str, Any]]:
        rows = getattr(self._storage, "read_usage_log_rows")()
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def save_usage_log_rows(self, rows: List[Dict[str, Any]]) -> None:
        getattr(self._storage, "write_usage_log_rows")(rows)

    def append_audit_log(self, row: Dict[str, Any]) -> None:
        getattr(self._storage, "append_audit_row")(row)

    def load_processed_deposit_event_keys(self) -> List[str]:
        keys = getattr(self._storage, "read_processed_deposit_event_keys")()
        return [str(item) for item in keys] if isinstance(keys, list) else []

    def save_processed_deposit_event_keys(self, keys: List[str], updated_at: int) -> None:
        getattr(self._storage, "write_processed_deposit_event_keys")(keys, int(updated_at))
