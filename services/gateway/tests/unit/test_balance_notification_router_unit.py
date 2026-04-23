from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.api.routers import balance_deposit, balance_withdraw
from src.api.routers.balance_helpers import (
    DepositConfirmRequest,
    ProviderWithdrawIntentRequest,
    RefundCompleteRequest,
)
from src.api.schemas.pydantic_models import ConsumerWithdrawRequest


class _Request:
    headers = {"X-Request-Id": "req-notify-router", "User-Agent": "pytest"}
    client = SimpleNamespace(host="127.0.0.1")


class _Storage:
    pass


class _BrokenBalanceService:
    async def get_balance(self, owner_wallet: str) -> dict[str, object]:
        _ = owner_wallet
        raise RuntimeError("database pool exhausted")


class _BalanceService:
    async def confirm_deposit_intent(
        self,
        *,
        owner_wallet: str,
        deposit_intent_id: str,
        event_key: str,
        confirmations: int,
        request_meta: dict[str, object],
    ) -> dict[str, object]:
        assert owner_wallet == "0xAbC"
        assert deposit_intent_id == "dep-intent-1"
        assert event_key == "evt-1"
        assert confirmations == 3
        assert request_meta["requestId"] == "req-notify-router"
        return {
            "depositId": "dep-intent-1",
            "amount": "12.000000",
            "status": "CONFIRMED",
        }

    async def complete_refund_intent(
        self,
        *,
        owner_wallet: str,
        refund_id: str,
        tx_hash: str,
        request_meta: dict[str, object],
    ) -> dict[str, object]:
        assert owner_wallet == "0xAbC"
        assert refund_id == "refund-1"
        assert tx_hash == "0x" + "a" * 64
        assert request_meta["review"]["decision"] == "APPROVE"
        return {"amount": "5.000000", "status": "COMPLETED"}

    async def create_consumer_withdraw_intent(
        self,
        *,
        payload: dict[str, object],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: dict[str, object],
    ) -> dict[str, object]:
        assert payload["amountUsdc"] == Decimal("7.50")
        assert owner_wallet == "0xAbC"
        assert idempotency_key == "idem-consumer-withdraw-0001"
        assert request_meta["clientIp"] == "127.0.0.1"
        return {
            "withdrawalId": "consumer-withdraw-1",
            "amount": "7.500000",
            "status": "PENDING_MANUAL_REVIEW",
        }

    async def create_provider_withdraw_intent(
        self,
        payload: dict[str, object],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: dict[str, object],
    ) -> dict[str, object]:
        assert payload["amountUsdc"] == Decimal("9.25")
        assert owner_wallet == "0xAbC"
        assert idempotency_key == "idem-provider-withdraw-0001"
        assert request_meta["userAgent"] == "pytest"
        return {
            "withdrawalId": "provider-withdraw-1",
            "amount": "9.250000",
            "status": "REQUESTED",
        }


@pytest.mark.asyncio
async def test_get_balance_wraps_storage_errors_for_safe_client_response() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await balance_deposit.get_balance("0xAbC", _BrokenBalanceService())

    assert exc_info.value.status_code == 500
    assert "Database IO blocked" in str(exc_info.value.detail)
    assert "database pool exhausted" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_confirm_deposit_schedules_in_app_notification(monkeypatch) -> None:
    calls: list[tuple[object, object]] = []
    storage = _Storage()
    monkeypatch.setattr(
        balance_deposit,
        "schedule_in_app_notification",
        lambda storage_arg, intent: calls.append((storage_arg, intent)),
    )

    response = await balance_deposit.confirm_deposit_intent(
        "dep-intent-1",
        DepositConfirmRequest(eventKey="evt-1", confirmations=3),
        _Request(),
        "0xAbC",
        _BalanceService(),
        storage,
    )

    assert response["status"] == "success"
    assert response["intent"]["depositId"] == "dep-intent-1"
    assert calls[0][0] is storage
    assert calls[0][1].event_type == "deposit.confirmed"
    assert calls[0][1].payload == {
        "depositId": "dep-intent-1",
        "amount": "12.000000",
        "currency": "USDC",
        "status": "CONFIRMED",
    }


@pytest.mark.asyncio
async def test_complete_refund_schedules_in_app_notification(monkeypatch) -> None:
    calls: list[tuple[object, object]] = []
    storage = _Storage()
    monkeypatch.setattr(
        balance_deposit,
        "schedule_in_app_notification",
        lambda storage_arg, intent: calls.append((storage_arg, intent)),
    )

    response = await balance_deposit.complete_refund(
        "refund-1",
        RefundCompleteRequest(
            txHash="0x" + "a" * 64,
            reviewDecision="approve",
            reviewerAddress="0xReviewer",
            reviewerNote="ok",
        ),
        _Request(),
        "0xAbC",
        _BalanceService(),
        storage,
    )

    assert response["status"] == "COMPLETED"
    assert response["ownerAddress"] == "0xAbC"
    assert calls[0][0] is storage
    assert calls[0][1].event_type == "refund.completed"
    assert calls[0][1].resource_id == "refund-1"


@pytest.mark.asyncio
async def test_consumer_withdraw_schedules_in_app_notification(monkeypatch) -> None:
    calls: list[tuple[object, object]] = []
    storage = _Storage()
    monkeypatch.setattr(
        balance_deposit,
        "schedule_in_app_notification",
        lambda storage_arg, intent: calls.append((storage_arg, intent)),
    )

    response = await balance_deposit.create_consumer_withdraw(
        ConsumerWithdrawRequest(amountUsdc=Decimal("7.50"), reason="cash out"),
        _Request(),
        "idem-consumer-withdraw-0001",
        "0xAbC",
        _BalanceService(),
        storage,
    )

    assert response["status"] == "PENDING_MANUAL_REVIEW"
    assert response["withdrawalId"] == "consumer-withdraw-1"
    assert calls[0][0] is storage
    assert calls[0][1].event_type == "consumer_withdrawal.created"
    assert calls[0][1].severity == "warning"


@pytest.mark.asyncio
async def test_provider_withdraw_schedules_in_app_notification(monkeypatch) -> None:
    calls: list[tuple[object, object]] = []
    storage = _Storage()
    monkeypatch.setattr(
        balance_withdraw,
        "schedule_in_app_notification",
        lambda storage_arg, intent: calls.append((storage_arg, intent)),
    )

    response = await balance_withdraw.create_provider_withdraw_intent(
        ProviderWithdrawIntentRequest(amountUsdc=Decimal("9.25")),
        _Request(),
        "idem-provider-withdraw-0001",
        "0xAbC",
        _BalanceService(),
        storage,
    )

    assert response["status"] == "REQUESTED"
    assert response["withdrawalId"] == "provider-withdraw-1"
    assert calls[0][0] is storage
    assert calls[0][1].event_type == "provider_withdrawal.created"
    assert calls[0][1].payload == {
        "withdrawalId": "provider-withdraw-1",
        "amount": "9.250000",
        "currency": "USDC",
        "status": "REQUESTED",
    }
