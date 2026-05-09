from __future__ import annotations

from decimal import Decimal
from typing import Any


class BalanceConsumerWithdrawMixin:
    def consume_consumer_pending_for_withdrawal_and_accrue_platform_fee(
        self,
        owner: str,
        amount_usdc: Decimal | str | int,
        fee_usdc: Decimal | str | int,
        updated_at: str,
    ) -> None:
        consumer_account_id, _ = self._account_identity(owner, "consumer")  # type: ignore[attr-defined]  # repository mixin
        platform_account_id = self._ensure_platform_fee_balance_row(updated_at)
        amount = str(self._q6(amount_usdc))  # type: ignore[attr-defined]  # repository mixin
        fee = str(self._q6(fee_usdc))  # type: ignore[attr-defined]  # repository mixin
        with self._db.tx_cursor() as cur:  # type: ignore[attr-defined]  # repository mixin
            cur.execute(
                """
                UPDATE synapse_account_balances
                SET pending_balance = pending_balance - %s,
                    updated_at      = %s
                WHERE account_id = %s
                  AND pending_balance >= %s
                """,
                (amount, updated_at, consumer_account_id, amount),
            )
            if cur.rowcount != 1:
                raise RuntimeError("CONSUME_PENDING_BALANCE_INCONSISTENT")
            cur.execute(
                """
                UPDATE synapse_account_balances
                SET available_balance = available_balance + %s,
                    updated_at        = %s
                WHERE account_id = %s
                """,
                (fee, updated_at, platform_account_id),
            )
            if cur.rowcount != 1:
                raise RuntimeError("PLATFORM_FEE_ACCRUAL_INCONSISTENT")

    def _ensure_platform_fee_balance_row(self, updated_at: str) -> str:
        platform_account_id, _ = self._account_identity(  # type: ignore[attr-defined]  # repository mixin
            "__platform__",
            "platform_fee",
        )
        with self._db.tx_cursor() as cur:  # type: ignore[attr-defined]  # repository mixin
            self._ensure_ledger_account(  # type: ignore[attr-defined]  # repository mixin
                cur,
                "__platform__",
                "platform_fee",
                updated_at,
            )
            self._insert_zero_balance_if_missing(cur, platform_account_id, updated_at)
        return platform_account_id

    @staticmethod
    def _insert_zero_balance_if_missing(cur: Any, account_id: str, updated_at: str) -> None:
        cur.execute(
            """
            INSERT INTO synapse_account_balances (
                account_id, available_balance, pending_balance, frozen_balance, updated_at
            ) VALUES (%s, 0, 0, 0, %s)
            ON CONFLICT (account_id) DO NOTHING
            """,
            (account_id, updated_at),
        )
