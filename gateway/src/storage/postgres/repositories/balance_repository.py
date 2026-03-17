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

    @staticmethod
    def _owner_id(wallet: str) -> str:
        return f"owner:{str(wallet or '').lower()}"

    @staticmethod
    def _seller_id(wallet: str) -> str:
        return f"seller:{str(wallet or '').lower()}"

    @staticmethod
    def _account_identity(owner: str, account_type: str) -> tuple[str, str]:
        normalized_owner = str(owner or "").lower()
        normalized_type = str(account_type or "").lower()
        if normalized_type == "buyer":
            return f"owner_vault::{normalized_owner}", "owner_vault"
        if normalized_type == "seller":
            return f"seller_receivable::{normalized_owner}", "seller_receivable"
        return "platform_revenue::main", "platform_revenue"

    def _ensure_owner_account(self, cur: Any, wallet: str, updated_at: str) -> str:
        normalized_wallet = str(wallet or "").lower()
        owner_id = self._owner_id(normalized_wallet)
        cur.execute(
            """
            INSERT INTO synapse_owner_accounts (
                owner_id, owner_wallet, status, default_currency, created_at, updated_at
            ) VALUES (%s, %s, 'active', 'USDC', %s, %s)
            ON CONFLICT (owner_id)
            DO UPDATE SET owner_wallet = EXCLUDED.owner_wallet, updated_at = EXCLUDED.updated_at
            """,
            (owner_id, normalized_wallet, updated_at, updated_at),
        )
        return owner_id

    def _ensure_seller_profile(self, cur: Any, wallet: str, updated_at: str) -> str:
        normalized_wallet = str(wallet or "").lower()
        self._ensure_owner_account(cur, normalized_wallet, updated_at)
        seller_id = self._seller_id(normalized_wallet)
        cur.execute(
            """
            INSERT INTO synapse_seller_profiles (
                seller_id, owner_wallet, display_name, status, created_at, updated_at
            ) VALUES (%s, %s, %s, 'active', %s, %s)
            ON CONFLICT (seller_id)
            DO UPDATE SET owner_wallet = EXCLUDED.owner_wallet, updated_at = EXCLUDED.updated_at
            """,
            (seller_id, normalized_wallet, normalized_wallet, updated_at, updated_at),
        )
        return seller_id

    def _ensure_ledger_account(
        self, cur: Any, owner: str, account_type: str, updated_at: str
    ) -> str:
        account_id, account_kind = self._account_identity(owner, account_type)
        if account_kind == "owner_vault":
            owner_id = self._ensure_owner_account(cur, owner, updated_at)
            cur.execute(
                """
                INSERT INTO synapse_ledger_accounts (
                    account_id, account_kind, owner_id, seller_id, currency, status, created_at, updated_at
                ) VALUES (%s, %s, %s, NULL, 'USDC', 'active', %s, %s)
                ON CONFLICT (account_id)
                DO UPDATE SET owner_id = EXCLUDED.owner_id, updated_at = EXCLUDED.updated_at
                """,
                (account_id, account_kind, owner_id, updated_at, updated_at),
            )
            return account_id
        if account_kind == "seller_receivable":
            seller_id = self._ensure_seller_profile(cur, owner, updated_at)
            cur.execute(
                """
                INSERT INTO synapse_ledger_accounts (
                    account_id, account_kind, owner_id, seller_id, currency, status, created_at, updated_at
                ) VALUES (%s, %s, NULL, %s, 'USDC', 'active', %s, %s)
                ON CONFLICT (account_id)
                DO UPDATE SET seller_id = EXCLUDED.seller_id, updated_at = EXCLUDED.updated_at
                """,
                (account_id, account_kind, seller_id, updated_at, updated_at),
            )
            return account_id
        cur.execute(
            """
            INSERT INTO synapse_ledger_accounts (
                account_id, account_kind, owner_id, seller_id, currency, status, created_at, updated_at
            ) VALUES (%s, %s, NULL, NULL, 'USDC', 'active', %s, %s)
            ON CONFLICT (account_id)
            DO UPDATE SET updated_at = EXCLUDED.updated_at
            """,
            (account_id, account_kind, updated_at, updated_at),
        )
        return account_id

    def _upsert_balance_row(
        self,
        cur: Any,
        owner: str,
        account_type: str,
        available_balance: Any,
        pending_balance: Any,
        frozen_balance: Any,
        updated_at: str,
    ) -> None:
        account_id = self._ensure_ledger_account(cur, owner, account_type, updated_at)
        cur.execute(
            self._balance_upsert_sql,
            (
                account_id,
                str(self._q6(available_balance or 0)),
                str(self._q6(pending_balance or 0)),
                str(self._q6(frozen_balance or 0)),
                updated_at,
            ),
        )

    def read_balance_ledger(self) -> BalanceLedger:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT
                    CASE
                        WHEN la.account_kind = 'owner_vault' THEN oa.owner_wallet
                        WHEN la.account_kind = 'seller_receivable' THEN sp.owner_wallet
                        ELSE '__platform__'
                    END AS owner_address,
                    la.account_kind,
                    ab.available_balance,
                    ab.pending_balance,
                    ab.frozen_balance,
                    ab.updated_at
                FROM synapse_account_balances AS ab
                INNER JOIN synapse_ledger_accounts AS la ON la.account_id = ab.account_id
                LEFT JOIN synapse_owner_accounts AS oa ON oa.owner_id = la.owner_id
                LEFT JOIN synapse_seller_profiles AS sp ON sp.seller_id = la.seller_id
                WHERE la.account_kind IN ('owner_vault', 'seller_receivable', 'platform_revenue')
                """
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
            if account_type == "owner_vault":
                ledger.buyers[str(owner)] = available_val
                ledger.buyers_locked[str(owner)] = pending_val
                ledger.buyers_frozen[str(owner)] = frozen_val
            elif account_type == "seller_receivable":
                ledger.sellers[str(owner)] = available_val
                ledger.sellers_locked[str(owner)] = pending_val
                ledger.sellers_frozen[str(owner)] = frozen_val
            elif account_type == "platform_revenue" and str(owner) == "__platform__":
                ledger.platform.fee_accrued = available_val
        ledger.updated_at = max_updated
        return ledger

    def write_balance_ledger(self, ledger: BalanceLedger) -> None:
        updated_at = (
            to_dt_str(ledger.updated_at or now_dt_str(), now_dt_str()) or now_dt_str()
        )

        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_account_balances AS ab
                SET available_balance = 0,
                    pending_balance = 0,
                    frozen_balance = 0,
                    updated_at = %s
                FROM synapse_ledger_accounts AS la
                WHERE la.account_id = ab.account_id
                  AND la.account_kind IN ('owner_vault', 'seller_receivable', 'platform_revenue')
                """,
                (updated_at,),
            )
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

            self._upsert_balance_row(
                cur,
                "__platform__",
                "platform_fee",
                ledger.platform.fee_accrued,
                0,
                0,
                updated_at,
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
            self._upsert_balance_row(
                cur,
                owner,
                account_type,
                available_map.get(owner),
                pending_map.get(owner),
                frozen_map.get(owner),
                updated_at,
            )
