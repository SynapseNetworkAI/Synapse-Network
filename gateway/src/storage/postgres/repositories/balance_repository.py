from __future__ import annotations

from typing import Any, Callable, Dict

from src.domain.finance import BalanceLedger
from src.utils.datetime_utils import now_dt_str, to_dt_str

from ..database_manager import DatabaseManager


class BalanceRepository:
    def __init__(
        self,
        db: DatabaseManager,
        quantize6: Callable[[Any], Any],
        balance_upsert_sql: str,
    ):
        self._db = db
        self._q6 = quantize6
        self._balance_upsert_sql = balance_upsert_sql

    def read_balance_ledger(self) -> BalanceLedger:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                "SELECT owner_address, account_type, available_balance, pending_balance, frozen_balance, updated_at FROM synapse_balances"
            )
            rows = cur.fetchall()

        ledger = BalanceLedger()
        max_updated = ""
        for (
            owner,
            account_type,
            available_balance,
            pending_balance,
            frozen_balance,
            updated_at,
        ) in rows:
            updated = to_dt_str(updated_at, "") or ""
            if updated > max_updated:
                max_updated = updated
            available_val = float(self._q6(available_balance))
            pending_val = float(self._q6(pending_balance))
            frozen_val = float(self._q6(frozen_balance))
            if account_type == "buyer":
                ledger.buyers[str(owner)] = available_val
                ledger.buyers_locked[str(owner)] = pending_val
                ledger.buyers_frozen[str(owner)] = frozen_val
            elif account_type == "seller":
                ledger.sellers[str(owner)] = available_val
                ledger.sellers_locked[str(owner)] = pending_val
                ledger.sellers_frozen[str(owner)] = frozen_val
            elif account_type == "platform_fee" and str(owner) == "__platform__":
                ledger.platform.fee_accrued = available_val
        ledger.updated_at = max_updated
        return ledger

    def write_balance_ledger(self, ledger: BalanceLedger) -> None:
        updated_at = (
            to_dt_str(ledger.updated_at or now_dt_str(), now_dt_str()) or now_dt_str()
        )

        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_balances")
            self._upsert_account_rows(
                cur,
                "buyer",
                ledger.buyers,
                ledger.buyers_locked,
                ledger.buyers_frozen,
                updated_at,
            )
            self._upsert_account_rows(
                cur,
                "seller",
                ledger.sellers,
                ledger.sellers_locked,
                ledger.sellers_frozen,
                updated_at,
            )

            cur.execute(
                self._balance_upsert_sql,
                (
                    "__platform__",
                    "platform_fee",
                    str(self._q6(ledger.platform.fee_accrued)),
                    "0",
                    "0",
                    updated_at,
                ),
            )

    def _upsert_account_rows(
        self,
        cur: Any,
        account_type: str,
        available_map: Dict[str, Any],
        pending_map: Dict[str, Any],
        frozen_map: Dict[str, Any],
        updated_at: str,
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
