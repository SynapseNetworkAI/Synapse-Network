from __future__ import annotations

import time
import logging
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.domain.ledger import WithdrawalIntentRow
from src.domain.operation_metadata import WithdrawalTicketMetadata
from src.services.balance_mixins import withdraw_signing
from src.services.balance_mixins.withdraw_signing import BalanceWithdrawSigningMixin
from src.services.provider.withdraw_helpers_mixin import (
    EXPIRED_WITHDRAW_RELEASE_MESSAGE,
    EXPIRED_WITHDRAW_RPC_BEHIND_MESSAGE,
    ProviderWithdrawHelpersMixin,
)


OWNER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"


class _Call:
    def __init__(self, value=None, error: Exception | None = None) -> None:
        self.value = value
        self.error = error

    def call(self):
        if self.error is not None:
            raise self.error
        return self.value


class _Contract:
    def __init__(self, consumed: bool | Exception) -> None:
        self.consumed = consumed
        self.functions = self

    def isTicketConsumed(self, ticket_hash: str):
        assert ticket_hash == "0xticket"
        if isinstance(self.consumed, Exception):
            return _Call(error=self.consumed)
        return _Call(value=self.consumed)


def test_withdraw_signing_queries_ticket_consumed_and_latest_block_timestamp():
    mixin = BalanceWithdrawSigningMixin()
    provider = SimpleNamespace(eth=SimpleNamespace(get_block=lambda block: {"timestamp": 456}))
    mixin._withdraw_contract = lambda: (provider, _Contract(True))  # type: ignore[method-assign]

    assert mixin._withdraw_ticket_consumed("0xticket") is True
    assert mixin._latest_withdraw_rpc_block_timestamp() == 456


def test_withdraw_signing_maps_chain_query_failures_to_service_unavailable(caplog):
    mixin = BalanceWithdrawSigningMixin()
    provider = SimpleNamespace(
        eth=SimpleNamespace(
            get_block=lambda block: (_ for _ in ()).throw(RuntimeError("rpc"))
        )
    )
    mixin._withdraw_contract = lambda: (provider, _Contract(RuntimeError("rpc")))  # type: ignore[method-assign]
    caplog.set_level(
        logging.ERROR,
        logger="src.services.balance_mixins.withdraw_signing",
    )

    with pytest.raises(HTTPException) as consumed_exc:
        mixin._withdraw_ticket_consumed("0xticket")
    assert consumed_exc.value.status_code == 503
    assert consumed_exc.value.detail["code"] == "CHAIN_RPC_UNAVAILABLE"

    with pytest.raises(HTTPException) as block_exc:
        mixin._latest_withdraw_rpc_block_timestamp()
    assert block_exc.value.status_code == 503
    assert block_exc.value.detail["code"] == "CHAIN_RPC_UNAVAILABLE"
    assert "alert_trigger=CHAIN_RPC_UNAVAILABLE" in caplog.text
    assert "chainIdExpected=421614" in caplog.text


def test_withdraw_contract_logs_rpc_connection_failure(monkeypatch, caplog):
    class _DisconnectedWeb3:
        class HTTPProvider:
            def __init__(self, *args, **kwargs) -> None:
                pass

        def __init__(self, provider) -> None:
            self.eth = SimpleNamespace(contract=lambda **kwargs: object())

        @staticmethod
        def to_checksum_address(address: str) -> str:
            return address

        def is_connected(self) -> bool:
            return False

    monkeypatch.setattr(withdraw_signing, "_web3_class", lambda: _DisconnectedWeb3)
    monkeypatch.setattr(withdraw_signing.settings, "router_address", OWNER)
    caplog.set_level(
        logging.ERROR,
        logger="src.services.balance_mixins.withdraw_signing",
    )

    with pytest.raises(HTTPException) as exc:
        BalanceWithdrawSigningMixin()._withdraw_contract()

    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "CHAIN_RPC_UNAVAILABLE"
    assert "alert_trigger=CHAIN_RPC_UNAVAILABLE" in caplog.text
    assert "context=withdraw_contract" in caplog.text


def test_resolve_withdraw_chain_logs_chain_id_query_failure(caplog):
    class _FailingEth:
        @property
        def chain_id(self):
            raise RuntimeError("rpc")

    mixin = BalanceWithdrawSigningMixin()
    provider = SimpleNamespace(eth=_FailingEth())
    mixin._withdraw_contract = lambda: (provider, object())  # type: ignore[method-assign]
    caplog.set_level(
        logging.ERROR,
        logger="src.services.balance_mixins.withdraw_signing",
    )

    with pytest.raises(HTTPException) as exc:
        mixin._resolve_withdraw_chain()

    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "CHAIN_RPC_UNAVAILABLE"
    assert "alert_trigger=CHAIN_RPC_UNAVAILABLE" in caplog.text
    assert "context=resolve_withdraw_chain" in caplog.text


def test_withdraw_vault_liquidity_requires_token_and_router_config(monkeypatch):
    mixin = BalanceWithdrawSigningMixin()
    monkeypatch.setattr(withdraw_signing.settings, "usdc_token_address", "")
    monkeypatch.setattr(withdraw_signing.settings, "router_address", OWNER)

    with pytest.raises(RuntimeError, match="WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE"):
        mixin._read_vault_liquidity_amount_wei()

    monkeypatch.setattr(withdraw_signing.settings, "usdc_token_address", OWNER)
    monkeypatch.setattr(withdraw_signing.settings, "router_address", "")

    with pytest.raises(RuntimeError, match="WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE"):
        mixin._read_vault_liquidity_amount_wei()


def test_withdraw_vault_liquidity_requires_contract_web3(monkeypatch):
    mixin = BalanceWithdrawSigningMixin()
    monkeypatch.setattr(withdraw_signing.settings, "usdc_token_address", OWNER)
    monkeypatch.setattr(withdraw_signing.settings, "router_address", OWNER)
    mixin._withdraw_contract = lambda: (  # type: ignore[method-assign]  # reason: test injects a minimal contract harness
        object(),
        SimpleNamespace(w3=None),
    )

    with pytest.raises(RuntimeError, match="WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE"):
        mixin._read_vault_liquidity_amount_wei()


def test_withdraw_vault_liquidity_reads_token_balance_and_asserts(monkeypatch):
    class _TokenContract:
        def __init__(self, value: int) -> None:
            self.value = value
            self.functions = self

        def balanceOf(self, account: str):
            assert account == OWNER
            return _Call(value=self.value)

        def decimals(self):
            return _Call(value=18)

    class _Eth:
        def __init__(self, value: int) -> None:
            self.value = value

        def contract(self, *, address: str, abi: list[dict[str, object]]):
            assert address == OWNER
            assert abi
            return _TokenContract(self.value)

    class _Web3:
        def __init__(self, value: int) -> None:
            self.eth = _Eth(value)

        @staticmethod
        def to_checksum_address(address: str) -> str:
            return address

    mixin = BalanceWithdrawSigningMixin()
    monkeypatch.setattr(withdraw_signing.settings, "usdc_token_address", OWNER)
    monkeypatch.setattr(withdraw_signing.settings, "router_address", OWNER)
    mixin._withdraw_contract = lambda: (  # type: ignore[method-assign]  # reason: test injects a minimal contract harness
        object(),
        SimpleNamespace(w3=_Web3(3_000_000_000_000_000_000)),
    )

    assert mixin._read_vault_liquidity_amount_wei() == 3_000_000_000_000_000_000
    mixin._assert_withdraw_vault_liquidity(Decimal("2"))

    with pytest.raises(RuntimeError, match="INSUFFICIENT_VAULT_LIQUIDITY"):
        mixin._assert_withdraw_vault_liquidity(Decimal("4"))


def test_withdraw_vault_liquidity_maps_contract_errors(monkeypatch, caplog):
    class _FailingEth:
        def contract(self, **kwargs):
            raise ValueError("rpc")

    class _Web3:
        eth = _FailingEth()

        @staticmethod
        def to_checksum_address(address: str) -> str:
            return address

    mixin = BalanceWithdrawSigningMixin()
    monkeypatch.setattr(withdraw_signing.settings, "usdc_token_address", OWNER)
    monkeypatch.setattr(withdraw_signing.settings, "router_address", OWNER)
    mixin._withdraw_contract = lambda: (  # type: ignore[method-assign]  # reason: test injects a minimal contract harness
        object(),
        SimpleNamespace(w3=_Web3()),
    )
    caplog.set_level(
        logging.ERROR,
        logger="src.services.balance_mixins.withdraw_signing",
    )

    with pytest.raises(RuntimeError, match="WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE"):
        mixin._read_vault_liquidity_amount_wei()

    assert "alert_trigger=CHAIN_RPC_UNAVAILABLE" in caplog.text
    assert "context=withdraw_vault_liquidity" in caplog.text


class _ProviderExpiryHarness(ProviderWithdrawHelpersMixin):
    def __init__(self, *, consumed: bool | None, rpc_timestamp: int | None) -> None:
        self.consumed = consumed
        self.rpc_timestamp = rpc_timestamp
        self.released: list[Decimal] = []
        self.consumed_amounts: list[Decimal] = []
        self.audit: list[tuple[str, dict[str, object]]] = []
        self.saved_rows: list[WithdrawalIntentRow] = []

    def _withdraw_ticket_consumed(self, ticket_hash: str) -> bool:  # type: ignore[override]
        assert ticket_hash == "0xticket"
        if self.consumed is None:
            raise RuntimeError("rpc")
        return self.consumed

    def _latest_withdraw_rpc_block_timestamp(self) -> int:  # type: ignore[override]
        if self.rpc_timestamp is None:
            raise RuntimeError("rpc")
        return self.rpc_timestamp

    def _release_pending_withdraw_to_available(self, owner: str, amount_usdc: Decimal) -> Decimal:  # type: ignore[override]
        assert owner == OWNER.lower()
        self.released.append(amount_usdc)
        return amount_usdc

    def _consume_locked_withdraw_amount(self, owner: str, amount_usdc: Decimal) -> None:  # type: ignore[override]
        assert owner == OWNER.lower()
        self.consumed_amounts.append(amount_usdc)

    def _append_financial_audit(self, action: str, owner: str, metadata: dict[str, object]) -> None:  # type: ignore[override]
        assert owner == OWNER.lower()
        self.audit.append((action, metadata))

    def _save_withdrawal_rows(self, rows: list[WithdrawalIntentRow]) -> None:  # type: ignore[override]
        self.saved_rows = list(rows)


def _provider_row(*, deadline: int) -> WithdrawalIntentRow:
    return WithdrawalIntentRow(
        id="wd-test",
        ownerAddress=OWNER,
        status="APPROVED_AUTO",
        amountUsdc=Decimal("2.000000"),
        deadline=deadline,
        ticket=WithdrawalTicketMetadata(ticketHash="0xticket", deadline=deadline),
    )


def test_provider_expiry_waits_when_rpc_head_has_not_crossed_margin():
    deadline = int(time.time()) - 1000
    row = _provider_row(deadline=deadline)
    harness = _ProviderExpiryHarness(consumed=False, rpc_timestamp=deadline)

    rows = harness._expire_stale_withdrawals([row])

    assert rows[0].status == "APPROVED_AUTO"
    assert rows[0].message == EXPIRED_WITHDRAW_RPC_BEHIND_MESSAGE
    assert harness.released == []


def test_provider_expiry_completes_when_ticket_was_consumed_on_chain():
    deadline = int(time.time()) - 1000
    row = _provider_row(deadline=deadline)
    harness = _ProviderExpiryHarness(consumed=True, rpc_timestamp=int(time.time()))

    rows = harness._expire_stale_withdrawals([row])

    assert rows[0].status == "COMPLETED"
    assert harness.consumed_amounts == [Decimal("2.000000")]
    assert harness.audit[0][0] == "PROVIDER_WITHDRAW_COMPLETED_BY_REAPER"


def test_provider_expiry_releases_pending_when_ticket_was_not_consumed():
    deadline = int(time.time()) - 1000
    row = _provider_row(deadline=deadline)
    harness = _ProviderExpiryHarness(consumed=False, rpc_timestamp=int(time.time()))

    rows = harness._expire_stale_withdrawals([row])

    assert rows[0].status == "FAILED_EXPIRED"
    assert rows[0].message == EXPIRED_WITHDRAW_RELEASE_MESSAGE
    assert harness.released == [Decimal("2.000000")]
