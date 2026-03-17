import asyncio
from types import SimpleNamespace

from src.domain.execution import PreparedWithdrawTicket
from src.domain.finance import BalanceLedger, RefundIntentRow, UsageLogRow
from src.domain.ledger import DepositIntentRow, WithdrawalIntentRow
from src.services.buyer.finance_service import BuyerFinanceService
from src.services.platform.finance_service import PlatformFinanceService
from src.services.provider.withdraw_service import ProviderWithdrawService


class DummyLock:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class DummyLockManager:
    def lock(self, key: str):
        _ = key
        return DummyLock()


class InMemoryBalanceRepo:
    def __init__(self):
        self.ledger = BalanceLedger()

    def read_balance_ledger(self):
        return self.ledger.model_copy(deep=True)

    def write_balance_ledger(self, ledger):
        self.ledger = ledger.model_copy(deep=True)


class InMemoryGatewayStateRepo:
    def __init__(self):
        self.deposit_rows: list[DepositIntentRow] = []
        self.refund_rows: list[RefundIntentRow] = []
        self.withdraw_rows: list[WithdrawalIntentRow] = []
        self.usage_rows = []

    def read_deposit_intents(self):
        return list(self.deposit_rows)

    def write_deposit_intents(self, rows):
        assert all(isinstance(row, DepositIntentRow) for row in rows)
        self.deposit_rows = list(rows)

    def read_refund_intents(self):
        return list(self.refund_rows)

    def write_refund_intents(self, rows, updated_at):
        _ = updated_at
        assert all(isinstance(row, RefundIntentRow) for row in rows)
        self.refund_rows = list(rows)

    def read_withdrawal_intents(self):
        return list(self.withdraw_rows)

    def write_withdrawal_intents(self, rows, updated_at):
        _ = updated_at
        assert all(isinstance(row, WithdrawalIntentRow) for row in rows)
        self.withdraw_rows = list(rows)

    def read_usage_log_rows(self):
        return list(self.usage_rows)


class InMemoryAuditRepo:
    def __init__(self):
        self.rows = []

    def append_audit_row(self, row):
        self.rows.append(row)


class InMemoryIdempotencyRepo:
    def read_idempotency_rows(self):
        return []

    def write_idempotency_rows(self, rows, updated_at):
        _ = (rows, updated_at)


class FakeStorage:
    def __init__(self):
        self.gateway_state = InMemoryGatewayStateRepo()
        self.balance = InMemoryBalanceRepo()
        self.audit = InMemoryAuditRepo()
        self.idempotency = InMemoryIdempotencyRepo()
        self.data_manager = SimpleNamespace(
            finance=SimpleNamespace(balance=self.balance),
            system=SimpleNamespace(gateway_state=self.gateway_state, idempotency=self.idempotency),
            audit=SimpleNamespace(logs=self.audit),
        )

    def get_data_manager(self):
        return self.data_manager


async def _async_none(*args, **kwargs):
    _ = (args, kwargs)
    await asyncio.sleep(0)
    return None


async def _async_true(*args, **kwargs):
    _ = (args, kwargs)
    await asyncio.sleep(0)
    return True


def _configure_buyer_service(service: BuyerFinanceService) -> None:
    service._get_redis_client = _async_none
    service._check_idempotency_redis = _async_none
    service._start_idempotency_redis = _async_true
    service._complete_idempotency_redis = _async_none
    service._enforce_owner_write_rate_limit = _async_none


def _configure_withdraw_service(service: ProviderWithdrawService) -> None:
    service._get_redis_client = _async_none
    service._check_idempotency_redis = _async_none
    service._start_idempotency_redis = _async_true
    service._complete_idempotency_redis = _async_none
    service._enforce_owner_write_rate_limit = _async_none
    service._prepare_withdraw_ticket = lambda **kwargs: PreparedWithdrawTicket(
        requires_manual_review=False,
        amount_wei=12000000,
        fee_wei=0,
        nonce=7,
        chain_id=31337,
        deadline=9999999999,
        signature="sig-1",
        signer_address="0xsigner",
        ticket={
            "amount": "12000000",
            "fee": "0",
            "nonce": 7,
            "deadline": 9999999999,
            "signature": "sig-1",
            "chainId": 31337,
            "contractAddress": "0xrouter",
        },
    )


def test_consumer_finance_deposit_flow_uses_typed_rows() -> None:
    storage = FakeStorage()
    service = BuyerFinanceService(storage, DummyLockManager())
    _configure_buyer_service(service)

    registered = asyncio.run(
        service.register_deposit_intent(
            {"txHash": "0x" + "1" * 64, "amountUsdc": "15"},
            "0xabc",
            "deposit-intent-key-0001",
        )
    )

    assert registered["ownerAddress"] == "0xabc"
    assert len(storage.gateway_state.deposit_rows) == 1
    assert isinstance(storage.gateway_state.deposit_rows[0], DepositIntentRow)

    confirmed = asyncio.run(
        service.confirm_deposit_intent(
            owner_wallet="0xabc",
            deposit_intent_id=storage.gateway_state.deposit_rows[0].id,
            event_key="evt-1",
            confirmations=3,
        )
    )
    assert confirmed["status"] == "CONFIRMED"
    assert storage.gateway_state.deposit_rows[0].event_key == "evt-1"


def test_consumer_finance_refund_flow_uses_typed_rows() -> None:
    storage = FakeStorage()
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = 100.0
    storage.gateway_state.usage_rows = [
        UsageLogRow(
            id="usage-1",
            ts=1710000000,
            buyerAddress="0xabc",
            status="succeeded",
            originRequestId="req-1",
            originTxHash="",
            totalCharge="30.0",
        )
    ]
    service = BuyerFinanceService(storage, DummyLockManager())
    _configure_buyer_service(service)

    created = asyncio.run(
        service.process_refund_intent(
            {
                "amountUsdc": 20,
                "originRequestId": "req-1",
                "refundType": "SYSTEM_FAILURE",
            },
            "0xabc",
            "refund-intent-key-0001",
        )
    )
    assert created["status"] == "PENDING"
    assert len(storage.gateway_state.refund_rows) == 1
    assert isinstance(storage.gateway_state.refund_rows[0], RefundIntentRow)

    completed = asyncio.run(
        service.complete_refund_intent(
            "0xabc",
            storage.gateway_state.refund_rows[0].id,
            "0x" + "2" * 64,
        )
    )
    assert completed["status"] == "COMPLETED"
    assert storage.gateway_state.refund_rows[0].tx_hash == "0x" + "2" * 64


def test_provider_withdraw_flow_uses_typed_rows() -> None:
    storage = FakeStorage()
    storage.balance.ledger.ensure_provider_wallet("0xdef").available_balance = 50.0
    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)

    created = asyncio.run(
        service.create_provider_withdraw_intent(
            {"amountUsdc": 12},
            "0xdef",
            "withdraw-intent-key-0001",
        )
    )
    assert created["status"] == "APPROVED_AUTO"
    assert len(storage.gateway_state.withdraw_rows) == 1
    assert isinstance(storage.gateway_state.withdraw_rows[0], WithdrawalIntentRow)

    completed = asyncio.run(
        service.complete_provider_withdrawal(
            "0xdef",
            storage.gateway_state.withdraw_rows[0].id,
            "0x" + "3" * 64,
        )
    )
    assert completed["status"] == "COMPLETED"
    assert storage.gateway_state.withdraw_rows[0].tx_hash == "0x" + "3" * 64


def test_owner_balance_summary_uses_consumer_provider_fields() -> None:
    storage = FakeStorage()
    consumer_wallet = storage.balance.ledger.ensure_consumer_wallet("0xabc")
    provider_wallet = storage.balance.ledger.ensure_provider_wallet("0xabc")
    consumer_wallet.available_balance = 12.5
    consumer_wallet.pending_balance = 1.25
    consumer_wallet.frozen_balance = 0.75
    provider_wallet.available_balance = 9.5
    provider_wallet.pending_balance = 2.0
    storage.balance.ledger.platform.fee_accrued = 0.4
    storage.balance.ledger.updated_at = "2026-03-17 12:00:00"

    service = PlatformFinanceService(storage, DummyLockManager())

    balance = asyncio.run(service.get_balance("0xabc"))

    assert balance == {
        "ownerAddress": "0xabc",
        "consumerAvailableBalance": 12.5,
        "consumerPendingBalance": 1.25,
        "consumerFrozenBalance": 0.75,
        "providerReceivableBalance": 9.5,
        "providerLockedBalance": 2.0,
        "platformFeeAccrued": 0.4,
        "updatedAt": "2026-03-17 12:00:00",
    }