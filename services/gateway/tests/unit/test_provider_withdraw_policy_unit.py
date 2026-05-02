"""Provider withdrawal dust and maturity policy tests."""
from __future__ import annotations

import asyncio
from decimal import Decimal

import pytest
from fastapi import HTTPException

from src.services.provider.withdraw_service import ProviderWithdrawService

from tests.unit.test_finance_runtime_service_unit import (
    DummyLockManager,
    FakeStorage,
    _configure_withdraw_service,
    _money_decimal,
)


def test_provider_withdraw_rejects_dust_without_creating_row() -> None:
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = Decimal("50.000000")
    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            service.create_provider_withdraw_intent(
                {"amountUsdc": "9.99"},
                "0xdef",
                "withdraw-intent-key-dust-1",
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "MIN_WITHDRAWAL_AMOUNT_NOT_MET"
    assert storage.gateway_state.withdraw_rows == []
    wallet_after = storage.balance.ledger.ensure_provider_wallet("0xdef")
    assert _money_decimal(wallet_after.available_balance) == Decimal("50.000000")
    assert _money_decimal(wallet_after.pending_balance) == Decimal("0.000000")


def test_provider_withdraw_rejects_unmatured_receivable() -> None:
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = Decimal("30.000000")
    storage.balance.read_provider_mature_withdrawable = (
        lambda _owner, _seconds: Decimal("0.000000")
    )
    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            service.create_provider_withdraw_intent(
                {"amountUsdc": "30"},
                "0xdef",
                "withdraw-intent-key-unmatured-1",
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "PROVIDER_RECEIVABLE_NOT_MATURED"
    assert storage.gateway_state.withdraw_rows == []


def test_provider_withdraw_uses_mature_amount_for_full_withdrawal() -> None:
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = Decimal("50.000000")
    storage.balance.read_provider_mature_withdrawable = (
        lambda _owner, _seconds: Decimal("30.000000")
    )
    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)

    created = asyncio.run(
        service.create_provider_withdraw_intent(
            {},
            "0xdef",
            "withdraw-intent-key-mature-full-1",
        )
    )

    assert created["status"] == "APPROVED_AUTO"
    assert created["amountUsdc"] == "30.000000"


def test_provider_full_withdrawal_rejects_mature_dust() -> None:
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = Decimal("50.000000")
    storage.balance.read_provider_mature_withdrawable = (
        lambda _owner, _seconds: Decimal("5.000000")
    )
    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            service.create_provider_withdraw_intent(
                {},
                "0xdef",
                "withdraw-intent-key-mature-dust-1",
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "MIN_WITHDRAWAL_AMOUNT_NOT_MET"
    assert storage.gateway_state.withdraw_rows == []
