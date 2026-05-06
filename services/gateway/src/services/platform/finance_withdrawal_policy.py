"""Shared platform finance withdrawal read helpers."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from src.core.config import settings


def read_consumer_withdrawable_balance(
    balance_repo: Any,
    owner_wallet: str,
    available_balance: Decimal,
) -> Decimal:
    if not settings.consumer_withdraw_maturity_enforcement_enabled:
        return available_balance
    mature_reader = getattr(balance_repo, "read_consumer_mature_withdrawable", None)
    if callable(mature_reader):
        return mature_reader(owner_wallet, settings.consumer_withdraw_maturity_seconds)
    return Decimal("0")
