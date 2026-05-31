from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.api.routers import balance_deposit, balance_helpers, balance_withdraw
from src.api.routers.balance_helpers import (
    AdminProviderWithdrawCompleteRequest,
    AdminProviderWithdrawReviewRequest,
    AdminRefundCompleteRequest,
    AdminRefundReviewRequest,
    DepositConfirmRequest,
    ProviderWithdrawIntentRequest,
    ProviderWithdrawCompleteRequest,
    RefundCompleteRequest,
)
from src.api.schemas.pydantic_models import ConsumerWithdrawRequest
from src.services.platform.internal_auth import InternalServicePrincipal


class _Request:
    headers = {"X-Request-Id": "req-notify-router", "User-Agent": "pytest"}
    client = SimpleNamespace(host="127.0.0.1")


class _Storage:
    pass


@pytest.fixture(autouse=True)
def _allow_test_fee_admin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(balance_helpers.settings, "platform_fee_admin_wallets", (), raising=False)


class _BrokenBalanceService:
    async def get_balance(self, owner_wallet: str) -> dict[str, object]:
        _ = owner_wallet
        raise RuntimeError("database pool exhausted")


class _BalanceService:
    async def register_deposit_intent(
        self,
        intent: dict[str, object],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: dict[str, object],
    ) -> dict[str, object]:
        assert intent["txHash"] == "0x" + "a" * 64
        assert owner_wallet == "0xAbC"
        assert idempotency_key == "idem-deposit-intent-0001"
        assert request_meta["requestId"] == "req-notify-router"
        return {
            "id": "dep-intent-router-1",
            "txHash": "0x" + "a" * 64,
            "status": "PENDING_CONFIRMATION",
        }

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
            "eventKey": "evt-1",
        }

    async def complete_refund_intent(
        self,
        *,
        owner_wallet: str,
        refund_id: str,
        tx_hash: str,
        request_meta: dict[str, object],
    ) -> dict[str, object]:
        assert owner_wallet in {"0xAbC", "0xabc0000000000000000000000000000000000000"}
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

    async def review_consumer_withdrawal(
        self,
        *,
        owner_wallet: str,
        refund_id: str,
        request_meta: dict[str, object],
    ) -> dict[str, object]:
        assert owner_wallet == "0xabc0000000000000000000000000000000000000"
        assert refund_id == "consumer-review-1"
        assert request_meta["review"]["decision"] == "APPROVE"
        return {
            "withdrawalId": refund_id,
            "amount": "6.000000",
            "status": "SIGNED",
            "ticket": {"ticketId": "ticket-consumer-review-1"},
        }

    async def complete_provider_withdrawal(
        self,
        *,
        owner_wallet: str,
        withdrawal_id: str,
        tx_hash: str,
        request_meta: dict[str, object],
    ) -> dict[str, object]:
        assert owner_wallet in {"0xAbC", "0xabc0000000000000000000000000000000000000"}
        assert withdrawal_id in {"provider-complete-1", "provider-admin-complete-1"}
        assert tx_hash == "0x" + "b" * 64
        assert request_meta["requestId"] == "req-notify-router"
        return {
            "withdrawalId": withdrawal_id,
            "amount": "4.000000",
            "status": "COMPLETED",
            "txHash": tx_hash,
        }

    async def review_provider_withdrawal(
        self,
        *,
        owner_wallet: str,
        withdrawal_id: str,
        request_meta: dict[str, object],
    ) -> dict[str, object]:
        assert owner_wallet == "0xabc0000000000000000000000000000000000000"
        assert withdrawal_id == "provider-review-reject-1"
        assert request_meta["review"]["decision"] == "REJECT"
        return {
            "withdrawalId": withdrawal_id,
            "amount": "3.500000",
            "status": "REJECTED",
        }


class _SignedBalanceService(_BalanceService):
    async def create_consumer_withdraw_intent(
        self,
        *,
        payload: dict[str, object],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: dict[str, object],
    ) -> dict[str, object]:
        assert owner_wallet == "0xAbC"
        assert idempotency_key == "idem-consumer-withdraw-0002"
        assert request_meta["clientIp"] == "127.0.0.1"
        return {
            "withdrawalId": "consumer-withdraw-signed-1",
            "amount": "7.500000",
            "status": "SIGNED",
            "ticket": {"ticketId": "ticket-consumer-withdraw-signed-1"},
        }

    async def create_provider_withdraw_intent(
        self,
        payload: dict[str, object],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: dict[str, object],
    ) -> dict[str, object]:
        assert owner_wallet == "0xAbC"
        assert idempotency_key == "idem-provider-withdraw-0002"
        assert request_meta["userAgent"] == "pytest"
        return {
            "withdrawalId": "provider-withdraw-signed-1",
            "amount": "9.250000",
            "status": "SIGNED",
            "ticket": {"ticketId": "ticket-provider-withdraw-signed-1"},
        }


def _principal() -> InternalServicePrincipal:
    return InternalServicePrincipal(
        service_subject="gateway-admin",
        admin_wallet="0xabc0000000000000000000000000000000000000",
        actor_admin_id="admin-notify-router",
        actor_role="owner",
        request_id="req-notify-router",
        scope="test",
        token_id="token-notify-router",
    )


@pytest.mark.asyncio
async def test_get_balance_wraps_storage_errors_for_safe_client_response() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await balance_deposit.get_balance("0xAbC", _BrokenBalanceService())

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == {
        "code": "BALANCE_QUERY_FAILED",
        "message": "Unable to load balance right now.",
    }


@pytest.mark.asyncio
async def test_register_deposit_intent_triggers_deposit_indexer_after_commit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    trigger_calls: list[dict[str, str]] = []

    async def _fake_trigger(*, source: str, triggered_by: str, tx_hash: str | None = None) -> bool:
        trigger_calls.append(
            {
                "source": source,
                "triggered_by": triggered_by,
                "tx_hash": str(tx_hash or ""),
            }
        )
        return True

    monkeypatch.setattr(balance_deposit, "post_deposit_indexer_trigger", _fake_trigger)

    response = await balance_deposit.register_deposit_intent(
        balance_helpers.DepositIntentRequest(
            txHash="0x" + "a" * 64,
            amountUsdc="5.000000",
        ),
        _Request(),
        "idem-deposit-intent-0001",
        "0xAbC",
        _BalanceService(),
    )

    assert response["status"] == "success"
    assert response["intent"]["status"] == "PENDING_CONFIRMATION"
    assert trigger_calls == [
        {
            "source": "deposit_intent_registered",
            "triggered_by": "api.v1.balance.deposit.intent",
            "tx_hash": "0x" + "a" * 64,
        }
    ]


@pytest.mark.asyncio
async def test_register_deposit_intent_returns_success_even_when_trigger_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fake_trigger(*, source: str, triggered_by: str, tx_hash: str | None = None) -> bool:
        _ = (source, triggered_by, tx_hash)
        return False

    monkeypatch.setattr(balance_deposit, "post_deposit_indexer_trigger", _fake_trigger)

    response = await balance_deposit.register_deposit_intent(
        balance_helpers.DepositIntentRequest(
            txHash="0x" + "a" * 64,
            amountUsdc="5.000000",
        ),
        _Request(),
        "idem-deposit-intent-0001",
        "0xAbC",
        _BalanceService(),
    )

    assert response["status"] == "success"
    assert response["intent"]["status"] == "PENDING_CONFIRMATION"


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
async def test_confirm_deposit_replay_does_not_reschedule_notification(monkeypatch) -> None:
    class _ReplayBalanceService(_BalanceService):
        async def confirm_deposit_intent(
            self,
            *,
            owner_wallet: str,
            deposit_intent_id: str,
            event_key: str,
            confirmations: int,
            request_meta: dict[str, object],
        ) -> dict[str, object]:
            _ = owner_wallet, deposit_intent_id, event_key, confirmations, request_meta
            return {
                "depositId": "dep-intent-1",
                "amount": "12.000000",
                "status": "CONFIRMED",
            }

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
        _ReplayBalanceService(),
        storage,
    )

    assert response["status"] == "success"
    assert response["intent"]["status"] == "CONFIRMED"
    assert calls == []


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
async def test_complete_refund_as_admin_schedules_transaction_notification(monkeypatch) -> None:
    calls: list[dict[str, object]] = []
    storage = _Storage()
    monkeypatch.setattr(
        balance_deposit,
        "schedule_transaction_notifications",
        lambda storage_arg, **kwargs: calls.append({"storage": storage_arg, **kwargs}),
    )

    response = await balance_deposit.complete_refund_as_admin(
        "refund-1",
        AdminRefundCompleteRequest(
            ownerAddress="0xabc0000000000000000000000000000000000000",
            txHash="0x" + "a" * 64,
            reviewDecision="approve",
            reviewerAddress="0xReviewer",
            reviewerNote="ok",
        ),
        _Request(),
        _principal(),
        _BalanceService(),
        storage,
    )

    assert response["status"] == "success"
    assert calls[0]["storage"] is storage
    assert calls[0]["template_key"] == "refund_completed"
    assert calls[0]["event_type"] == "refund.completed"
    assert calls[0]["payload"]["actionUrl"].endswith("/dashboard/billing")


@pytest.mark.asyncio
async def test_review_refund_as_admin_schedules_ticket_ready_transaction_notification(monkeypatch) -> None:
    calls: list[dict[str, object]] = []
    storage = _Storage()
    monkeypatch.setattr(
        balance_deposit,
        "schedule_transaction_notifications",
        lambda storage_arg, **kwargs: calls.append({"storage": storage_arg, **kwargs}),
    )

    response = await balance_deposit.review_refund_as_admin(
        "consumer-review-1",
        AdminRefundReviewRequest(
            ownerAddress="0xabc0000000000000000000000000000000000000",
            reviewDecision="approve",
            reviewerAddress="0xReviewer",
            reviewerNote="ok",
        ),
        _Request(),
        _principal(),
        _BalanceService(),
        storage,
    )

    assert response["status"] == "SIGNED"
    assert calls[0]["storage"] is storage
    assert calls[0]["template_key"] == "consumer_withdrawal_ticket_ready"
    assert calls[0]["event_type"] == "consumer_withdrawal.ticket_ready"
    assert calls[0]["payload"]["actionUrl"].endswith("/dashboard/billing/credits")


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
    assert "consumer-withdraw-1" not in calls[0][1].body
    assert "PENDING_MANUAL_REVIEW" not in calls[0][1].body
    assert "security review" in calls[0][1].body


@pytest.mark.asyncio
async def test_consumer_withdraw_signed_schedules_ticket_ready_transaction_notification(monkeypatch) -> None:
    calls: list[dict[str, object]] = []
    storage = _Storage()
    monkeypatch.setattr(
        balance_deposit,
        "schedule_transaction_notifications",
        lambda storage_arg, **kwargs: calls.append({"storage": storage_arg, **kwargs}),
    )

    response = await balance_deposit.create_consumer_withdraw(
        ConsumerWithdrawRequest(amountUsdc=Decimal("7.50"), reason="cash out"),
        _Request(),
        "idem-consumer-withdraw-0002",
        "0xAbC",
        _SignedBalanceService(),
        storage,
    )

    assert response["status"] == "SIGNED"
    assert calls[0]["storage"] is storage
    assert calls[0]["template_key"] == "consumer_withdrawal_ticket_ready"
    assert calls[0]["payload"]["withdrawalId"] == "consumer-withdraw-signed-1"


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
    assert "provider-withdraw-1" not in calls[0][1].body
    assert "REQUESTED" not in calls[0][1].body
    assert "request has been received" in calls[0][1].body
    assert calls[0][1].payload == {
        "withdrawalId": "provider-withdraw-1",
        "amount": "9.250000",
        "currency": "USDC",
        "status": "REQUESTED",
    }


@pytest.mark.asyncio
async def test_provider_withdraw_signed_schedules_ticket_ready_transaction_notification(monkeypatch) -> None:
    calls: list[dict[str, object]] = []
    storage = _Storage()
    monkeypatch.setattr(
        balance_withdraw,
        "schedule_transaction_notifications",
        lambda storage_arg, **kwargs: calls.append({"storage": storage_arg, **kwargs}),
    )

    response = await balance_withdraw.create_provider_withdraw_intent(
        ProviderWithdrawIntentRequest(amountUsdc=Decimal("9.25")),
        _Request(),
        "idem-provider-withdraw-0002",
        "0xAbC",
        _SignedBalanceService(),
        storage,
    )

    assert response["status"] == "SIGNED"
    assert calls[0]["storage"] is storage
    assert calls[0]["template_key"] == "provider_withdrawal_ticket_ready"
    assert calls[0]["payload"]["actionUrl"].endswith("/provider/withdraw")


@pytest.mark.asyncio
async def test_complete_provider_withdrawal_schedules_transaction_notification(monkeypatch) -> None:
    calls: list[dict[str, object]] = []
    storage = _Storage()
    monkeypatch.setattr(
        balance_withdraw,
        "schedule_transaction_notifications",
        lambda storage_arg, **kwargs: calls.append({"storage": storage_arg, **kwargs}),
    )

    response = await balance_withdraw.complete_provider_withdrawal(
        "provider-complete-1",
        ProviderWithdrawCompleteRequest(txHash="0x" + "b" * 64),
        _Request(),
        "0xAbC",
        _BalanceService(),
        storage,
    )

    assert response["status"] == "COMPLETED"
    assert calls[0]["storage"] is storage
    assert calls[0]["template_key"] == "provider_withdrawal_completed"
    assert calls[0]["payload"]["txHash"] == "0x" + "b" * 64


@pytest.mark.asyncio
async def test_complete_provider_withdrawal_as_admin_schedules_transaction_notification(monkeypatch) -> None:
    calls: list[dict[str, object]] = []
    storage = _Storage()
    monkeypatch.setattr(
        balance_withdraw,
        "schedule_transaction_notifications",
        lambda storage_arg, **kwargs: calls.append({"storage": storage_arg, **kwargs}),
    )

    response = await balance_withdraw.complete_provider_withdrawal_as_admin(
        "provider-admin-complete-1",
        AdminProviderWithdrawCompleteRequest(
            ownerAddress="0xabc0000000000000000000000000000000000000",
            txHash="0x" + "b" * 64,
        ),
        _Request(),
        _principal(),
        _BalanceService(),
        storage,
    )

    assert response["status"] == "success"
    assert calls[0]["storage"] is storage
    assert calls[0]["template_key"] == "provider_withdrawal_completed"
    assert calls[0]["owner_wallet"] == "0xabc0000000000000000000000000000000000000"


@pytest.mark.asyncio
async def test_review_provider_withdrawal_as_admin_schedules_rejected_transaction_notification(monkeypatch) -> None:
    calls: list[dict[str, object]] = []
    storage = _Storage()
    monkeypatch.setattr(
        balance_withdraw,
        "schedule_transaction_notifications",
        lambda storage_arg, **kwargs: calls.append({"storage": storage_arg, **kwargs}),
    )

    response = await balance_withdraw.review_provider_withdrawal_as_admin(
        "provider-review-reject-1",
        AdminProviderWithdrawReviewRequest(
            ownerAddress="0xabc0000000000000000000000000000000000000",
            reviewDecision="reject",
            reviewerAddress="0xReviewer",
            reviewerNote="not approved",
        ),
        _Request(),
        _principal(),
        _BalanceService(),
        storage,
    )

    assert response["status"] == "REJECTED"
    assert calls[0]["storage"] is storage
    assert calls[0]["template_key"] == "provider_withdrawal_rejected"
    assert calls[0]["payload"]["status"] == "REJECTED"
