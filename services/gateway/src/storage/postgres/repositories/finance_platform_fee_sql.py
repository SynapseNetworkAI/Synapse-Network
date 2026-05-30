from __future__ import annotations

from typing import Any, Callable

def accrue_platform_fee_for_consumer_withdraw(
    cur: Any,
    ensure_ledger_account: Callable[[Any, str, str, str], str],
    now_text: str,
    fee_usdc: Any,
) -> None:
    platform_account_id = ensure_ledger_account(cur, "__platform__", "platform_fee", now_text)
    cur.execute(
        """
        INSERT INTO synapse_account_balances (
            account_id, available_balance, pending_balance, frozen_balance, updated_at
        ) VALUES (%s, 0, 0, 0, %s)
        ON CONFLICT (account_id) DO NOTHING
        """,
        (platform_account_id, now_text),
    )
    cur.execute(
        """
        UPDATE synapse_account_balances
        SET available_balance = available_balance + %s,
            updated_at        = %s
        WHERE account_id = %s
        """,
        (str(fee_usdc), now_text, platform_account_id),
    )
    if cur.rowcount != 1:
        raise RuntimeError("PLATFORM_FEE_ACCRUAL_INCONSISTENT")


def accrue_platform_fee_if_consumer_withdraw(
    cur: Any,
    ensure_ledger_account: Callable[[Any, str, str, str], str],
    now_text: str,
    withdrawal_kind: str,
    fee_usdc: Any = "0.500000",
) -> None:
    if withdrawal_kind == "consumer_refund":
        accrue_platform_fee_for_consumer_withdraw(cur, ensure_ledger_account, now_text, fee_usdc)
