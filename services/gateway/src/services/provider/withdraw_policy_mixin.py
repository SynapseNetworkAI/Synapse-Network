"""Provider withdrawal policy helpers."""
from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException

from src.core.config import settings
from src.utils.money import money_str, parse_usdc


class ProviderWithdrawPolicyMixin:
    """Hard-failure withdrawal policy checks before reservation or signing."""

    def _provider_withdraw_min_amount(self) -> Decimal:
        return parse_usdc(str(settings.provider_withdraw_min_usdc))

    def _read_provider_mature_receivable(
        self, owner: str, fallback_available: Decimal
    ) -> Decimal:
        balance_repo = self._provider_balance_repository()  # type: ignore[attr-defined]  # reason: mixed in by ProviderWithdrawHelpersMixin
        reader = getattr(balance_repo, "read_provider_mature_withdrawable", None)
        if callable(reader):
            return parse_usdc(
                reader(owner, int(settings.provider_withdraw_maturity_seconds))
            )
        return parse_usdc(fallback_available)

    def _raise_min_provider_withdraw(self, min_amount: Decimal) -> None:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "MIN_WITHDRAWAL_AMOUNT_NOT_MET",
                "message": f"Minimum provider withdrawal amount is {money_str(min_amount)} USDC.",
            },
        )

    def _raise_provider_receivable_not_matured(
        self, amount: Decimal, mature_receivable: Decimal
    ) -> None:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "PROVIDER_RECEIVABLE_NOT_MATURED",
                "message": (
                    f"Requested {money_str(amount)} USDC exceeds mature provider receivable "
                    f"of {money_str(mature_receivable)} USDC. Provider earnings must mature for "
                    "7 days before withdrawal."
                ),
            },
        )
