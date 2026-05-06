"""Provider analytics summary read model tests."""
from __future__ import annotations

from decimal import Decimal
from typing import Any, cast

from src.core.common import normalize_wallet
from src.core.config import settings
from src.services.provider.provider_analytics_service import ProviderAnalyticsService


class _GatewayState:
    def read_invocation_billing_rows(self) -> list[object]:
        return []


class _System:
    gateway_state = _GatewayState()


class _Ledger:
    def provider_receivable_balance(self, owner_wallet: str) -> Decimal:
        assert owner_wallet == normalize_wallet("0xProvider")
        return Decimal("50.000000")


class _Balance:
    def __init__(self) -> None:
        self.mature_reader_args: tuple[str, int] | None = None

    def read_balance_ledger(self) -> _Ledger:
        return _Ledger()

    def read_provider_mature_withdrawable(
        self, owner_wallet: str, maturity_seconds: int
    ) -> Decimal:
        self.mature_reader_args = (owner_wallet, maturity_seconds)
        return Decimal("5.000000")


class _Finance:
    def __init__(self, balance: _Balance) -> None:
        self.balance = balance


class _DataManager:
    def __init__(self) -> None:
        self.balance = _Balance()
        self.finance = _Finance(self.balance)
        self.system = _System()


class _Storage:
    def __init__(self) -> None:
        self.data_manager = _DataManager()

    def get_data_manager(self) -> _DataManager:
        return self.data_manager


def test_provider_earnings_summary_exposes_total_and_mature_receivable(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        settings,
        "provider_withdraw_maturity_enforcement_enabled",
        True,
        raising=False,
    )
    storage = _Storage()
    service = ProviderAnalyticsService(cast(Any, storage))

    summary = service.get_provider_earnings_summary("0xProvider", 10)

    assert summary["ownerAddress"] == normalize_wallet("0xProvider")
    assert summary["providerReceivable"] == Decimal("50.000000")
    assert summary["providerMatureReceivable"] == Decimal("5.000000")
    assert summary["providerWithdrawMaturityEnforced"] is True
    assert storage.data_manager.balance.mature_reader_args == (
        normalize_wallet("0xProvider"),
        int(settings.provider_withdraw_maturity_seconds),
    )


def test_provider_earnings_summary_uses_receivable_when_maturity_disabled(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        settings,
        "provider_withdraw_maturity_enforcement_enabled",
        False,
        raising=False,
    )
    storage = _Storage()
    service = ProviderAnalyticsService(cast(Any, storage))

    summary = service.get_provider_earnings_summary("0xProvider", 10)

    assert summary["providerReceivable"] == Decimal("50.000000")
    assert summary["providerMatureReceivable"] == Decimal("50.000000")
    assert summary["providerWithdrawMaturityEnforced"] is False
    assert storage.data_manager.balance.mature_reader_args is None
