from __future__ import annotations

import time
from typing import Any, Callable, Dict

from ..database_manager import DatabaseManager


class BalanceRepository:
    def __init__(self, db: DatabaseManager, quantize6: Callable[[Any], Any], balance_upsert_sql: str):
        self._db = db
        self._q6 = quantize6
        self._balance_upsert_sql = balance_upsert_sql

    def read_balance_ledger(self) -> Dict[str, Any]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                "SELECT owner_address, account_type, available_balance, pending_balance, frozen_balance, updated_at FROM synapse_balances"
            )
            rows = cur.fetchall()

        ledger: Dict[str, Any] = {
            "buyers": {},
            "buyersLocked": {},
            "buyersFrozen": {},
            "sellers": {},
            "sellersLocked": {},
            "sellersFrozen": {},
            "platform": {"feeAccrued": 0.0},
            "updatedAt": 0,
        }
        max_updated = 0
        for owner, account_type, available_balance, pending_balance, frozen_balance, updated_at in rows:
            updated = int(updated_at or 0)
            if updated > max_updated:
                max_updated = updated
            available_val = float(self._q6(available_balance))
            pending_val = float(self._q6(pending_balance))
            frozen_val = float(self._q6(frozen_balance))
            if account_type == "buyer":
                ledger["buyers"][str(owner)] = available_val
                ledger["buyersLocked"][str(owner)] = pending_val
                ledger["buyersFrozen"][str(owner)] = frozen_val
            elif account_type == "seller":
                ledger["sellers"][str(owner)] = available_val
                ledger["sellersLocked"][str(owner)] = pending_val
                ledger["sellersFrozen"][str(owner)] = frozen_val
            elif account_type == "platform_fee" and str(owner) == "__platform__":
                ledger["platform"]["feeAccrued"] = available_val
        ledger["updatedAt"] = max_updated
        return ledger

    def write_balance_ledger(self, ledger: Dict[str, Any]) -> None:
        updated_at = int(ledger.get("updatedAt") or int(time.time()))
        buyers = ledger.get("buyers") if isinstance(ledger.get("buyers"), dict) else {}
        buyers_locked = ledger.get("buyersLocked") if isinstance(ledger.get("buyersLocked"), dict) else {}
        buyers_frozen = ledger.get("buyersFrozen") if isinstance(ledger.get("buyersFrozen"), dict) else {}
        sellers = ledger.get("sellers") if isinstance(ledger.get("sellers"), dict) else {}
        sellers_locked = ledger.get("sellersLocked") if isinstance(ledger.get("sellersLocked"), dict) else {}
        sellers_frozen = ledger.get("sellersFrozen") if isinstance(ledger.get("sellersFrozen"), dict) else {}
        platform = ledger.get("platform") if isinstance(ledger.get("platform"), dict) else {}

        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_balances")
            self._upsert_account_rows(cur, "buyer", buyers, buyers_locked, buyers_frozen, updated_at)
            self._upsert_account_rows(cur, "seller", sellers, sellers_locked, sellers_frozen, updated_at)

            cur.execute(
                self._balance_upsert_sql,
                ("__platform__", "platform_fee", str(self._q6(platform.get("feeAccrued") or 0)), "0", "0", updated_at),
            )

    def _upsert_account_rows(
        self,
        cur: Any,
        account_type: str,
        available_map: Dict[str, Any],
        pending_map: Dict[str, Any],
        frozen_map: Dict[str, Any],
        updated_at: int,
    ) -> None:
        owners = {str(owner).lower() for owner in available_map}
        owners |= {str(owner).lower() for owner in pending_map}
        owners |= {str(owner).lower() for owner in frozen_map}
        for owner in owners:
            cur.execute(
                self._balance_upsert_sql,
                (
                    owner,
                    account_type,
                    str(self._q6(available_map.get(owner) or 0)),
                    str(self._q6(pending_map.get(owner) or 0)),
                    str(self._q6(frozen_map.get(owner) or 0)),
                    updated_at,
                ),
            )
