from __future__ import annotations

from decimal import Decimal
from typing import Any

from src.services.owner.finance_constants import CONSUMER_WITHDRAW_FEE_USDC
from src.utils.money import parse_usdc


def consumer_withdraw_fee_usdc() -> Decimal:
    return parse_usdc(Decimal(str(CONSUMER_WITHDRAW_FEE_USDC)))


def accrue_consumer_withdraw_fee_after_fallback(storage: Any, target: Any) -> None:
    if str(getattr(target, "refund_type", "") or "") != "consumer_withdraw":
        return
    balance_repo = storage.get_data_manager().finance.balance
    ledger = balance_repo.read_balance_ledger()
    ledger.platform.fee_accrued = parse_usdc(
        Decimal(str(ledger.platform.fee_accrued or "0")) + consumer_withdraw_fee_usdc()
    )
    balance_repo.write_balance_ledger(ledger)
