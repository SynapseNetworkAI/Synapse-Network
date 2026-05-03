from __future__ import annotations

from decimal import Decimal
from typing import Any, Callable

from src.domain.finance import BalanceLedger, ConsumerWalletRecord, ProviderWalletRecord
from src.utils.datetime_utils import now_dt_str, to_dt_str

from .balance_maturity_mixin import BalanceMaturityMixin
from ..database_manager import DatabaseManager


class BalanceRepository(BalanceMaturityMixin):
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
    def _provider_id(wallet: str) -> str:
        return f"provider:{str(wallet or '').lower()}"

    @staticmethod
    def _account_identity(owner: str, account_type: str) -> tuple[str, str]:
        normalized_owner = str(owner or "").lower()
        normalized_type = str(account_type or "").lower()
        if normalized_type == "consumer":
            return f"consumer_wallet::{normalized_owner}", "consumer_wallet"
        if normalized_type == "provider":
            return f"provider_wallet::{normalized_owner}", "provider_wallet"
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

    def _ensure_provider_profile(self, cur: Any, wallet: str, updated_at: str) -> str:
        normalized_wallet = str(wallet or "").lower()
        owner_id = self._ensure_owner_account(cur, normalized_wallet, updated_at)
        provider_id = self._provider_id(normalized_wallet)
        cur.execute(
            """
            INSERT INTO synapse_provider_profiles (
                provider_id, owner_id, display_name, status, created_at, updated_at
            ) VALUES (%s, %s, %s, 'active', %s, %s)
            ON CONFLICT (provider_id)
            DO UPDATE SET owner_id = EXCLUDED.owner_id, updated_at = EXCLUDED.updated_at
            """,
            (provider_id, owner_id, normalized_wallet, updated_at, updated_at),
        )
        return provider_id

    def _ensure_ledger_account(
        self, cur: Any, owner: str, account_type: str, updated_at: str
    ) -> str:
        account_id, account_kind = self._account_identity(owner, account_type)
        if account_kind == "consumer_wallet":
            owner_id = self._ensure_owner_account(cur, owner, updated_at)
            cur.execute(
                """
                INSERT INTO synapse_ledger_accounts (
                    account_id, account_kind, owner_id, provider_id, currency, status, created_at, updated_at
                ) VALUES (%s, %s, %s, NULL, 'USDC', 'active', %s, %s)
                ON CONFLICT (account_id)
                DO UPDATE SET owner_id = EXCLUDED.owner_id, updated_at = EXCLUDED.updated_at
                """,
                (account_id, account_kind, owner_id, updated_at, updated_at),
            )
            return account_id
        if account_kind == "provider_wallet":
            owner_id = self._ensure_owner_account(cur, owner, updated_at)
            provider_id = self._ensure_provider_profile(cur, owner, updated_at)
            cur.execute(
                """
                INSERT INTO synapse_ledger_accounts (
                    account_id, account_kind, owner_id, provider_id, currency, status, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, 'USDC', 'active', %s, %s)
                ON CONFLICT (account_id)
                DO UPDATE SET owner_id = EXCLUDED.owner_id, provider_id = EXCLUDED.provider_id, updated_at = EXCLUDED.updated_at
                """,
                (account_id, account_kind, owner_id, provider_id, updated_at, updated_at),
            )
            return account_id
        cur.execute(
            """
            INSERT INTO synapse_ledger_accounts (
                account_id, account_kind, owner_id, provider_id, currency, status, created_at, updated_at
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
                        WHEN la.account_kind IN ('consumer_wallet', 'provider_wallet') THEN oa.owner_wallet
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
                WHERE la.account_kind IN ('consumer_wallet', 'provider_wallet', 'platform_revenue')
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
            max_updated = max(max_updated, updated)
            available_val = Decimal(str(self._q6(available_balance)))
            pending_val = Decimal(str(self._q6(pending_balance)))
            frozen_val = Decimal(str(self._q6(frozen_balance)))
            if account_type == "consumer_wallet":
                ledger.consumer_wallets.append(
                    ConsumerWalletRecord(
                        ownerAddress=str(owner),
                        availableBalance=available_val,
                        pendingBalance=pending_val,
                        frozenBalance=frozen_val,
                        updatedAt=updated,
                    )
                )
            elif account_type == "provider_wallet":
                ledger.provider_wallets.append(
                    ProviderWalletRecord(
                        ownerAddress=str(owner),
                        availableBalance=available_val,
                        pendingBalance=pending_val,
                        frozenBalance=frozen_val,
                        updatedAt=updated,
                    )
                )
            elif account_type == "platform_revenue" and str(owner) == "__platform__":
                ledger.platform.fee_accrued = available_val
        ledger.updated_at = max_updated
        return ledger

    def reserve_consumer_balance_for_withdrawal(
        self, owner: str, amount_usdc: Decimal | str | int, updated_at: str
    ) -> None:
        """Atomically move *amount_usdc* from available → pending for a consumer withdrawal.

        Uses a direct SQL delta safe against concurrent writes.
        """
        account_id, _ = self._account_identity(owner, "consumer")
        with self._db.tx_cursor() as cur:
            # Ensure ledger account + balance row exist first
            self._ensure_ledger_account(cur, owner, "consumer", updated_at)
            cur.execute(
                """
                INSERT INTO synapse_account_balances (
                    account_id, available_balance, pending_balance, frozen_balance, updated_at
                )
                VALUES (%s, 0, 0, 0, %s)
                ON CONFLICT (account_id) DO NOTHING
                """,
                (account_id, updated_at),
            )
            cur.execute(
                """
                UPDATE synapse_account_balances
                SET available_balance = available_balance - %s,
                    pending_balance   = pending_balance   + %s,
                    updated_at        = %s
                WHERE account_id = %s
                  AND available_balance >= %s
                """,
                (
                    str(self._q6(amount_usdc)),
                    str(self._q6(amount_usdc)),
                    updated_at,
                    account_id,
                    str(self._q6(amount_usdc)),
                ),
            )
            if cur.rowcount != 1:
                raise RuntimeError("INSUFFICIENT_CONSUMER_BALANCE_ATOMIC")

    def reserve_consumer_balance_for_manual_review(
        self, owner: str, amount_usdc: Decimal | str | int, updated_at: str
    ) -> None:
        """Atomically move *amount_usdc* from available → frozen for manual review."""
        account_id, _ = self._account_identity(owner, "consumer")
        with self._db.tx_cursor() as cur:
            self._ensure_ledger_account(cur, owner, "consumer", updated_at)
            cur.execute(
                """
                INSERT INTO synapse_account_balances (
                    account_id, available_balance, pending_balance, frozen_balance, updated_at
                )
                VALUES (%s, 0, 0, 0, %s)
                ON CONFLICT (account_id) DO NOTHING
                """,
                (account_id, updated_at),
            )
            cur.execute(
                """
                UPDATE synapse_account_balances
                SET available_balance = available_balance - %s,
                    frozen_balance    = frozen_balance    + %s,
                    updated_at        = %s
                WHERE account_id = %s
                  AND available_balance >= %s
                """,
                (
                    str(self._q6(amount_usdc)),
                    str(self._q6(amount_usdc)),
                    updated_at,
                    account_id,
                    str(self._q6(amount_usdc)),
                ),
            )
            if cur.rowcount != 1:
                raise RuntimeError("INSUFFICIENT_CONSUMER_BALANCE_ATOMIC")

    def consume_consumer_pending_for_withdrawal(
        self, owner: str, amount_usdc: Decimal | str | int, updated_at: str
    ) -> None:
        """Atomically reduce *pending_balance* after a consumer withdrawal completes.

        Mirrors ``reserve_consumer_balance_for_withdrawal`` — uses a direct SQL
        delta so that ``write_balance_ledger`` (which only touches
        ``available_balance``) cannot silently discard the change.
        """
        account_id, _ = self._account_identity(owner, "consumer")
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_account_balances
                SET pending_balance = pending_balance - %s,
                    updated_at      = %s
                WHERE account_id = %s
                  AND pending_balance >= %s
                """,
                (
                    str(self._q6(amount_usdc)),
                    updated_at,
                    account_id,
                    str(self._q6(amount_usdc)),
                ),
            )
            if cur.rowcount != 1:
                raise RuntimeError("CONSUME_PENDING_BALANCE_INCONSISTENT")

    def move_consumer_frozen_to_pending(
        self, owner: str, amount_usdc: Decimal | str | int, updated_at: str
    ) -> None:
        """Atomically move *amount_usdc* from frozen → pending after manual approval."""
        account_id, _ = self._account_identity(owner, "consumer")
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_account_balances
                SET frozen_balance  = frozen_balance  - %s,
                    pending_balance = pending_balance + %s,
                    updated_at      = %s
                WHERE account_id = %s
                  AND frozen_balance >= %s
                """,
                (
                    str(self._q6(amount_usdc)),
                    str(self._q6(amount_usdc)),
                    updated_at,
                    account_id,
                    str(self._q6(amount_usdc)),
                ),
            )
            if cur.rowcount != 1:
                raise RuntimeError("MOVE_FROZEN_TO_PENDING_INCONSISTENT")

    def release_consumer_pending_to_available(
        self, owner: str, amount_usdc: Decimal | str | int, updated_at: str
    ) -> None:
        """Atomically move *amount_usdc* from pending → available on failure/cancel."""
        account_id, _ = self._account_identity(owner, "consumer")
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_account_balances
                SET pending_balance   = pending_balance   - %s,
                    available_balance = available_balance + %s,
                    updated_at        = %s
                WHERE account_id = %s
                  AND pending_balance >= %s
                """,
                (
                    str(self._q6(amount_usdc)),
                    str(self._q6(amount_usdc)),
                    updated_at,
                    account_id,
                    str(self._q6(amount_usdc)),
                ),
            )
            if cur.rowcount != 1:
                raise RuntimeError("RELEASE_PENDING_TO_AVAILABLE_INCONSISTENT")

    def release_consumer_frozen_to_available(
        self, owner: str, amount_usdc: Decimal | str | int, updated_at: str
    ) -> None:
        """Atomically move *amount_usdc* from frozen → available on reject."""
        account_id, _ = self._account_identity(owner, "consumer")
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_account_balances
                SET frozen_balance    = frozen_balance    - %s,
                    available_balance = available_balance + %s,
                    updated_at        = %s
                WHERE account_id = %s
                  AND frozen_balance >= %s
                """,
                (
                    str(self._q6(amount_usdc)),
                    str(self._q6(amount_usdc)),
                    updated_at,
                    account_id,
                    str(self._q6(amount_usdc)),
                ),
            )
            if cur.rowcount != 1:
                raise RuntimeError("RELEASE_FROZEN_TO_AVAILABLE_INCONSISTENT")

    def consume_provider_pending_for_withdrawal(
        self, owner: str, amount_usdc: Decimal | str | int, updated_at: str
    ) -> None:
        """Atomically reduce provider pending receivable after on-chain claim."""
        account_id, _ = self._account_identity(owner, "provider")
        amount = str(self._q6(amount_usdc))
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_account_balances
                SET pending_balance = pending_balance - %s,
                    updated_at      = %s
                WHERE account_id = %s
                  AND pending_balance >= %s
                """,
                (amount, updated_at, account_id, amount),
            )
            if cur.rowcount != 1:
                raise RuntimeError("CONSUME_PROVIDER_PENDING_INCONSISTENT")

    def move_provider_frozen_to_pending(
        self, owner: str, amount_usdc: Decimal | str | int, updated_at: str
    ) -> None:
        """Atomically move provider withdrawal amount from manual-review frozen → pending."""
        account_id, _ = self._account_identity(owner, "provider")
        amount = str(self._q6(amount_usdc))
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_account_balances
                SET frozen_balance  = frozen_balance  - %s,
                    pending_balance = pending_balance + %s,
                    updated_at      = %s
                WHERE account_id = %s
                  AND frozen_balance >= %s
                """,
                (amount, amount, updated_at, account_id, amount),
            )
            if cur.rowcount != 1:
                raise RuntimeError("MOVE_PROVIDER_FROZEN_TO_PENDING_INCONSISTENT")

    def release_provider_pending_to_available(
        self, owner: str, amount_usdc: Decimal | str | int, updated_at: str
    ) -> None:
        """Atomically return provider pending withdrawal amount to receivable."""
        account_id, _ = self._account_identity(owner, "provider")
        amount = str(self._q6(amount_usdc))
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_account_balances
                SET pending_balance   = pending_balance   - %s,
                    available_balance = available_balance + %s,
                    updated_at        = %s
                WHERE account_id = %s
                  AND pending_balance >= %s
                """,
                (amount, amount, updated_at, account_id, amount),
            )
            if cur.rowcount != 1:
                raise RuntimeError("RELEASE_PROVIDER_PENDING_TO_AVAILABLE_INCONSISTENT")

    def release_provider_frozen_to_available(
        self, owner: str, amount_usdc: Decimal | str | int, updated_at: str
    ) -> None:
        """Atomically return provider manual-review frozen withdrawal amount to receivable."""
        account_id, _ = self._account_identity(owner, "provider")
        amount = str(self._q6(amount_usdc))
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_account_balances
                SET frozen_balance    = frozen_balance    - %s,
                    available_balance = available_balance + %s,
                    updated_at        = %s
                WHERE account_id = %s
                  AND frozen_balance >= %s
                """,
                (amount, amount, updated_at, account_id, amount),
            )
            if cur.rowcount != 1:
                raise RuntimeError("RELEASE_PROVIDER_FROZEN_TO_AVAILABLE_INCONSISTENT")

    def write_balance_ledger(self, ledger: BalanceLedger) -> None:
        """Persist the ledger's available balances.

        Only available_balance is updated so that pending_balance and
        frozen_balance (managed atomically by the withdrawal subsystem) are
        never clobbered by a full-ledger rewrite from the deposit indexer.
        """
        updated_at = (
            to_dt_str(ledger.updated_at or now_dt_str(), now_dt_str()) or now_dt_str()
        )

        with self._db.tx_cursor() as cur:
            self._upsert_available_only_rows(
                cur,
                "consumer",
                ledger.consumer_wallets,
                updated_at,
            )
            self._upsert_available_only_rows(
                cur,
                "provider",
                ledger.provider_wallets,
                updated_at,
            )

            # Platform revenue row: still full-upsert (no pending/frozen semantics)
            self._upsert_balance_row(
                cur,
                "__platform__",
                "platform_fee",
                ledger.platform.fee_accrued,
                0,
                0,
                updated_at,
            )

    def _upsert_available_only_rows(
        self,
        cur: Any,
        account_type: str,
        wallet_rows: list[ConsumerWalletRecord] | list[ProviderWalletRecord],
        updated_at: str,
    ) -> None:
        """Upsert only available_balance; leave pending/frozen intact on conflict.

        Safety: on conflict we use GREATEST(EXCLUDED, current) so that a stale
        read-modify-write cycle from the deposit indexer or billing path can never
        decrease available_balance below a value that was atomically reduced by
        a concurrent reserve_consumer_balance_for_withdrawal call.  The only
        legitimate decreases to available_balance go through atomic delta SQLs
        (reserve_consumer_balance_for_withdrawal, charge_consumer_atomic, etc.)
        which bypass this path entirely.
        """
        for wallet_row in wallet_rows:
            owner = str(wallet_row.owner_address or "").lower()
            if not owner:
                continue
            account_id = self._ensure_ledger_account(cur, owner, account_type, updated_at)
            cur.execute(
                """
                INSERT INTO synapse_account_balances (
                    account_id, available_balance, pending_balance, frozen_balance, updated_at
                ) VALUES (%s, %s, 0, 0, %s)
                ON CONFLICT (account_id)
                DO UPDATE SET
                    available_balance = GREATEST(EXCLUDED.available_balance,
                                                 synapse_account_balances.available_balance),
                    updated_at        = EXCLUDED.updated_at
                """,
                (
                    account_id,
                    str(self._q6(wallet_row.available_balance or 0)),
                    updated_at,
                ),
            )

    def _upsert_account_rows(
        self,
        cur: Any,
        account_type: str,
        wallet_rows: list[ConsumerWalletRecord] | list[ProviderWalletRecord],
        updated_at: str,
    ) -> None:
        for wallet_row in wallet_rows:
            owner = str(wallet_row.owner_address or "").lower()
            if not owner:
                continue
            self._upsert_balance_row(
                cur,
                owner,
                account_type,
                wallet_row.available_balance,
                wallet_row.pending_balance,
                wallet_row.frozen_balance,
                updated_at,
            )
