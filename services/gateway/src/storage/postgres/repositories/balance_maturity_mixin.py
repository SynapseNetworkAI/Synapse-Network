"""Mature withdrawal balance read models."""
from __future__ import annotations

from decimal import Decimal


class BalanceMaturityMixin:
    """Read-only maturity and sliding-window queries for withdrawal gates."""

    def read_consumer_mature_withdrawable(
        self, owner: str, maturity_seconds: int
    ) -> Decimal:
        """Return consumer funds eligible for withdrawal under the aggregate FIFO rule."""
        normalized_owner = str(owner or "").lower()
        owner_id = self._owner_id(normalized_owner)  # type: ignore[attr-defined]  # reason: mixed into BalanceRepository
        consumer_account_id, _ = self._account_identity(  # type: ignore[attr-defined]  # reason: mixed into BalanceRepository
            normalized_owner, "consumer"
        )
        maturity = max(0, int(maturity_seconds))
        with self._db.readonly_cursor() as cur:  # type: ignore[attr-defined]  # reason: mixed into BalanceRepository
            cur.execute(
                """
                SELECT COALESCE(SUM(amount_usdc), 0)
                FROM synapse_vault_deposits
                WHERE owner_id = %s
                  AND status = 'CONFIRMED'
                  AND updated_at <= NOW() - (%s * INTERVAL '1 second')
                """,
                (owner_id, maturity),
            )
            matured_deposits = Decimal(str((cur.fetchone() or [0])[0] or 0))

            cur.execute(
                """
                SELECT COALESCE(SUM(amount_usdc), 0)
                FROM synapse_ledger_entries
                WHERE debit_account_id = %s
                  AND business_type = 'charge'
                  AND status = 'posted'
                """,
                (consumer_account_id,),
            )
            lifetime_spend = Decimal(str((cur.fetchone() or [0])[0] or 0))

            cur.execute(
                """
                SELECT COALESCE(SUM(amount_usdc), 0)
                FROM synapse_vault_withdrawals
                WHERE owner_id = %s
                  AND withdrawal_kind = 'consumer_refund'
                  AND status NOT IN ('FAILED', 'FAILED_EXPIRED', 'REJECTED', 'CANCELLED')
                """,
                (owner_id,),
            )
            withdrawn_or_locked = Decimal(str((cur.fetchone() or [0])[0] or 0))

        mature = self._q6(  # type: ignore[attr-defined]  # reason: mixed into BalanceRepository
            matured_deposits - lifetime_spend - withdrawn_or_locked
        )
        return Decimal("0.000000") if mature < Decimal("0") else Decimal(str(mature))

    def read_consumer_withdrawal_window_stats(
        self, owner: str, window_seconds: int
    ) -> tuple[int, Decimal]:
        """Return consumer withdrawal count and amount in a strict DB timestamp window."""
        owner_id = self._owner_id(str(owner or "").lower())  # type: ignore[attr-defined]  # reason: mixed into BalanceRepository
        window = max(1, int(window_seconds))
        with self._db.readonly_cursor() as cur:  # type: ignore[attr-defined]  # reason: mixed into BalanceRepository
            cur.execute(
                """
                SELECT COUNT(*), COALESCE(SUM(amount_usdc), 0)
                FROM synapse_vault_withdrawals
                WHERE owner_id = %s
                  AND withdrawal_kind = 'consumer_refund'
                  AND created_at >= NOW() - (%s * INTERVAL '1 second')
                  AND status NOT IN ('FAILED', 'FAILED_EXPIRED', 'REJECTED', 'CANCELLED')
                """,
                (owner_id, window),
            )
            row = cur.fetchone() or [0, 0]
        return int(row[0] or 0), Decimal(str(self._q6(row[1] or 0)))  # type: ignore[attr-defined]  # reason: mixed into BalanceRepository

    def read_provider_mature_withdrawable(
        self, owner: str, maturity_seconds: int
    ) -> Decimal:
        """Return provider receivable eligible for withdrawal after the T+N dispute window."""
        normalized_owner = str(owner or "").lower()
        owner_id = self._owner_id(normalized_owner)  # type: ignore[attr-defined]  # reason: mixed into BalanceRepository
        provider_account_id, _ = self._account_identity(  # type: ignore[attr-defined]  # reason: mixed into BalanceRepository
            normalized_owner, "provider"
        )
        maturity = max(0, int(maturity_seconds))
        with self._db.readonly_cursor() as cur:  # type: ignore[attr-defined]  # reason: mixed into BalanceRepository
            cur.execute(
                """
                SELECT COALESCE(SUM(amount_usdc), 0)
                FROM synapse_ledger_entries
                WHERE credit_account_id = %s
                  AND business_type = 'charge'
                  AND status = 'posted'
                  AND created_at <= NOW() - (%s * INTERVAL '1 second')
                """,
                (provider_account_id, maturity),
            )
            matured_income = Decimal(str((cur.fetchone() or [0])[0] or 0))

            cur.execute(
                """
                SELECT COALESCE(SUM(amount_usdc), 0)
                FROM synapse_vault_withdrawals
                WHERE owner_id = %s
                  AND withdrawal_kind = 'provider_withdrawal'
                  AND status NOT IN ('FAILED', 'FAILED_EXPIRED', 'REJECTED', 'CANCELLED')
                """,
                (owner_id,),
            )
            withdrawn_or_locked = Decimal(str((cur.fetchone() or [0])[0] or 0))

        mature = self._q6(matured_income - withdrawn_or_locked)  # type: ignore[attr-defined]  # reason: mixed into BalanceRepository
        return Decimal("0.000000") if mature < Decimal("0") else Decimal(str(mature))
