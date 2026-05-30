from __future__ import annotations

from decimal import Decimal
from typing import Any

from src.services.platform.business_policy import consumer_withdraw_fee_amount
from src.utils.money import parse_usdc


def consumer_withdraw_fee_usdc(storage: Any | None = None) -> Decimal:
    if storage is not None:
        return parse_usdc(consumer_withdraw_fee_amount(storage))
    return parse_usdc(Decimal("0.50"))


def accrue_consumer_withdraw_fee_after_fallback(storage: Any, target: Any) -> None:
    if str(getattr(target, "refund_type", "") or "") != "consumer_withdraw":
        return
    balance_repo = storage.get_data_manager().finance.balance
    ledger = balance_repo.read_balance_ledger()
    ledger.platform.fee_accrued = parse_usdc(
        Decimal(str(ledger.platform.fee_accrued or "0")) + consumer_withdraw_fee_usdc(storage)
    )
    balance_repo.write_balance_ledger(ledger)
