from __future__ import annotations

import asyncio
import time
from decimal import Decimal

from src.core.config import settings
from src.domain.ledger import WithdrawalIntentRow
from src.services.provider.withdraw_service import ProviderWithdrawService

from tests.unit.test_finance_runtime_service_unit import (
    DummyLockManager,
    FakeStorage,
    _configure_withdraw_service,
    _money_decimal,
)


def _created_at_seconds_ago(seconds: int) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(time.time() - seconds))


def _manual_review_row(index: int, owner: str, amount: str = "2.0") -> WithdrawalIntentRow:
    created_at = _created_at_seconds_ago(5)
    return WithdrawalIntentRow(
        id=f"wd-manual-expired-{index}",
        ownerAddress=owner,
        amountUsdc=Decimal(amount),
        amountWei=str(int(Decimal(amount) * Decimal("1000000"))),
        feeWei="0",
        nonce=index + 1,
        deadline=None,
        signature="",
        chainId=31337,
        contractAddress="0xrouter",
        signerAddress="0xsigner",
        status="PENDING_MANUAL_REVIEW",
        businessType="withdraw",
        riskLevel="yellow",
        idempotencyKey=f"withdraw-intent-manual-expired-{index}",
        createdAt=created_at,
        updatedAt=created_at,
        message="Manual review required.",
    )


def test_provider_withdraw_manual_review_expires_and_releases_frozen(monkeypatch) -> None:
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = Decimal("1.000000")
    wallet.frozen_balance = Decimal("12.000000")
    storage.gateway_state.withdraw_rows = [_manual_review_row(0, "0xdef", "12.0")]
    monkeypatch.setattr(settings, "withdrawal_manual_review_expiry_min_sec", 1)
    monkeypatch.setattr(settings, "withdrawal_manual_review_expiry_sec", 3)

    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)
    expired_count = asyncio.run(service.expire_stale_provider_withdrawals())

    row = storage.gateway_state.withdraw_rows[0]
    wallet_after = storage.balance.ledger.ensure_provider_wallet("0xdef")
    assert expired_count == 1
    assert row.status == "FAILED_EXPIRED"
    assert "safely returned" in str(row.message or "")
    assert _money_decimal(wallet_after.available_balance) == Decimal("13.000000")
    assert _money_decimal(wallet_after.frozen_balance) == Decimal("0.000000")
    assert storage.audit.rows[-1].action == "PROVIDER_WITHDRAW_MANUAL_REVIEW_EXPIRED"


def test_provider_withdraw_manual_review_keeps_fresh_pending(monkeypatch) -> None:
    storage = FakeStorage()
    wallet = storage.balance.ledger.ensure_provider_wallet("0xdef")
    wallet.available_balance = Decimal("1.000000")
    wallet.frozen_balance = Decimal("12.000000")
    row = _manual_review_row(0, "0xdef", "12.0")
    row.created_at = _created_at_seconds_ago(1)
    row.updated_at = row.created_at
    storage.gateway_state.withdraw_rows = [row]
    monkeypatch.setattr(settings, "withdrawal_manual_review_expiry_min_sec", 1)
    monkeypatch.setattr(settings, "withdrawal_manual_review_expiry_sec", 3)

    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)
    expired_count = asyncio.run(service.expire_stale_provider_withdrawals())

    wallet_after = storage.balance.ledger.ensure_provider_wallet("0xdef")
    assert expired_count == 0
    assert row.status == "PENDING_MANUAL_REVIEW"
    assert _money_decimal(wallet_after.available_balance) == Decimal("1.000000")
    assert _money_decimal(wallet_after.frozen_balance) == Decimal("12.000000")


def test_provider_withdraw_expiry_reaper_respects_batch_size(monkeypatch) -> None:
    storage = FakeStorage()
    rows: list[WithdrawalIntentRow] = []
    for index in range(3):
        owner = f"0x{index + 1:040x}"
        storage.balance.ledger.ensure_provider_wallet(owner).frozen_balance = Decimal("2.000000")
        rows.append(_manual_review_row(index, owner))
    storage.gateway_state.withdraw_rows = rows
    monkeypatch.setattr(settings, "withdrawal_manual_review_expiry_min_sec", 1)
    monkeypatch.setattr(settings, "withdrawal_manual_review_expiry_sec", 3)
    monkeypatch.setattr(settings, "withdrawal_reaper_batch_size", 2)

    service = ProviderWithdrawService(storage, DummyLockManager())
    _configure_withdraw_service(service)
    expired_count = asyncio.run(service.expire_stale_provider_withdrawals())

    statuses = [row.status for row in storage.gateway_state.withdraw_rows]
    assert expired_count == 2
    assert statuses.count("FAILED_EXPIRED") == 2
    assert statuses.count("PENDING_MANUAL_REVIEW") == 1
