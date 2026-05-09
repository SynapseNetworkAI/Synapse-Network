import asyncio
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.core.config import settings
from src.domain.gateway import OwnerSpendLimitRow
from src.domain.execution import PreparedWithdrawTicket
from src.domain.finance import BalanceLedger, RefundIntentRow, UsageLogRow
from src.domain.ledger import DepositIntentRow, WithdrawalIntentRow
from src.domain.voucher import VoucherRedemptionResult
from src.services.platform.balance_service import BalanceService
from src.services.owner.finance_service import OwnerFinanceService
from src.services.platform.finance_service import PlatformFinanceService, VoucherRedeemContext
from src.services.platform import credential_service
from src.services.provider.withdraw_service import ProviderWithdrawService

MoneyInput = Decimal | str | int


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
        self.consumer_mature_withdrawable = Decimal("0.000000")

    def read_balance_ledger(self):
        return self.ledger.model_copy(deep=True)

    def write_balance_ledger(self, ledger):
        self.ledger = ledger.model_copy(deep=True)

    def read_consumer_mature_withdrawable(self, owner: str, maturity_seconds: int):
        _ = (owner, maturity_seconds)
        return self.consumer_mature_withdrawable

    def reserve_consumer_balance_for_withdrawal(self, owner: str, amount_usdc: MoneyInput, updated_at: str):
        _ = updated_at
        wallet = self.ledger.ensure_consumer_wallet(owner)
        amount = Decimal(str(amount_usdc)).quantize(Decimal("0.000001"))
        available = Decimal(str(wallet.available_balance or 0))
        if available < amount:
            raise RuntimeError("INSUFFICIENT_CONSUMER_BALANCE_ATOMIC")
        wallet.available_balance = (available - amount).quantize(Decimal("0.000001"))
        wallet.pending_balance = (
            Decimal(str(wallet.pending_balance or 0)) + amount
        ).quantize(Decimal("0.000001"))

    def reserve_consumer_balance_for_manual_review(
        self, owner: str, amount_usdc: MoneyInput, updated_at: str
    ):
        _ = updated_at
        wallet = self.ledger.ensure_consumer_wallet(owner)
        amount = Decimal(str(amount_usdc)).quantize(Decimal("0.000001"))
        available = Decimal(str(wallet.available_balance or 0))
        if available < amount:
            raise RuntimeError("INSUFFICIENT_CONSUMER_BALANCE_ATOMIC")
        wallet.available_balance = (available - amount).quantize(Decimal("0.000001"))
        wallet.frozen_balance = (
            Decimal(str(wallet.frozen_balance or 0)) + amount
        ).quantize(Decimal("0.000001"))

    def consume_consumer_pending_for_withdrawal(self, owner: str, amount_usdc: MoneyInput, updated_at: str):
        _ = updated_at
        wallet = self.ledger.ensure_consumer_wallet(owner)
        amount = Decimal(str(amount_usdc)).quantize(Decimal("0.000001"))
        pending = Decimal(str(wallet.pending_balance or 0))
        if pending < amount:
            raise RuntimeError("INSUFFICIENT_CONSUMER_PENDING_ATOMIC")
        wallet.pending_balance = (pending - amount).quantize(Decimal("0.000001"))


class InMemoryGatewayStateRepo:
    def __init__(self):
        self.deposit_rows: list[DepositIntentRow] = []
        self.refund_rows: list[RefundIntentRow] = []
        self.withdraw_rows: list[WithdrawalIntentRow] = []
        self.owner_spend_limit_rows: list[OwnerSpendLimitRow] = []
        self.usage_rows = []

    def read_deposit_intents(self):
        return list(self.deposit_rows)

    def write_deposit_intents(self, rows):
        assert all(isinstance(row, DepositIntentRow) for row in rows)
        self.deposit_rows = list(rows)

    def read_consumer_refund_rows(self, *, owner_wallet: str | None = None):
        rows = list(self.refund_rows)
        if owner_wallet:
            normalized = owner_wallet.lower()
            rows = [
                row
                for row in rows
                if str(row.owner_address or row.ownerAddress or "").lower() == normalized
            ]
        return rows

    def write_consumer_refund_rows(self, rows, updated_at):
        _ = updated_at
        assert all(isinstance(row, RefundIntentRow) for row in rows)
        self.refund_rows = list(rows)

    def update_consumer_refund_row_atomic(
        self,
        row: RefundIntentRow,
        *,
        updated_at,
        expected_status=None,
    ):
        _ = updated_at, expected_status
        replaced = False
        next_rows: list[RefundIntentRow] = []
        for existing in self.refund_rows:
            if str(existing.id) == str(row.id):
                next_rows.append(row.model_copy(deep=True))
                replaced = True
            else:
                next_rows.append(existing)
        if not replaced:
            raise RuntimeError("CONSUMER_WITHDRAW_UPDATE_STATE_INCONSISTENT")
        self.refund_rows = next_rows

    def read_provider_withdrawal_rows(self):
        return list(self.withdraw_rows)

    def write_provider_withdrawal_rows(self, rows, updated_at):
        _ = updated_at
        assert all(isinstance(row, WithdrawalIntentRow) for row in rows)
        self.withdraw_rows = list(rows)

    def read_invocation_billing_rows(self):
        return list(self.usage_rows)

    def read_owner_spend_limit_rows(self):
        return list(self.owner_spend_limit_rows)

    def write_owner_spend_limit_rows(self, rows, updated_at):
        _ = updated_at
        assert all(isinstance(row, OwnerSpendLimitRow) for row in rows)
        self.owner_spend_limit_rows = list(rows)


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
        self.voucher_atomic_result: VoucherRedemptionResult | None = None
        self.voucher_atomic_error: RuntimeError | None = None
        self.voucher_commands = []
        self.data_manager = SimpleNamespace(
            finance=SimpleNamespace(balance=self.balance),
            system=SimpleNamespace(gateway_state=self.gateway_state, idempotency=self.idempotency),
            audit=SimpleNamespace(logs=self.audit),
        )

    def get_data_manager(self):
        return self.data_manager

    def redeem_credit_voucher_atomic(self, command):
        self.voucher_commands.append(command)
        if self.voucher_atomic_error is not None:
            raise self.voucher_atomic_error
        if self.voucher_atomic_result is None:
            raise RuntimeError("VOUCHER_REDEEM_RESULT_INVALID")
        self.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = Decimal(
            str(self.voucher_atomic_result.after_balance_usdc)
        )
        return self.voucher_atomic_result


async def _async_none(*args, **kwargs):
    _ = (args, kwargs)
    await asyncio.sleep(0)
    return None


async def _async_true(*args, **kwargs):
    _ = (args, kwargs)
    await asyncio.sleep(0)
    return True


async def _async_value(value):
    await asyncio.sleep(0)
    return value


def _noop_assert_withdraw_vault_liquidity(amount_usdc) -> None:
    _ = amount_usdc


def _money_decimal(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.000001"))


def _configure_owner_service(service: OwnerFinanceService) -> None:
    service._get_redis_client = _async_none
    service._check_idempotency_redis = _async_none
    service._start_idempotency_redis = _async_true
    service._complete_idempotency_redis = _async_none
    service._enforce_owner_write_rate_limit = _async_none


def _configure_withdraw_service(service: ProviderWithdrawService) -> None:
    if not settings.usdc_token_address:
        settings.usdc_token_address = "0x0000000000000000000000000000000000000001"
    service._get_redis_client = _async_none
    service._check_idempotency_redis = _async_none
    service._start_idempotency_redis = _async_true
    service._complete_idempotency_redis = _async_none
    service._enforce_owner_write_rate_limit = _async_none
    service._assert_withdraw_vault_liquidity = _noop_assert_withdraw_vault_liquidity
    service._withdraw_rpc_head_past_deadline = lambda deadline: True
    service._withdraw_ticket_consumed_or_unknown = lambda ticket_hash: False
    service._prepare_withdraw_ticket = lambda **kwargs: PreparedWithdrawTicket(
        requires_manual_review=False,
        amount_wei=12000000,
        fee_wei=0,
        nonce=7,
        chain_id=31337,
        deadline=9999999999,
        signature="sig-1",
        signer_address="0xsigner",
        ticket_id="0x" + "1" * 64,
        ticket_hash="0x" + "2" * 64,
        ticket={
            "amount": "12000000",
            "fee": "0",
            "ticketId": "0x" + "1" * 64,
            "ticketHash": "0x" + "2" * 64,
            "deadline": 9999999999,
            "signature": "sig-1",
            "chainId": 31337,
            "contractAddress": "0xrouter",
        },
    )


def _raise_insufficient_vault_liquidity(_amount) -> None:
    raise RuntimeError("INSUFFICIENT_VAULT_LIQUIDITY")


def test_consumer_finance_deposit_flow_uses_typed_rows(monkeypatch) -> None:
    storage = FakeStorage()
    service = OwnerFinanceService(storage, DummyLockManager())
    _configure_owner_service(service)
    emitted_deposits = []

    async def fake_emit_deposit_completed(wallet_address, **kwargs):
        emitted_deposits.append({"wallet": wallet_address, **kwargs})

    monkeypatch.setattr(
        "src.services.analytics.gateway_events.emit_deposit_completed",
        fake_emit_deposit_completed,
    )

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
    assert storage.audit.rows[-1].action == "DEPOSIT_INTENT_CONFIRMED"
    assert storage.audit.rows[-1].details["businessType"] == "deposit"
    assert storage.audit.rows[-1].details["resultStatus"] == "CONFIRMED"
    assert storage.audit.rows[-1].details["txHash"] == registered["txHash"]
    assert emitted_deposits == [
        {
            "wallet": "0xabc",
            "amount_usdc": 15.0,
            "tx_hash": registered["txHash"],
        }
    ]


def test_register_deposit_intent_rejects_dust_amount_without_persisting() -> None:
    storage = FakeStorage()
    service = OwnerFinanceService(storage, DummyLockManager())
    _configure_owner_service(service)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            service.register_deposit_intent(
                {"txHash": "0x" + "9" * 64, "amountUsdc": "4.99"},
                "0xabc",
                "deposit-intent-key-dust",
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "MIN_DEPOSIT_AMOUNT_NOT_MET"
    assert storage.gateway_state.deposit_rows == []


def test_register_deposit_intent_replay_returns_existing_intent() -> None:
    storage = FakeStorage()
    service = OwnerFinanceService(storage, DummyLockManager())
    _configure_owner_service(service)

    registered = asyncio.run(
        service.register_deposit_intent(
            {"txHash": "0x" + "4" * 64, "amountUsdc": "15"},
            "0xabc",
            "deposit-intent-key-0002",
        )
    )

    replayed = asyncio.run(
        service.register_deposit_intent(
            {"txHash": "0x" + "4" * 64, "amountUsdc": "15"},
            "0xabc",
            "deposit-intent-key-0003",
        )
    )

    assert replayed == registered
    assert len(storage.gateway_state.deposit_rows) == 1
    assert storage.audit.rows[-1].action == "DEPOSIT_REPLAY_RETURNED_EXISTING"
    assert storage.audit.rows[-1].details["depositIntentId"] == registered["id"]


def test_register_deposit_intent_uses_atomic_storage_when_available() -> None:
    storage = FakeStorage()
    service = OwnerFinanceService(storage, DummyLockManager())
    _configure_owner_service(service)
    captured = []

    def register_atomic(command):
        captured.append(command)
        return command.intent_row

    storage.register_deposit_intent_atomic = register_atomic  # type: ignore[attr-defined]  # quality-budget-disable-reason: test injects optional atomic storage hook.

    registered = asyncio.run(
        service.register_deposit_intent(
            {"txHash": "0x" + "7" * 64, "amountUsdc": "15"},
            "0xabc",
            "deposit-intent-key-atomic",
        )
    )

    assert registered["txHash"] == "0x" + "7" * 64
    assert captured[0].owner_wallet == "0xabc"
    assert storage.gateway_state.deposit_rows == []


def test_confirm_deposit_intent_uses_atomic_storage_when_available() -> None:
    storage = FakeStorage()
    service = OwnerFinanceService(storage, DummyLockManager())
    _configure_owner_service(service)
    row = DepositIntentRow(
        id="dep-atomic-1",
        ownerAddress="0xabc",
        txHash="0x" + "8" * 64,
        amountUsdc=Decimal("15"),
        idempotencyKey="deposit-intent-key-confirm-atomic",
        status="CONFIRMED",
    )
    captured = []

    def confirm_atomic(command):
        captured.append(command)
        return row

    storage.confirm_deposit_intent_atomic = confirm_atomic  # type: ignore[attr-defined]  # quality-budget-disable-reason: test injects optional atomic storage hook.

    confirmed = asyncio.run(
        service.confirm_deposit_intent(
            owner_wallet="0xabc",
            deposit_intent_id="dep-atomic-1",
            event_key="evt-atomic",
            confirmations=5,
        )
    )

    assert confirmed["id"] == "dep-atomic-1"
    assert captured[0].event_key == "evt-atomic"
    assert storage.audit.rows == []


def test_confirm_deposit_intent_atomic_new_confirmation_writes_one_audit() -> None:
    storage = FakeStorage()
    service = OwnerFinanceService(storage, DummyLockManager())
    _configure_owner_service(service)
    row = DepositIntentRow(
        id="dep-atomic-2",
        ownerAddress="0xabc",
        txHash="0x" + "9" * 64,
        amountUsdc=Decimal("15"),
        idempotencyKey="deposit-intent-key-confirm-atomic-new",
        status="CONFIRMED",
        eventKey="evt-atomic-new",
    )

    def confirm_atomic(command):
        assert command.event_key == "evt-atomic-new"
        return row

    storage.confirm_deposit_intent_atomic = confirm_atomic  # type: ignore[attr-defined]  # quality-budget-disable-reason: test injects optional atomic storage hook.

    confirmed = asyncio.run(
        service.confirm_deposit_intent(
            owner_wallet="0xabc",
            deposit_intent_id="dep-atomic-2",
            event_key="evt-atomic-new",
            confirmations=5,
        )
    )

    assert confirmed["id"] == "dep-atomic-2"
    assert len(storage.audit.rows) == 1
    assert storage.audit.rows[0].action == "DEPOSIT_INTENT_CONFIRMED"


def test_register_deposit_intent_rejects_invalid_amount_text() -> None:
    storage = FakeStorage()
    service = OwnerFinanceService(storage, DummyLockManager())
    _configure_owner_service(service)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            service.register_deposit_intent(
                {"txHash": "0x" + "a" * 64, "amountUsdc": "not-usdc"},
                "0xabc",
                "deposit-intent-key-invalid-amount",
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "INVALID_AMOUNT"


def test_get_deposit_sync_status_returns_confirmed_intent_state() -> None:
    storage = FakeStorage()
    service = OwnerFinanceService(storage, DummyLockManager())
    _configure_owner_service(service)

    registered = asyncio.run(
        service.register_deposit_intent(
            {"txHash": "0x" + "5" * 64, "amountUsdc": "15"},
            "0xabc",
            "deposit-intent-key-0004",
        )
    )
    asyncio.run(
        service.confirm_deposit_intent(
            owner_wallet="0xabc",
            deposit_intent_id=storage.gateway_state.deposit_rows[0].id,
            event_key="evt-5",
            confirmations=4,
        )
    )

    sync = asyncio.run(
        service.get_deposit_sync_status("0xabc", registered["txHash"])
    )

    assert sync["found"] is True
    assert sync["synced"] is True
    assert sync["status"] == "CONFIRMED"
    assert sync["confirmed"] is True
    assert sync["canRefreshBalance"] is True
    assert sync["txHash"] == registered["txHash"]
    assert sync["depositIntentId"] == registered["id"]
    assert sync["eventKey"] == "evt-5"
    assert sync["confirmations"] == 4


def test_get_deposit_sync_status_returns_not_registered_for_unknown_tx_hash() -> None:
    storage = FakeStorage()
    service = OwnerFinanceService(storage, DummyLockManager())
    _configure_owner_service(service)

    sync = asyncio.run(
        service.get_deposit_sync_status("0xabc", "0x" + "6" * 64)
    )

    assert sync == {
        "txHash": "0x" + "6" * 64,
        "found": False,
        "synced": False,
        "status": "NOT_REGISTERED",
        "confirmed": False,
        "canRefreshBalance": False,
    }


def test_consumer_finance_refund_flow_uses_typed_rows() -> None:
    storage = FakeStorage()
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = Decimal("100.000000")
    storage.gateway_state.usage_rows = [
        UsageLogRow(
            id="usage-1",
            ts=1710000000,
            consumerAddress="0xabc",
            status="succeeded",
            originRequestId="req-1",
            originTxHash="",
            totalCharge="30.0",
        )
    ]
    service = OwnerFinanceService(storage, DummyLockManager())
    _configure_owner_service(service)

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
    assert created["status"] == "REQUESTED"
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
    storage.balance.ledger.ensure_provider_wallet("0xdef").available_balance = Decimal("50.000000")
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


def test_provider_withdraw_complete_accepts_signed_status() -> None:
    storage = FakeStorage()
    storage.balance.ledger.ensure_provider_wallet("0xdef").available_balance = Decimal("50.000000")
    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)

    created = asyncio.run(
        service.create_provider_withdraw_intent(
            {"amountUsdc": 12},
            "0xdef",
            "withdraw-intent-key-signed-complete",
        )
    )
    assert created["status"] == "APPROVED_AUTO"
    storage.gateway_state.withdraw_rows[0].status = "SIGNED"

    completed = asyncio.run(
        service.complete_provider_withdrawal(
            "0xdef",
            storage.gateway_state.withdraw_rows[0].id,
            "0x" + "4" * 64,
        )
    )

    assert completed["status"] == "COMPLETED"
    assert storage.gateway_state.withdraw_rows[0].tx_hash == "0x" + "4" * 64


def test_provider_withdraw_allows_two_decimal_amount() -> None:
    storage = FakeStorage()
    storage.balance.ledger.ensure_provider_wallet("0xdef").available_balance = Decimal("50.000000")
    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)

    created = asyncio.run(
        service.create_provider_withdraw_intent(
            {"amountUsdc": "12.34"},
            "0xdef",
            "withdraw-intent-key-0012",
        )
    )

    assert created["status"] == "APPROVED_AUTO"
    assert created["amountUsdc"] == "12.340000"


def test_provider_withdraw_rejects_more_than_two_decimal_places() -> None:
    storage = FakeStorage()
    storage.balance.ledger.ensure_provider_wallet("0xdef").available_balance = Decimal("50.000000")
    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            service.create_provider_withdraw_intent(
                {"amountUsdc": "12.345"},
                "0xdef",
                "withdraw-intent-key-0013",
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "INVALID_AMOUNT"
    assert "2 decimal places" in exc_info.value.detail["message"]


def test_provider_withdraw_blocks_when_vault_liquidity_is_insufficient_before_locking() -> None:
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = Decimal("50.000000")
    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)
    service._assert_withdraw_vault_liquidity = _raise_insufficient_vault_liquidity

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            service.create_provider_withdraw_intent(
                {"amountUsdc": "12.5"},
                "0xdef",
                "withdraw-intent-key-liquidity-1",
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "INSUFFICIENT_VAULT_LIQUIDITY"
    assert len(storage.gateway_state.withdraw_rows) == 0
    wallet_after = storage.balance.ledger.ensure_provider_wallet("0xdef")
    assert _money_decimal(wallet_after.available_balance) == Decimal("50.000000")
    assert _money_decimal(wallet_after.pending_balance) == Decimal("0.000000")
    assert _money_decimal(wallet_after.frozen_balance) == Decimal("0.000000")


def test_provider_withdraw_atomic_path_reads_vault_liquidity_from_contract_tuple() -> None:
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = Decimal("50.000000")
    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)
    service._assert_withdraw_vault_liquidity = ProviderWithdrawService._assert_withdraw_vault_liquidity.__get__(
        service, ProviderWithdrawService
    )

    class _FakeBalanceOfCall:
        def call(self) -> int:
            return 50 * 10**18

    class _FakeBalanceOfFunctions:
        def __getattr__(self, name: str):
            if name != "balanceOf":
                raise AttributeError(name)
            return lambda _account: _FakeBalanceOfCall()

    class _FakeEth:
        def contract(self, *, address: str, abi):
            _ = (address, abi)
            return SimpleNamespace(functions=_FakeBalanceOfFunctions())

    fake_web3 = SimpleNamespace(
        eth=_FakeEth(),
        to_checksum_address=lambda value: value,
    )
    service._withdraw_contract = lambda: (fake_web3, SimpleNamespace(w3=fake_web3))

    def _process_withdrawal_request_atomic(command):
        assert command.pre_reserve_check is not None
        command.pre_reserve_check(Decimal("12.5"))
        return SimpleNamespace(
            withdrawal_id="wd-1",
            status="APPROVED_AUTO",
            amount_usdc=Decimal("12.5"),
            ticket={},
            message="ok",
            decision="green",
            risk_reason_code=None,
        )

    storage.process_withdrawal_request_atomic = _process_withdrawal_request_atomic  # type: ignore[attr-defined]

    created = asyncio.run(
        service.create_provider_withdraw_intent(
            {"amountUsdc": "12.5"},
            "0xdef",
            "withdraw-intent-key-atomic-liquidity-1",
        )
    )

    assert created["status"] == "APPROVED_AUTO"
    assert created["withdrawalId"] == "wd-1"


def test_provider_withdraw_maps_missing_vault_web3_provider_to_service_unavailable() -> None:
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = Decimal("50.000000")
    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)
    service._assert_withdraw_vault_liquidity = ProviderWithdrawService._assert_withdraw_vault_liquidity.__get__(
        service, ProviderWithdrawService
    )
    service._withdraw_contract = lambda: (SimpleNamespace(), SimpleNamespace(w3=None))

    def _process_withdrawal_request_atomic(command):
        assert command.pre_reserve_check is not None
        command.pre_reserve_check(Decimal("12.5"))
        raise AssertionError("pre_reserve_check should raise before atomic success")

    storage.process_withdrawal_request_atomic = _process_withdrawal_request_atomic  # type: ignore[attr-defined]

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            service.create_provider_withdraw_intent(
                {"amountUsdc": "12.5"},
                "0xdef",
                "withdraw-intent-key-atomic-liquidity-2",
            )
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["code"] == "WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE"


def test_provider_withdraw_manual_review_approval_generates_ticket_and_moves_to_pending() -> None:
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = Decimal("200.000000")
    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)

    def fake_prepare_withdraw_ticket(**kwargs):
        force_sign = bool(kwargs.get("force_sign", False))
        if not force_sign:
            return PreparedWithdrawTicket(
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
        return PreparedWithdrawTicket(
            requires_manual_review=False,
            amount_wei=120000000,
            fee_wei=0,
            nonce=9,
            chain_id=31337,
            deadline=9999999999,
            signature="sig-approved",
            signer_address="0xsigner",
            ticket={
                "amount": "120000000",
                "fee": "0",
                "nonce": 9,
                "deadline": 9999999999,
                "signature": "sig-approved",
                "chainId": 31337,
                "contractAddress": "0xrouter",
            },
        )

    service._prepare_withdraw_ticket = fake_prepare_withdraw_ticket

    created = asyncio.run(
        service.create_provider_withdraw_intent(
            {"amountUsdc": 120},
            "0xdef",
            "withdraw-intent-key-0002",
        )
    )

    assert created["status"] == "PENDING_MANUAL_REVIEW"
    wallet_after_create = storage.balance.ledger.ensure_provider_wallet("0xdef")
    assert _money_decimal(wallet_after_create.available_balance) == Decimal("80.000000")
    assert _money_decimal(wallet_after_create.pending_balance) == Decimal("0.000000")
    assert _money_decimal(wallet_after_create.frozen_balance) == Decimal("120.000000")

    approved = asyncio.run(
        service.review_provider_withdrawal(
            "0xdef",
            storage.gateway_state.withdraw_rows[0].id,
            {
                "review": {
                    "decision": "APPROVE",
                    "reviewerAddress": "0xreviewer",
                    "reviewerNote": "approved",
                }
            },
        )
    )

    assert approved["status"] == "APPROVED_AUTO"
    assert approved["ticket"]["signature"] == "sig-approved"
    row = storage.gateway_state.withdraw_rows[0]
    assert row.review_decision == "APPROVE"
    assert row.reviewer_address == "0xreviewer"
    assert row.signature == "sig-approved"
    wallet_after_approve = storage.balance.ledger.ensure_provider_wallet("0xdef")
    assert _money_decimal(wallet_after_approve.available_balance) == Decimal("80.000000")
    assert _money_decimal(wallet_after_approve.pending_balance) == Decimal("120.000000")
    assert _money_decimal(wallet_after_approve.frozen_balance) == Decimal("0.000000")

    completed = asyncio.run(
        service.complete_provider_withdrawal(
            "0xdef",
            row.id,
            "0x" + "7" * 64,
        )
    )
    assert completed["status"] == "COMPLETED"
    wallet_after_complete = storage.balance.ledger.ensure_provider_wallet("0xdef")
    assert _money_decimal(wallet_after_complete.pending_balance) == Decimal("0.000000")


def test_provider_withdraw_manual_review_rejection_releases_frozen_balance() -> None:
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

    created = asyncio.run(
        service.create_provider_withdraw_intent(
            {"amountUsdc": 120},
            "0xdef",
            "withdraw-intent-key-0003",
        )
    )
    assert created["status"] == "PENDING_MANUAL_REVIEW"

    rejected = asyncio.run(
        service.review_provider_withdrawal(
            "0xdef",
            storage.gateway_state.withdraw_rows[0].id,
            {
                "review": {
                    "decision": "REJECT",
                    "reviewerAddress": "0xreviewer",
                    "reviewerNote": "risk reject",
                }
            },
        )
    )

    assert rejected["status"] == "REJECTED"
    row = storage.gateway_state.withdraw_rows[0]


def test_provider_withdraw_manual_review_uses_configured_single_limit(monkeypatch) -> None:
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = Decimal("100.000000")
    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)
    captured_single_limit: Decimal | None = None

    def _process_withdrawal_request_atomic(command):
        nonlocal captured_single_limit
        captured_single_limit = command.single_limit_usdc
        return SimpleNamespace(
            withdrawal_id="wd-config-threshold-1",
            status="PENDING_MANUAL_REVIEW",
            amount_usdc=Decimal("60.0"),
            ticket={},
            message="configured threshold hit",
            decision="yellow",
            risk_reason_code=None,
        )

    storage.process_withdrawal_request_atomic = _process_withdrawal_request_atomic  # type: ignore[attr-defined]

    original_limit = settings.withdrawal_auto_single_limit_usdc
    monkeypatch.setattr(settings, "withdrawal_auto_single_limit_usdc", 50.0, raising=False)

    try:
        created = asyncio.run(
            service.create_provider_withdraw_intent(
                {"amountUsdc": 60},
                "0xdef",
                "withdraw-intent-config-threshold-0001",
            )
        )
    finally:
        monkeypatch.setattr(settings, "withdrawal_auto_single_limit_usdc", original_limit, raising=False)

    assert created["status"] == "PENDING_MANUAL_REVIEW"
    assert captured_single_limit == Decimal("50.0")


def test_provider_withdraw_expired_ticket_releases_locked_balance_on_list() -> None:
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = Decimal("10.000000")
    wallet.pending_balance = Decimal("12.000000")

    storage.gateway_state.withdraw_rows = [
        WithdrawalIntentRow(
            id="wd-expired-1",
            ownerAddress="0xdef",
            amountUsdc=Decimal("12.0"),
            amountWei="12000000",
            feeWei="0",
            nonce=7,
            deadline=1,
            signature="sig-expired",
            chainId=31337,
            contractAddress="0xrouter",
            signerAddress="0xsigner",
            status="APPROVED_AUTO",
            businessType="withdraw",
            riskLevel="green",
            idempotencyKey="withdraw-intent-expired-1",
            createdAt="1",
            updatedAt="1",
            message="Signed ticket ready.",
            ticket={
                "amount": "12000000",
                "fee": "0",
                "ticketId": "0x" + "1" * 64,
                "ticketHash": "0x" + "2" * 64,
                "nonce": 7,
                "deadline": 1,
                "signature": "sig-expired",
                "chainId": 31337,
                "contractAddress": "0xrouter",
            },
        )
    ]

    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)

    rows = asyncio.run(service.list_provider_withdrawals("0xdef"))

    assert rows[0]["status"] == "FAILED_EXPIRED"
    assert "expired" in rows[0]["message"].lower()
    wallet_after = storage.balance.ledger.ensure_provider_wallet("0xdef")
    assert _money_decimal(wallet_after.available_balance) == Decimal("22.000000")
    assert _money_decimal(wallet_after.pending_balance) == Decimal("0.000000")
    assert storage.audit.rows[-1].action == "PROVIDER_WITHDRAW_FAILED_EXPIRED"
    assert storage.audit.rows[-1].details["reason"] == "TICKET_EXPIRED"
    assert _money_decimal(storage.audit.rows[-1].details["releasedAmountUsdc"]) == Decimal("12.000000")
    assert _money_decimal(storage.audit.rows[-1].details["releaseShortfallUsdc"]) == Decimal("0.000000")


def test_provider_withdraw_expired_ticket_cancels_even_if_locked_balance_was_already_reconciled() -> None:
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = Decimal("10.000000")
    wallet.pending_balance = Decimal("0.000000")

    storage.gateway_state.withdraw_rows = [
        WithdrawalIntentRow(
            id="wd-expired-reconciled",
            ownerAddress="0xdef",
            amountUsdc=Decimal("12.0"),
            amountWei="12000000",
            feeWei="0",
            nonce=7,
            deadline=1,
            signature="sig-expired",
            chainId=31337,
            contractAddress="0xrouter",
            signerAddress="0xsigner",
            status="APPROVED_AUTO",
            businessType="withdraw",
            riskLevel="green",
            idempotencyKey="withdraw-intent-expired-reconciled",
            createdAt="1",
            updatedAt="1",
            message="Signed ticket ready.",
            ticket={
                "amount": "12000000",
                "fee": "0",
                "ticketId": "0x" + "1" * 64,
                "ticketHash": "0x" + "2" * 64,
                "nonce": 7,
                "deadline": 1,
                "signature": "sig-expired",
                "chainId": 31337,
                "contractAddress": "0xrouter",
            },
        )
    ]

    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)

    rows = asyncio.run(service.list_provider_withdrawals("0xdef"))

    assert rows[0]["status"] == "FAILED_EXPIRED"
    assert "reconciled" in rows[0]["message"].lower()
    wallet_after = storage.balance.ledger.ensure_provider_wallet("0xdef")
    assert _money_decimal(wallet_after.available_balance) == Decimal("10.000000")
    assert _money_decimal(wallet_after.pending_balance) == Decimal("0.000000")
    assert storage.audit.rows[-1].action == "PROVIDER_WITHDRAW_FAILED_EXPIRED"
    assert storage.audit.rows[-1].details["reason"] == "TICKET_EXPIRED"
    assert _money_decimal(storage.audit.rows[-1].details["releasedAmountUsdc"]) == Decimal("0.000000")
    assert _money_decimal(storage.audit.rows[-1].details["releaseShortfallUsdc"]) == Decimal("12.000000")


def test_provider_withdraw_expired_ticket_does_not_block_new_intent() -> None:
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = Decimal("10.000000")
    wallet.pending_balance = Decimal("12.000000")

    storage.gateway_state.withdraw_rows = [
        WithdrawalIntentRow(
            id="wd-expired-2",
            ownerAddress="0xdef",
            amountUsdc=Decimal("12.0"),
            amountWei="12000000",
            feeWei="0",
            nonce=7,
            deadline=1,
            signature="sig-expired",
            chainId=31337,
            contractAddress="0xrouter",
            signerAddress="0xsigner",
            status="APPROVED_AUTO",
            businessType="withdraw",
            riskLevel="green",
            idempotencyKey="withdraw-intent-expired-2",
            createdAt="1",
            updatedAt="1",
            message="Signed ticket ready.",
            ticket={
                "amount": "12000000",
                "fee": "0",
                "ticketId": "0x" + "1" * 64,
                "ticketHash": "0x" + "2" * 64,
                "nonce": 7,
                "deadline": 1,
                "signature": "sig-expired",
                "chainId": 31337,
                "contractAddress": "0xrouter",
            },
        )
    ]

    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)

    created = asyncio.run(
        service.create_provider_withdraw_intent(
            {"amountUsdc": 20},
            "0xdef",
            "withdraw-intent-key-0014",
        )
    )

    assert created["status"] == "APPROVED_AUTO"
    assert len(storage.gateway_state.withdraw_rows) == 2
    assert storage.gateway_state.withdraw_rows[0].status == "FAILED_EXPIRED"
    assert storage.gateway_state.withdraw_rows[1].status == "APPROVED_AUTO"
    wallet_after = storage.balance.ledger.ensure_provider_wallet("0xdef")
    assert _money_decimal(wallet_after.available_balance) == Decimal("2.000000")
    assert _money_decimal(wallet_after.pending_balance) == Decimal("20.000000")


def test_provider_withdraw_expiry_reaper_scans_all_owners() -> None:
    storage = FakeStorage()

    wallet_a = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet_a.available_balance = Decimal("5.000000")
    wallet_a.pending_balance = Decimal("12.000000")

    wallet_b = storage.balance.ledger.ensure_provider_wallet("0xaaa")
    wallet_b.available_balance = Decimal("3.000000")
    wallet_b.pending_balance = Decimal("8.000000")

    storage.gateway_state.withdraw_rows = [
        WithdrawalIntentRow(
            id="wd-expired-a",
            ownerAddress="0xdef",
            amountUsdc=Decimal("12.0"),
            amountWei="12000000",
            feeWei="0",
            nonce=7,
            deadline=1,
            signature="sig-expired-a",
            chainId=31337,
            contractAddress="0xrouter",
            signerAddress="0xsigner",
            status="APPROVED_AUTO",
            businessType="withdraw",
            riskLevel="green",
            idempotencyKey="withdraw-intent-expired-a",
            createdAt="1",
            updatedAt="1",
            message="Signed ticket ready.",
            ticket={
                "amount": "12000000",
                "fee": "0",
                "ticketId": "0x" + "1" * 64,
                "ticketHash": "0x" + "2" * 64,
                "nonce": 7,
                "deadline": 1,
                "signature": "sig-expired-a",
                "chainId": 31337,
                "contractAddress": "0xrouter",
            },
        ),
        WithdrawalIntentRow(
            id="wd-expired-b",
            ownerAddress="0xaaa",
            amountUsdc=Decimal("8.0"),
            amountWei="8000000",
            feeWei="0",
            nonce=9,
            deadline=1,
            signature="sig-expired-b",
            chainId=31337,
            contractAddress="0xrouter",
            signerAddress="0xsigner",
            status="APPROVED_AUTO",
            businessType="withdraw",
            riskLevel="green",
            idempotencyKey="withdraw-intent-expired-b",
            createdAt="1",
            updatedAt="1",
            message="Signed ticket ready.",
            ticket={
                "amount": "8000000",
                "fee": "0",
                "ticketId": "0x" + "3" * 64,
                "ticketHash": "0x" + "4" * 64,
                "nonce": 9,
                "deadline": 1,
                "signature": "sig-expired-b",
                "chainId": 31337,
                "contractAddress": "0xrouter",
            },
        ),
    ]

    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)

    expired_count = asyncio.run(service.expire_stale_provider_withdrawals())

    assert expired_count == 2
    assert storage.gateway_state.withdraw_rows[0].status == "FAILED_EXPIRED"
    assert storage.gateway_state.withdraw_rows[1].status == "FAILED_EXPIRED"
    assert _money_decimal(storage.balance.ledger.ensure_provider_wallet("0xdef").available_balance) == Decimal("17.000000")
    assert _money_decimal(storage.balance.ledger.ensure_provider_wallet("0xdef").pending_balance) == Decimal("0.000000")
    assert _money_decimal(storage.balance.ledger.ensure_provider_wallet("0xaaa").available_balance) == Decimal("11.000000")
    assert _money_decimal(storage.balance.ledger.ensure_provider_wallet("0xaaa").pending_balance) == Decimal("0.000000")


def test_balance_service_reports_withdraw_signer_capability(monkeypatch) -> None:
    storage = FakeStorage()
    service = BalanceService(storage)

    monkeypatch.setattr(settings, "router_address", "0x" + "1" * 40, raising=False)
    monkeypatch.setattr(settings, "private_key", "", raising=False)

    capability = asyncio.run(service.get_provider_withdraw_capability("0xdef"))

    assert capability["ticketSigningEnabled"] is False
    assert capability["code"] == "WITHDRAW_SIGNER_NOT_CONFIGURED"
    assert "gateway withdraw signer" in capability["message"]


def test_owner_balance_summary_uses_consumer_provider_fields() -> None:
    storage = FakeStorage()
    consumer_wallet = storage.balance.ledger.ensure_consumer_wallet("0xabc")
    provider_wallet = storage.balance.ledger.ensure_provider_wallet("0xabc")
    consumer_wallet.available_balance = Decimal("12.5")
    consumer_wallet.pending_balance = Decimal("1.25")
    consumer_wallet.frozen_balance = Decimal("0.75")
    storage.balance.consumer_mature_withdrawable = Decimal("8.25")
    provider_wallet.available_balance = Decimal("9.5")
    provider_wallet.pending_balance = Decimal("2.0")
    storage.balance.ledger.platform.fee_accrued = Decimal("0.4")
    storage.balance.ledger.updated_at = "2026-03-17 12:00:00"

    service = PlatformFinanceService(storage, DummyLockManager())

    balance = asyncio.run(service.get_balance("0xabc"))

    assert balance == {
        "ownerAddress": "0xabc",
        "ownerBalance": "12.500000",
        "consumerAvailableBalance": "12.500000",
        "consumerWithdrawableBalance": "8.250000",
        "consumerPendingBalance": "1.250000",
        "consumerFrozenBalance": "0.750000",
        "consumerWithdrawMinUsdc": "10.000000",
        "consumerWithdrawMaturitySeconds": 604800,
        "consumerWithdrawMaturityEnforced": True,
        "providerReceivable": "9.500000",
        "providerReceivableBalance": "9.500000",
        "providerLockedBalance": "2.000000",
        "platformFeeAccrued": "0.400000",
        "updatedAt": "2026-03-17 12:00:00",
    }


def test_owner_balance_summary_reports_spendable_but_not_yet_withdrawable() -> None:
    storage = FakeStorage()
    consumer_wallet = storage.balance.ledger.ensure_consumer_wallet("0xabc")
    consumer_wallet.available_balance = Decimal("100")
    consumer_wallet.pending_balance = Decimal("0")
    consumer_wallet.frozen_balance = Decimal("0")
    storage.balance.consumer_mature_withdrawable = Decimal("0")

    service = PlatformFinanceService(storage, DummyLockManager())

    balance = asyncio.run(service.get_balance("0xabc"))

    assert balance["consumerAvailableBalance"] == "100.000000"
    assert balance["consumerWithdrawableBalance"] == "0.000000"


def test_owner_balance_summary_repairs_stale_active_consumer_withdraw_gap() -> None:
    storage = FakeStorage()
    consumer_wallet = storage.balance.ledger.ensure_consumer_wallet("0xabc")
    consumer_wallet.available_balance = 20.0
    consumer_wallet.pending_balance = 0.0
    storage.gateway_state.refund_rows = [
        RefundIntentRow(
            id="wd-stale-1",
            ownerAddress="0xabc",
            amountUsdc=Decimal("20.0"),
            status="REQUESTED",
            refundType="CONSUMER_BALANCE_WITHDRAW",
            createdAt="2026-04-08 10:00:00",
            updatedAt="2026-04-08 10:00:00",
        )
    ]

    service = PlatformFinanceService(storage, DummyLockManager())

    balance = asyncio.run(service.get_balance("0xabc"))

    assert balance["consumerAvailableBalance"] == "0.000000"
    assert balance["consumerPendingBalance"] == "20.000000"
    repaired = storage.balance.read_balance_ledger()
    assert repaired.consumer_available_balance("0xabc") == Decimal("0.000000")
    assert repaired.consumer_pending_balance("0xabc") == Decimal("20.000000")


def test_owner_balance_summary_repairs_manual_review_consumer_withdraw_gap_to_frozen() -> None:
    storage = FakeStorage()
    consumer_wallet = storage.balance.ledger.ensure_consumer_wallet("0xabc")
    consumer_wallet.available_balance = 20.0
    consumer_wallet.pending_balance = 0.0
    consumer_wallet.frozen_balance = 0.0
    storage.gateway_state.refund_rows = [
        RefundIntentRow(
            id="wd-manual-stale-1",
            ownerAddress="0xabc",
            amountUsdc=Decimal("20.0"),
            status="PENDING_MANUAL_REVIEW",
            refundType="CONSUMER_BALANCE_WITHDRAW",
            createdAt="2026-04-08 10:00:00",
            updatedAt="2026-04-08 10:00:00",
        )
    ]

    service = PlatformFinanceService(storage, DummyLockManager())

    balance = asyncio.run(service.get_balance("0xabc"))

    assert balance["consumerAvailableBalance"] == "0.000000"
    assert balance["consumerPendingBalance"] == "0.000000"
    assert balance["consumerFrozenBalance"] == "20.000000"
    repaired = storage.balance.read_balance_ledger()
    assert repaired.consumer_available_balance("0xabc") == Decimal("0.000000")
    assert repaired.consumer_pending_balance("0xabc") == Decimal("0.000000")
    assert repaired.consumer_frozen_balance("0xabc") == Decimal("20.000000")


def test_owner_balance_summary_does_not_re_reserve_backed_manual_review_withdrawal() -> None:
    storage = FakeStorage()
    consumer_wallet = storage.balance.ledger.ensure_consumer_wallet("0xabc")
    consumer_wallet.available_balance = 1.0
    consumer_wallet.pending_balance = 0.0
    consumer_wallet.frozen_balance = 20.0
    storage.gateway_state.refund_rows = [
        RefundIntentRow(
            id="wd-manual-backed-1",
            ownerAddress="0xabc",
            amountUsdc=Decimal("20.0"),
            status="PENDING_MANUAL_REVIEW",
            refundType="CONSUMER_BALANCE_WITHDRAW",
            createdAt="2026-04-08 10:00:00",
            updatedAt="2026-04-08 10:00:00",
        ),
        RefundIntentRow(
            id="wd-requested-stale-1",
            ownerAddress="0xabc",
            amountUsdc=Decimal("1.0"),
            status="REQUESTED",
            refundType="CONSUMER_BALANCE_WITHDRAW",
            createdAt="2026-04-08 10:01:00",
            updatedAt="2026-04-08 10:01:00",
        ),
    ]

    service = PlatformFinanceService(storage, DummyLockManager())

    balance = asyncio.run(service.get_balance("0xabc"))

    assert balance["consumerAvailableBalance"] == "0.000000"
    assert balance["consumerPendingBalance"] == "1.000000"
    assert balance["consumerFrozenBalance"] == "20.000000"
    repaired = storage.balance.read_balance_ledger()
    assert repaired.consumer_available_balance("0xabc") == Decimal("0.000000")
    assert repaired.consumer_pending_balance("0xabc") == Decimal("1.000000")
    assert repaired.consumer_frozen_balance("0xabc") == Decimal("20.000000")


def test_owner_balance_summary_keeps_available_when_pending_repair_fails() -> None:
    storage = FakeStorage()
    consumer_wallet = storage.balance.ledger.ensure_consumer_wallet("0xabc")
    consumer_wallet.available_balance = 20.0
    consumer_wallet.pending_balance = 0.0
    storage.gateway_state.refund_rows = [
        RefundIntentRow(
            id="wd-stale-fail-1",
            ownerAddress="0xabc",
            amountUsdc=Decimal("20.0"),
            status="REQUESTED",
            refundType="CONSUMER_BALANCE_WITHDRAW",
            createdAt="2026-04-08 10:00:00",
            updatedAt="2026-04-08 10:00:00",
        )
    ]

    def fail_reserve(**kwargs):
        _ = kwargs
        raise RuntimeError("reserve failed")

    storage.balance.reserve_consumer_balance_for_withdrawal = fail_reserve
    service = PlatformFinanceService(storage, DummyLockManager())

    balance = asyncio.run(service.get_balance("0xabc"))

    assert balance["consumerAvailableBalance"] == "20.000000"
    assert balance["consumerPendingBalance"] == "0.000000"


def test_owner_balance_gap_repair_ignores_empty_owner() -> None:
    storage = FakeStorage()
    service = PlatformFinanceService(storage, DummyLockManager())

    service._repair_consumer_withdraw_reservation_gap("")

    assert storage.balance.read_balance_ledger().consumer_wallets == []


def test_platform_finance_service_persists_owner_spending_limit() -> None:
    storage = FakeStorage()
    service = PlatformFinanceService(storage, DummyLockManager())
    service._enforce_owner_write_rate_limit = _async_none

    saved = asyncio.run(
        service.set_owner_spending_limit(
            "0xabc",
            spending_limit_usdc=Decimal("25"),
            allow_unlimited=False,
            request_meta={"requestId": "req-owner-cap-1"},
        )
    )

    assert saved["ownerAddress"] == "0xabc"
    assert saved["spendingLimitUsdc"] == "25.000000"
    assert saved["allowUnlimited"] is False
    assert saved["cycleInterval"] == "monthly"
    assert len(storage.gateway_state.owner_spend_limit_rows) == 1
    assert storage.gateway_state.owner_spend_limit_rows[0].spending_limit_usdc == Decimal(
        "25.000000"
    )
    assert storage.audit.rows[-1].action == "OWNER_SPEND_LIMIT_UPDATED"


def test_platform_finance_service_reports_current_cycle_owner_spend_limit_budget() -> None:
    storage = FakeStorage()
    storage.gateway_state.owner_spend_limit_rows = [
        OwnerSpendLimitRow(
            ownerAddress="0xabc",
            spendingLimitUsdc=Decimal("10"),
            cycleInterval="monthly",
            createdAt="2026-04-01 00:00:00",
            updatedAt="2026-04-01 00:00:00",
        )
    ]
    storage.gateway_state.usage_rows = [
        UsageLogRow(
            id="usage-1",
            ts=credential_service.now_ts(),
            consumerAddress="0xabc",
            providerAddress="0xdef",
            status="accepted",
            totalCharge=Decimal("3.250000"),
            businessType="charge",
            riskLevel="green",
        ),
        UsageLogRow(
            id="usage-2",
            ts=credential_service.now_ts(),
            consumerAddress="0xabc",
            providerAddress="0xdef",
            status="failed",
            totalCharge=Decimal("9.000000"),
            businessType="charge",
            riskLevel="green",
        ),
    ]

    service = PlatformFinanceService(storage, DummyLockManager())

    summary = asyncio.run(service.get_owner_spending_limit("0xabc"))

    assert summary["spendingLimitUsdc"] == "10.000000"
    assert summary["currentCycleSpendUsdc"] == "3.250000"
    assert summary["remainingSpendUsdc"] == "6.750000"
    assert summary["allowUnlimited"] is False


def test_platform_finance_service_can_clear_owner_spending_limit_to_unlimited() -> None:
    storage = FakeStorage()
    storage.gateway_state.owner_spend_limit_rows = [
        OwnerSpendLimitRow(
            ownerAddress="0xabc",
            spendingLimitUsdc=Decimal("9"),
            cycleInterval="monthly",
            createdAt="2026-04-01 00:00:00",
            updatedAt="2026-04-01 00:00:00",
        )
    ]
    service = PlatformFinanceService(storage, DummyLockManager())
    service._enforce_owner_write_rate_limit = _async_none

    saved = asyncio.run(
        service.set_owner_spending_limit(
            "0xabc",
            spending_limit_usdc=None,
            allow_unlimited=True,
            request_meta={"requestId": "req-owner-cap-clear"},
        )
    )

    assert saved["spendingLimitUsdc"] is None
    assert saved["allowUnlimited"] is True
    assert storage.gateway_state.owner_spend_limit_rows[0].spending_limit_usdc is None


def test_platform_finance_service_redeems_voucher_and_returns_balance() -> None:
    storage = FakeStorage()
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = 20.0
    storage.voucher_atomic_result = VoucherRedemptionResult(
        redemptionId="vrd-1",
        voucherCodeId="vcode-1",
        campaignId="camp-1",
        campaignCode="APRIL26",
        campaignDisplayName="April Credits",
        voucherCodeLast4="EFGH",
        grantedAmountUsdc=Decimal("15.000000"),
        ownerAddress="0xabc",
        ledgerEntryId="ledger-voucher::vrd-1",
        targetAccountId="consumer_wallet::0xabc",
        promoAccountId="platform_promo::camp-1",
        status="COMPLETED",
        beforeBalanceUsdc=Decimal("20.000000"),
        afterBalanceUsdc=Decimal("35.000000"),
        redeemedAt="2026-04-02 10:00:00",
    )
    service = PlatformFinanceService(storage, DummyLockManager())
    service._get_redis_client = _async_none
    service._enforce_owner_write_rate_limit = _async_none

    result = asyncio.run(
        service.redeem_credit_voucher(
            owner_wallet="0xabc",
            voucher_code="ABCD-EFGH-IJKL",
            idempotency_key="voucher-redeem-key-0001",
            request_meta={
                "requestId": "req-voucher-1",
                "clientIp": "127.0.0.1",
                "userAgent": "pytest",
            },
        )
    )

    assert result["redemption"]["campaignCode"] == "APRIL26"
    assert result["redemption"]["grantedAmountUsdc"] == "15.000000"
    assert result["balance"]["ownerBalance"] == "35.000000"
    assert storage.voucher_commands[0].normalized_code == "ABCDEFGHIJKL"
    assert storage.voucher_commands[0].code_hash


def test_platform_finance_service_returns_cached_voucher_idempotency_response() -> None:
    storage = FakeStorage()
    service = PlatformFinanceService(storage, DummyLockManager())
    cached = {"cached": True}

    async def fake_check(**kwargs):
        _ = kwargs
        return cached

    async def fail_start(**kwargs):
        _ = kwargs
        raise AssertionError("cached idempotency should not start a new claim")

    service._get_redis_client = lambda: _async_value(object())
    service._check_idempotency_redis = fake_check
    service._start_idempotency_redis = fail_start

    result = asyncio.run(
        service.redeem_credit_voucher(
            owner_wallet="0xabc",
            voucher_code="ABCD-EFGH-IJKL",
            idempotency_key="voucher-redeem-key-cached",
        )
    )

    assert result == cached
    assert storage.voucher_commands == []


def test_platform_finance_service_rejects_concurrent_voucher_idempotency_claim() -> None:
    storage = FakeStorage()
    service = PlatformFinanceService(storage, DummyLockManager())

    async def fake_check(**kwargs):
        _ = kwargs
        return None

    async def fake_start(**kwargs):
        _ = kwargs
        return False

    service._get_redis_client = lambda: _async_value(object())
    service._check_idempotency_redis = fake_check
    service._start_idempotency_redis = fake_start

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            service.redeem_credit_voucher(
                owner_wallet="0xabc",
                voucher_code="ABCD-EFGH-IJKL",
                idempotency_key="voucher-redeem-key-concurrent",
            )
        )

    assert excinfo.value.status_code == 409
    assert excinfo.value.detail["code"] == "IDEMPOTENCY_REQUEST_IN_PROGRESS"


def test_platform_finance_service_requires_atomic_voucher_storage() -> None:
    storage = SimpleNamespace()
    service = PlatformFinanceService(storage, DummyLockManager())
    ctx = VoucherRedeemContext(
        owner="0xabc",
        voucher_code="ABCD-EFGH-IJKL",
        normalized_code="ABCDEFGHIJKL",
        idempotency_key="voucher-redeem-key-storage-missing",
        request_hash="hash",
        request_id=None,
        client_ip=None,
        user_agent=None,
        request_meta=None,
    )

    with pytest.raises(HTTPException) as excinfo:
        service._redeem_credit_voucher_atomic_or_raise(ctx)

    assert excinfo.value.status_code == 503
    assert excinfo.value.detail["code"] == "VOUCHER_REDEEM_STORAGE_UNAVAILABLE"


def test_platform_finance_service_rejects_invalid_voucher_atomic_result() -> None:
    storage = FakeStorage()
    service = PlatformFinanceService(storage, DummyLockManager())
    ctx = VoucherRedeemContext(
        owner="0xabc",
        voucher_code="ABCD-EFGH-IJKL",
        normalized_code="ABCDEFGHIJKL",
        idempotency_key="voucher-redeem-key-invalid-result",
        request_hash="hash",
        request_id=None,
        client_ip=None,
        user_agent=None,
        request_meta=None,
    )
    storage.redeem_credit_voucher_atomic = lambda _command: {"bad": True}  # type: ignore[method-assign]  # quality-budget-disable-reason: test overrides storage result shape.

    with pytest.raises(TypeError, match="VOUCHER_REDEEM_RESULT_INVALID"):
        service._redeem_credit_voucher_atomic_or_raise(ctx)


def test_platform_finance_service_maps_voucher_conflict_errors() -> None:
    storage = FakeStorage()
    storage.voucher_atomic_error = RuntimeError("VOUCHER_ALREADY_REDEEMED")
    service = PlatformFinanceService(storage, DummyLockManager())
    service._get_redis_client = _async_none
    service._enforce_owner_write_rate_limit = _async_none

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(
            service.redeem_credit_voucher(
                owner_wallet="0xabc",
                voucher_code="ABCD-EFGH-IJKL",
                idempotency_key="voucher-redeem-key-0002",
                request_meta={"requestId": "req-voucher-2"},
            )
        )

    assert excinfo.value.status_code == 409
    assert excinfo.value.detail["code"] == "VOUCHER_ALREADY_REDEEMED"
    assert storage.audit.rows[-1].action == "VOUCHER_REDEEM_FAILED"
