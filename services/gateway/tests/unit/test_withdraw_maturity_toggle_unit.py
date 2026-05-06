from decimal import Decimal
import asyncio

from src.core.config import settings
from src.services.platform.finance_service import PlatformFinanceService

from tests.unit.test_finance_runtime_service_unit import DummyLockManager, FakeStorage


def test_owner_balance_summary_uses_available_when_maturity_disabled(monkeypatch):
    monkeypatch.setattr(
        settings,
        "consumer_withdraw_maturity_enforcement_enabled",
        False,
        raising=False,
    )
    storage = FakeStorage()
    consumer_wallet = storage.balance.ledger.ensure_consumer_wallet("0xabc")
    consumer_wallet.available_balance = Decimal("100")
    storage.balance.consumer_mature_withdrawable = Decimal("0")

    balance = asyncio.run(
        PlatformFinanceService(storage, DummyLockManager()).get_balance("0xabc")
    )

    assert balance["consumerAvailableBalance"] == "100.000000"
    assert balance["consumerWithdrawableBalance"] == "100.000000"
    assert balance["consumerWithdrawMaturityEnforced"] is False
