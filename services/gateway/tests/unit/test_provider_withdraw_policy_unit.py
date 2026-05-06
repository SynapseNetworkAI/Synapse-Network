"""Provider withdrawal dust and maturity policy tests."""
from __future__ import annotations

import asyncio
from decimal import Decimal

import pytest
from fastapi import HTTPException

from src.domain.execution import PreparedWithdrawTicket
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


def test_provider_withdraw_rejects_unmatured_receivable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.services.provider import withdraw_policy_mixin as mixin

    monkeypatch.setattr(
        mixin.settings,
        "provider_withdraw_maturity_enforcement_enabled",
        True,
        raising=False,
    )
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


def test_provider_withdraw_maturity_bypass_allows_local_receivable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.services.provider import withdraw_policy_mixin as mixin

    monkeypatch.setattr(
        mixin.settings,
        "provider_withdraw_maturity_enforcement_enabled",
        False,
        raising=False,
    )
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = Decimal("30.000000")
    storage.balance.read_provider_mature_withdrawable = (
        lambda _owner, _seconds: Decimal("0.000000")
    )
    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)

    created = asyncio.run(
        service.create_provider_withdraw_intent(
            {"amountUsdc": "30"},
            "0xdef",
            "withdraw-intent-key-maturity-bypass-1",
        )
    )

    assert created["status"] == "APPROVED_AUTO"
    assert created["amountUsdc"] == "30.000000"


def test_provider_withdraw_same_key_replays_active_pending_after_lock() -> None:
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = Decimal("150.000000")
    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)
    service._prepare_withdraw_ticket = lambda **kwargs: PreparedWithdrawTicket(
        requires_manual_review=True,
        amount_wei=120000000,
        fee_wei=0,
        nonce=0,
        chain_id=0,
        deadline=0,
        signature="",
        signer_address="",
        ticket={},
    )

    first = asyncio.run(
        service.create_provider_withdraw_intent(
            {"amountUsdc": "120.000000"},
            "0xdef",
            "withdraw-intent-key-replay-pending",
        )
    )
    second = asyncio.run(
        service.create_provider_withdraw_intent(
            {"amountUsdc": "120.000000"},
            "0xdef",
            "withdraw-intent-key-replay-pending",
        )
    )

    assert second["withdrawalId"] == first["withdrawalId"]
    assert len(storage.gateway_state.withdraw_rows) == 1
    wallet_after = storage.balance.ledger.ensure_provider_wallet("0xdef")
    assert _money_decimal(wallet_after.available_balance) == Decimal("30.000000")
    assert _money_decimal(wallet_after.frozen_balance) == Decimal("120.000000")


def test_provider_withdraw_uses_mature_amount_for_full_withdrawal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.services.provider import withdraw_policy_mixin as mixin

    monkeypatch.setattr(
        mixin.settings,
        "provider_withdraw_maturity_enforcement_enabled",
        True,
        raising=False,
    )
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


def test_provider_full_withdrawal_rejects_mature_dust(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.services.provider import withdraw_policy_mixin as mixin

    monkeypatch.setattr(
        mixin.settings,
        "provider_withdraw_maturity_enforcement_enabled",
        True,
        raising=False,
    )
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
