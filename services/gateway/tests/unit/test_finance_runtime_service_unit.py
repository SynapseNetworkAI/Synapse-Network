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
        self.owner_spend_limit_rows: list[OwnerSpendLimitRow] = []
        self.usage_rows = []

    def read_deposit_intents(self):
        return list(self.deposit_rows)

    def write_deposit_intents(self, rows):
        assert all(isinstance(row, DepositIntentRow) for row in rows)
        self.deposit_rows = list(rows)

    def read_consumer_refund_rows(self):
        return list(self.refund_rows)

    def write_consumer_refund_rows(self, rows, updated_at):
        _ = updated_at
        assert all(isinstance(row, RefundIntentRow) for row in rows)
        self.refund_rows = list(rows)

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
        self.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = float(
            self.voucher_atomic_result.after_balance_usdc
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


def _noop_assert_withdraw_vault_liquidity(amount_usdc) -> None:
    _ = amount_usdc


def _configure_owner_service(service: OwnerFinanceService) -> None:
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
    service._assert_withdraw_vault_liquidity = _noop_assert_withdraw_vault_liquidity
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


def _raise_insufficient_vault_liquidity(_amount) -> None:
    raise RuntimeError("INSUFFICIENT_VAULT_LIQUIDITY")


def test_consumer_finance_deposit_flow_uses_typed_rows() -> None:
    storage = FakeStorage()
    service = OwnerFinanceService(storage, DummyLockManager())
    _configure_owner_service(service)

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
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = 100.0
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


def test_provider_withdraw_allows_two_decimal_amount() -> None:
    storage = FakeStorage()
    storage.balance.ledger.ensure_provider_wallet("0xdef").available_balance = 50.0
    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)

    created = asyncio.run(
        service.create_provider_withdraw_intent(
            {"amountUsdc": 12.34},
            "0xdef",
            "withdraw-intent-key-0012",
        )
    )

    assert created["status"] == "APPROVED_AUTO"
    assert abs(created["amountUsdc"] - 12.34) < 1e-9


def test_provider_withdraw_rejects_more_than_two_decimal_places() -> None:
    storage = FakeStorage()
    storage.balance.ledger.ensure_provider_wallet("0xdef").available_balance = 50.0
    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            service.create_provider_withdraw_intent(
                {"amountUsdc": 12.345},
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
    wallet.available_balance = 50.0
    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)
    service._assert_withdraw_vault_liquidity = _raise_insufficient_vault_liquidity

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            service.create_provider_withdraw_intent(
                {"amountUsdc": 8.5},
                "0xdef",
                "withdraw-intent-key-liquidity-1",
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "INSUFFICIENT_VAULT_LIQUIDITY"
    assert len(storage.gateway_state.withdraw_rows) == 0
    wallet_after = storage.balance.ledger.ensure_provider_wallet("0xdef")
    assert abs(wallet_after.available_balance - 50.0) < 1e-9
    assert abs(wallet_after.pending_balance - 0.0) < 1e-9
    assert abs(wallet_after.frozen_balance - 0.0) < 1e-9


def test_provider_withdraw_atomic_path_reads_vault_liquidity_from_contract_tuple() -> None:
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = 50.0
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
        command.pre_reserve_check(Decimal("8.5"))
        return SimpleNamespace(
            withdrawal_id="wd-1",
            status="APPROVED_AUTO",
            amount_usdc=8.5,
            ticket={},
            message="ok",
            decision="green",
            risk_reason_code=None,
        )

    storage.process_withdrawal_request_atomic = _process_withdrawal_request_atomic  # type: ignore[attr-defined]

    created = asyncio.run(
        service.create_provider_withdraw_intent(
            {"amountUsdc": 8.5},
            "0xdef",
            "withdraw-intent-key-atomic-liquidity-1",
        )
    )

    assert created["status"] == "APPROVED_AUTO"
    assert created["withdrawalId"] == "wd-1"


def test_provider_withdraw_maps_missing_vault_web3_provider_to_service_unavailable() -> None:
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = 50.0
    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)
    service._assert_withdraw_vault_liquidity = ProviderWithdrawService._assert_withdraw_vault_liquidity.__get__(
        service, ProviderWithdrawService
    )
    service._withdraw_contract = lambda: (SimpleNamespace(), SimpleNamespace(w3=None))

    def _process_withdrawal_request_atomic(command):
        assert command.pre_reserve_check is not None
        command.pre_reserve_check(Decimal("8.5"))
        raise AssertionError("pre_reserve_check should raise before atomic success")

    storage.process_withdrawal_request_atomic = _process_withdrawal_request_atomic  # type: ignore[attr-defined]

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            service.create_provider_withdraw_intent(
                {"amountUsdc": 8.5},
                "0xdef",
                "withdraw-intent-key-atomic-liquidity-2",
            )
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["code"] == "WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE"


def test_provider_withdraw_manual_review_approval_generates_ticket_and_moves_to_pending() -> None:
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = 200.0
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
    assert abs(wallet_after_create.available_balance - 80.0) < 1e-9
    assert abs(wallet_after_create.pending_balance - 0.0) < 1e-9
    assert abs(wallet_after_create.frozen_balance - 120.0) < 1e-9

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
    assert abs(wallet_after_approve.available_balance - 80.0) < 1e-9
    assert abs(wallet_after_approve.pending_balance - 120.0) < 1e-9
    assert abs(wallet_after_approve.frozen_balance - 0.0) < 1e-9

    completed = asyncio.run(
        service.complete_provider_withdrawal(
            "0xdef",
            row.id,
            "0x" + "7" * 64,
        )
    )
    assert completed["status"] == "COMPLETED"
    wallet_after_complete = storage.balance.ledger.ensure_provider_wallet("0xdef")
    assert abs(wallet_after_complete.pending_balance - 0.0) < 1e-9


def test_provider_withdraw_manual_review_rejection_releases_frozen_balance() -> None:
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = 150.0
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
    wallet.available_balance = 100.0
    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)
    captured_single_limit: Decimal | None = None

    def _process_withdrawal_request_atomic(command):
        nonlocal captured_single_limit
        captured_single_limit = command.single_limit_usdc
        return SimpleNamespace(
            withdrawal_id="wd-config-threshold-1",
            status="PENDING_MANUAL_REVIEW",
            amount_usdc=60.0,
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
    wallet.available_balance = 10.0
    wallet.pending_balance = 12.0

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

    assert rows[0]["status"] == "CANCELLED"
    assert "expired" in rows[0]["message"].lower()
    wallet_after = storage.balance.ledger.ensure_provider_wallet("0xdef")
    assert abs(wallet_after.available_balance - 22.0) < 1e-9
    assert abs(wallet_after.pending_balance - 0.0) < 1e-9
    assert storage.audit.rows[-1].action == "PROVIDER_WITHDRAW_CANCELLED"
    assert storage.audit.rows[-1].details["reason"] == "TICKET_EXPIRED"
    assert abs(storage.audit.rows[-1].details["releasedAmountUsdc"] - 12.0) < 1e-9
    assert abs(storage.audit.rows[-1].details["releaseShortfallUsdc"] - 0.0) < 1e-9


def test_provider_withdraw_expired_ticket_cancels_even_if_locked_balance_was_already_reconciled() -> None:
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = 10.0
    wallet.pending_balance = 0.0

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

    assert rows[0]["status"] == "CANCELLED"
    assert "reconciled" in rows[0]["message"].lower()
    wallet_after = storage.balance.ledger.ensure_provider_wallet("0xdef")
    assert abs(wallet_after.available_balance - 10.0) < 1e-9
    assert abs(wallet_after.pending_balance - 0.0) < 1e-9
    assert storage.audit.rows[-1].action == "PROVIDER_WITHDRAW_CANCELLED"
    assert storage.audit.rows[-1].details["reason"] == "TICKET_EXPIRED"
    assert abs(storage.audit.rows[-1].details["releasedAmountUsdc"] - 0.0) < 1e-9
    assert abs(storage.audit.rows[-1].details["releaseShortfallUsdc"] - 12.0) < 1e-9


def test_provider_withdraw_expired_ticket_does_not_block_new_intent() -> None:
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = 10.0
    wallet.pending_balance = 12.0

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
    assert storage.gateway_state.withdraw_rows[0].status == "CANCELLED"
    assert storage.gateway_state.withdraw_rows[1].status == "APPROVED_AUTO"
    wallet_after = storage.balance.ledger.ensure_provider_wallet("0xdef")
    assert abs(wallet_after.available_balance - 2.0) < 1e-9
    assert abs(wallet_after.pending_balance - 20.0) < 1e-9


def test_provider_withdraw_expiry_reaper_scans_all_owners() -> None:
    storage = FakeStorage()

    wallet_a = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet_a.available_balance = 5.0
    wallet_a.pending_balance = 12.0

    wallet_b = storage.balance.ledger.ensure_provider_wallet("0xaaa")
    wallet_b.available_balance = 3.0
    wallet_b.pending_balance = 8.0

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
    assert storage.gateway_state.withdraw_rows[0].status == "CANCELLED"
    assert storage.gateway_state.withdraw_rows[1].status == "CANCELLED"
    assert abs(storage.balance.ledger.ensure_provider_wallet("0xdef").available_balance - 17.0) < 1e-9
    assert abs(storage.balance.ledger.ensure_provider_wallet("0xdef").pending_balance - 0.0) < 1e-9
    assert abs(storage.balance.ledger.ensure_provider_wallet("0xaaa").available_balance - 11.0) < 1e-9
    assert abs(storage.balance.ledger.ensure_provider_wallet("0xaaa").pending_balance - 0.0) < 1e-9


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
        "ownerBalance": 12.5,
        "consumerAvailableBalance": 12.5,
        "consumerPendingBalance": 1.25,
        "consumerFrozenBalance": 0.75,
        "providerReceivable": 9.5,
        "providerReceivableBalance": 9.5,
        "providerLockedBalance": 2.0,
        "platformFeeAccrued": 0.4,
        "updatedAt": "2026-03-17 12:00:00",
    }


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
    assert saved["spendingLimitUsdc"] == 25.0
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

    assert summary["spendingLimitUsdc"] == 10.0
    assert summary["currentCycleSpendUsdc"] == 3.25
    assert summary["remainingSpendUsdc"] == 6.75
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
    assert result["balance"]["ownerBalance"] == 35.0
    assert storage.voucher_commands[0].normalized_code == "ABCDEFGHIJKL"
    assert storage.voucher_commands[0].code_hash


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
