"""Typed read models returned by platform finance services."""
from __future__ import annotations

from typing import Any, TypedDict


class OwnerBalanceSummaryResponse(TypedDict):
    ownerAddress: str
    ownerBalance: str
    consumerAvailableBalance: str
    consumerWithdrawableBalance: str
    consumerPendingBalance: str
    consumerFrozenBalance: str
    consumerWithdrawMinUsdc: str
    consumerWithdrawMaturitySeconds: int
    consumerWithdrawMaturityEnforced: bool
    providerReceivable: str
    providerReceivableBalance: str
    providerLockedBalance: str
    platformFeeAccrued: str
    updatedAt: str


class OwnerSpendingLimitResponse(TypedDict):
    ownerAddress: str
    spendingLimitUsdc: str | None
    allowUnlimited: bool
    cycleInterval: str
    currentCycleSpendUsdc: str
    remainingSpendUsdc: str | None
    updatedAt: str | None


class VoucherRedeemResponse(TypedDict):
    redemption: dict[str, Any]
    balance: OwnerBalanceSummaryResponse
