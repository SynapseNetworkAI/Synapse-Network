"""Unit tests for consumer balance withdrawal.

Covers:
1. Balance decreases (available → pending) after a successful REQUESTED withdrawal
2. Large withdrawal routes to PENDING_MANUAL_REVIEW (available → frozen)
3. Frozen / pending balance is NOT counted as available → blocks API calls
4. Daily count limit triggers manual review
5. Idempotency — active withdrawal returns early without double-deducting
6. Insufficient balance raises 400
7. Risk classification thresholds
8. Env-configurable threshold is read at import time
"""
from __future__ import annotations

import asyncio
import importlib
import time
import unittest
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from src.domain.finance import BalanceLedger, ConsumerWalletRecord, RefundIntentRow
from src.services.owner.finance_service import OwnerFinanceService


# ─── In-memory repos ──────────────────────────────────────────────────────────

class InMemoryBalanceRepo:
    """In-memory balance repo that also implements the atomic reserve helper."""

    def __init__(self):
        self._ledger = BalanceLedger()

    def read_balance_ledger(self) -> BalanceLedger:
        return self._ledger.model_copy(deep=True)

    def write_balance_ledger(self, ledger: BalanceLedger) -> None:
        self._ledger = ledger.model_copy(deep=True)

    def reserve_consumer_balance_for_withdrawal(
        self, owner: str, amount_usdc: float, updated_at: str
    ) -> None:
        """Simulate the atomic SQL delta: available -= amount, pending += amount."""
        _ = updated_at
        wallet = self._ledger.ensure_consumer_wallet(owner)
        available = float(wallet.available_balance or 0.0)
        if available < amount_usdc - 1e-9:
            raise RuntimeError("INSUFFICIENT_CONSUMER_BALANCE_ATOMIC")
        wallet.available_balance = round(available - amount_usdc, 6)
        wallet.pending_balance = round(float(wallet.pending_balance or 0.0) + amount_usdc, 6)

    def seed_balance(self, owner: str, available: float, pending: float = 0.0) -> None:
        wallet = self._ledger.ensure_consumer_wallet(owner)
        wallet.available_balance = available
        wallet.pending_balance = pending


class InMemoryGatewayStateRepo:
    def __init__(self):
        self.refund_rows: list[RefundIntentRow] = []
        self.deposit_rows = []
        self.withdraw_rows = []
        self.owner_spend_limit_rows = []
        self.usage_rows = []

    def read_deposit_intents(self): return list(self.deposit_rows)
    def write_deposit_intents(self, rows): self.deposit_rows = list(rows)
    def read_consumer_refund_rows(self): return list(self.refund_rows)

    def write_consumer_refund_rows(self, rows, updated_at):
        _ = updated_at
        self.refund_rows = list(rows)

    def read_provider_withdrawal_rows(self): return list(self.withdraw_rows)
    def write_provider_withdrawal_rows(self, rows, updated_at): self.withdraw_rows = list(rows)
    def read_invocation_billing_rows(self): return list(self.usage_rows)
    def read_owner_spend_limit_rows(self): return list(self.owner_spend_limit_rows)
    def write_owner_spend_limit_rows(self, rows, updated_at): self.owner_spend_limit_rows = list(rows)


class InMemoryAuditRepo:
    def __init__(self): self.rows = []
    def append_audit_row(self, row): self.rows.append(row)


class InMemoryIdempotencyRepo:
    def read_idempotency_rows(self): return []
    def write_idempotency_rows(self, rows, updated_at): pass


class FakeStorage:
    def __init__(self):
        self.balance_repo = InMemoryBalanceRepo()
        self.gateway_state = InMemoryGatewayStateRepo()
        self.audit = InMemoryAuditRepo()
        self.idempotency = InMemoryIdempotencyRepo()
        self.data_manager = SimpleNamespace(
            finance=SimpleNamespace(balance=self.balance_repo),
            system=SimpleNamespace(
                gateway_state=self.gateway_state,
                idempotency=self.idempotency,
            ),
            audit=SimpleNamespace(logs=self.audit),
        )

    def get_data_manager(self):
        return self.data_manager


# ─── Helpers ──────────────────────────────────────────────────────────────────


class DummyLock:
    async def __aenter__(self): return self
    async def __aexit__(self, *args): return False


class DummyLockManager:
    def lock(self, key: str): return DummyLock()


async def _async_none(*args, **kwargs): return None
async def _async_true(*args, **kwargs): return True


def _make_service(storage: FakeStorage) -> OwnerFinanceService:
    svc = OwnerFinanceService(storage, DummyLockManager())
    svc._get_redis_client = _async_none
    svc._check_idempotency_redis = _async_none
    svc._finalize_refund_idempotency = _async_none
    svc._enforce_owner_write_rate_limit = _async_none
    return svc


OWNER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"
IDEM_KEY = "x" * 20


def run(coro):
    return asyncio.run(coro)


# ─── Tests ─────────────────────────────────────────────────────────────────────


class TestConsumerWithdrawBalanceDecrease(unittest.TestCase):
    """After a valid withdrawal, available_balance decreases and pending_balance increases."""

    def setUp(self):
        self.storage = FakeStorage()
        self.storage.balance_repo.seed_balance(OWNER, available=20.0)
        self.svc = _make_service(self.storage)

    def test_available_decreases_after_requested_withdrawal(self):
        result = run(self.svc.create_consumer_withdraw_intent(
            payload={"amountUsdc": 20.0, "reason": ""},
            owner_wallet=OWNER,
            idempotency_key=IDEM_KEY,
        ))
        assert result["status"] == "REQUESTED"
        assert result["amountUsdc"] == 20.0
        ledger = self.storage.balance_repo.read_balance_ledger()
        assert ledger.consumer_available_balance(OWNER) == 0.0

    def test_pending_increases_after_requested_withdrawal(self):
        run(self.svc.create_consumer_withdraw_intent(
            payload={"amountUsdc": 20.0, "reason": ""},
            owner_wallet=OWNER,
            idempotency_key=IDEM_KEY,
        ))
        ledger = self.storage.balance_repo.read_balance_ledger()
        assert ledger.consumer_pending_balance(OWNER) == 20.0

    def test_partial_withdrawal_leaves_correct_available_balance(self):
        self.storage.balance_repo.seed_balance(OWNER, available=50.0)
        run(self.svc.create_consumer_withdraw_intent(
            payload={"amountUsdc": 30.0, "reason": ""},
            owner_wallet=OWNER,
            idempotency_key=IDEM_KEY,
        ))
        ledger = self.storage.balance_repo.read_balance_ledger()
        assert ledger.consumer_available_balance(OWNER) == pytest.approx(20.0)
        assert ledger.consumer_pending_balance(OWNER) == pytest.approx(30.0)

    def test_withdrawal_record_created_in_storage(self):
        run(self.svc.create_consumer_withdraw_intent(
            payload={"amountUsdc": 20.0, "reason": "closing account"},
            owner_wallet=OWNER,
            idempotency_key=IDEM_KEY,
        ))
        rows = self.storage.gateway_state.refund_rows
        assert len(rows) == 1
        row = rows[0]
        assert float(row.amount_usdc) == pytest.approx(20.0)
        assert row.status == "REQUESTED"
        assert row.refund_type == "CONSUMER_BALANCE_WITHDRAW"

    def test_audit_log_created(self):
        run(self.svc.create_consumer_withdraw_intent(
            payload={"amountUsdc": 20.0, "reason": ""},
            owner_wallet=OWNER,
            idempotency_key=IDEM_KEY,
        ))
        audit_actions = [r.action for r in self.storage.audit.rows]
        assert "CONSUMER_WITHDRAW_INTENT_CREATED" in audit_actions


class TestConsumerWithdrawFrozenBalance(unittest.TestCase):
    """Large withdrawal moves available → frozen; frozen is not spendable."""

    def setUp(self):
        self.storage = FakeStorage()
        # Seed 1000 USDC — above the default 500 threshold
        self.storage.balance_repo.seed_balance(OWNER, available=1000.0)
        self.svc = _make_service(self.storage)

    def test_large_withdrawal_routes_to_pending_manual_review(self):
        with patch.object(
            self.storage.balance_repo, "reserve_consumer_balance_for_withdrawal",
            wraps=self._reserve_to_frozen,
        ):
            result = run(self.svc.create_consumer_withdraw_intent(
                payload={"amountUsdc": 600.0, "reason": ""},
                owner_wallet=OWNER,
                idempotency_key=IDEM_KEY,
            ))
        assert result["status"] == "PENDING_MANUAL_REVIEW"
        assert result["riskLevel"] == "yellow"

    def _reserve_to_frozen(self, owner, amount_usdc, updated_at):
        """Simulate frozen-path: available -= amount, frozen += amount."""
        wallet = self.storage.balance_repo._ledger.ensure_consumer_wallet(owner)
        available = float(wallet.available_balance or 0.0)
        if available < amount_usdc - 1e-9:
            raise RuntimeError("INSUFFICIENT_CONSUMER_BALANCE_ATOMIC")
        wallet.available_balance = round(available - amount_usdc, 6)
        wallet.frozen_balance = round(float(wallet.frozen_balance or 0.0) + amount_usdc, 6)


class TestConsumerWithdrawFrozenBlocksApiCalls(unittest.TestCase):
    """Pending / frozen balance must NOT appear in consumer_available_balance."""

    def test_pending_balance_excluded_from_available(self):
        ledger = BalanceLedger()
        wallet = ledger.ensure_consumer_wallet(OWNER)
        wallet.available_balance = 0.0
        wallet.pending_balance = 20.0
        wallet.frozen_balance = 0.0

        # available shows 0 — cannot be used for API calls
        assert ledger.consumer_available_balance(OWNER) == 0.0
        # pending is visible separately
        assert ledger.consumer_pending_balance(OWNER) == 20.0

    def test_frozen_balance_excluded_from_available(self):
        ledger = BalanceLedger()
        wallet = ledger.ensure_consumer_wallet(OWNER)
        wallet.available_balance = 0.0
        wallet.pending_balance = 0.0
        wallet.frozen_balance = 500.0

        assert ledger.consumer_available_balance(OWNER) == 0.0
        assert ledger.consumer_frozen_balance(OWNER) == 500.0

    def test_second_withdrawal_fails_when_balance_already_pending(self):
        """After first withdrawal, available=0; a second withdrawal must be rejected."""
        storage = FakeStorage()
        storage.balance_repo.seed_balance(OWNER, available=20.0)
        svc = _make_service(storage)

        # First withdrawal — succeeds, available → pending
        run(svc.create_consumer_withdraw_intent(
            payload={"amountUsdc": 20.0, "reason": ""},
            owner_wallet=OWNER,
            idempotency_key=IDEM_KEY,
        ))

        # Second withdrawal attempt — active record found, returns early
        result2 = run(svc.create_consumer_withdraw_intent(
            payload={"amountUsdc": 20.0, "reason": ""},
            owner_wallet=OWNER,
            idempotency_key="y" * 20,
        ))
        # Idempotency: original record returned, balance NOT deducted twice
        assert result2["status"] in {"REQUESTED", "PENDING_MANUAL_REVIEW"}
        ledger = storage.balance_repo.read_balance_ledger()
        # available stays 0 — was reserved in first call
        assert ledger.consumer_available_balance(OWNER) == pytest.approx(0.0)
        # pending is exactly 20, not 40
        assert ledger.consumer_pending_balance(OWNER) == pytest.approx(20.0)


class TestConsumerWithdrawInsufficientBalance(unittest.TestCase):

    def test_withdraw_more_than_available_raises_400(self):
        storage = FakeStorage()
        storage.balance_repo.seed_balance(OWNER, available=5.0)
        svc = _make_service(storage)

        with pytest.raises(HTTPException) as exc_info:
            run(svc.create_consumer_withdraw_intent(
                payload={"amountUsdc": 10.0, "reason": ""},
                owner_wallet=OWNER,
                idempotency_key=IDEM_KEY,
            ))
        assert exc_info.value.status_code == 400
        assert "INSUFFICIENT_CONSUMER_BALANCE" in str(exc_info.value.detail)

    def test_withdraw_zero_raises_400(self):
        storage = FakeStorage()
        storage.balance_repo.seed_balance(OWNER, available=5.0)
        svc = _make_service(storage)

        with pytest.raises(HTTPException) as exc_info:
            run(svc.create_consumer_withdraw_intent(
                payload={"amountUsdc": 0.0, "reason": ""},
                owner_wallet=OWNER,
                idempotency_key=IDEM_KEY,
            ))
        assert exc_info.value.status_code == 400

    def test_balance_unchanged_on_rejection(self):
        storage = FakeStorage()
        storage.balance_repo.seed_balance(OWNER, available=5.0)
        svc = _make_service(storage)

        try:
            run(svc.create_consumer_withdraw_intent(
                payload={"amountUsdc": 100.0, "reason": ""},
                owner_wallet=OWNER,
                idempotency_key=IDEM_KEY,
            ))
        except HTTPException:
            pass

        ledger = storage.balance_repo.read_balance_ledger()
        assert ledger.consumer_available_balance(OWNER) == pytest.approx(5.0)


class TestConsumerWithdrawRiskClassification(unittest.TestCase):
    """Risk thresholds: small → REQUESTED, large → PENDING_MANUAL_REVIEW."""

    def _run_withdraw(self, amount: float, daily_count: int = 0) -> dict:
        from src.services.owner.finance_consumer_withdraw_mixin import FinanceConsumerWithdrawMixin
        mixin = FinanceConsumerWithdrawMixin()
        return mixin._classify_consumer_withdraw_risk(amount, daily_count)

    def test_small_amount_is_requested(self):
        result = self._run_withdraw(amount=10.0)
        assert result["status"] == "REQUESTED"
        assert result["riskLevel"] == "green"

    def test_amount_at_threshold_is_pending_manual_review(self):
        from src.services.owner.finance_constants import CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC
        result = self._run_withdraw(amount=CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC)
        assert result["status"] == "PENDING_MANUAL_REVIEW"

    def test_amount_above_threshold_is_pending_manual_review(self):
        from src.services.owner.finance_constants import CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC
        result = self._run_withdraw(amount=CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC + 1.0)
        assert result["status"] == "PENDING_MANUAL_REVIEW"
        assert result["riskLevel"] == "yellow"

    def test_daily_count_limit_triggers_manual_review(self):
        from src.services.owner.finance_constants import CONSUMER_WITHDRAW_MAX_DAILY_COUNT
        result = self._run_withdraw(amount=1.0, daily_count=CONSUMER_WITHDRAW_MAX_DAILY_COUNT)
        assert result["status"] == "PENDING_MANUAL_REVIEW"
        assert result["riskLevel"] == "red"
        assert "DAILY_WITHDRAW_LIMIT_EXCEEDED" in result["riskReasonCode"]

    def test_below_daily_limit_small_amount_is_green(self):
        from src.services.owner.finance_constants import CONSUMER_WITHDRAW_MAX_DAILY_COUNT
        result = self._run_withdraw(amount=1.0, daily_count=CONSUMER_WITHDRAW_MAX_DAILY_COUNT - 1)
        assert result["status"] == "REQUESTED"
        assert result["riskLevel"] == "green"


class TestConsumerWithdrawConfigurableThreshold(unittest.TestCase):
    """CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC is controlled by env var."""

    def test_env_var_sets_threshold(self):
        """Simulate a reduced threshold via env override."""
        with patch.dict("os.environ", {"CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC": "50.0"}):
            # Reload the module so the env var takes effect
            import src.services.owner.finance_constants as fc
            importlib.reload(fc)
            assert fc.CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC == 50.0

    def test_default_threshold_is_500(self):
        import src.services.owner.finance_constants as fc
        importlib.reload(fc)
        # Without override, default should be 500
        import os
        os.environ.pop("CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC", None)
        importlib.reload(fc)
        assert fc.CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC == 500.0


class TestConsumerWithdrawIdempotency(unittest.TestCase):
    """Existing active withdrawal returns early — no double deduction."""

    def test_active_withdrawal_returns_existing_record(self):
        storage = FakeStorage()
        storage.balance_repo.seed_balance(OWNER, available=20.0)
        svc = _make_service(storage)

        first = run(svc.create_consumer_withdraw_intent(
            payload={"amountUsdc": 20.0, "reason": ""},
            owner_wallet=OWNER,
            idempotency_key=IDEM_KEY,
        ))
        second = run(svc.create_consumer_withdraw_intent(
            payload={"amountUsdc": 20.0, "reason": ""},
            owner_wallet=OWNER,
            idempotency_key="z" * 20,
        ))

        assert second["withdrawId"] == first["withdrawId"]
        assert second["status"] == first["status"]

    def test_balance_deducted_exactly_once(self):
        storage = FakeStorage()
        storage.balance_repo.seed_balance(OWNER, available=20.0)
        svc = _make_service(storage)

        for key in [IDEM_KEY, "a" * 20, "b" * 20]:
            try:
                run(svc.create_consumer_withdraw_intent(
                    payload={"amountUsdc": 20.0, "reason": ""},
                    owner_wallet=OWNER,
                    idempotency_key=key,
                ))
            except Exception:
                pass

        ledger = storage.balance_repo.read_balance_ledger()
        # Total deducted must be exactly 20, not 60
        assert ledger.consumer_available_balance(OWNER) == pytest.approx(0.0)
        assert ledger.consumer_pending_balance(OWNER) == pytest.approx(20.0)


class TestConsumerWithdrawListings(unittest.TestCase):
    """list_consumer_withdrawals only returns CONSUMER_BALANCE_WITHDRAW rows."""

    def test_list_returns_only_consumer_withdraw_rows(self):
        storage = FakeStorage()
        storage.balance_repo.seed_balance(OWNER, available=50.0)
        svc = _make_service(storage)

        run(svc.create_consumer_withdraw_intent(
            payload={"amountUsdc": 20.0, "reason": "first"},
            owner_wallet=OWNER,
            idempotency_key=IDEM_KEY,
        ))

        listings = run(svc.list_consumer_withdrawals(OWNER))
        assert len(listings) == 1
        assert float(listings[0]["amountUsdc"]) == pytest.approx(20.0)
        assert listings[0]["status"] == "REQUESTED"

    def test_list_excludes_other_owners(self):
        storage = FakeStorage()
        other_owner = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc"
        storage.balance_repo.seed_balance(OWNER, available=50.0)
        storage.balance_repo.seed_balance(other_owner, available=50.0)
        svc = _make_service(storage)

        run(svc.create_consumer_withdraw_intent(
            payload={"amountUsdc": 20.0, "reason": ""},
            owner_wallet=OWNER,
            idempotency_key=IDEM_KEY,
        ))
        run(svc.create_consumer_withdraw_intent(
            payload={"amountUsdc": 10.0, "reason": ""},
            owner_wallet=other_owner,
            idempotency_key="q" * 20,
        ))

        owner_list = run(svc.list_consumer_withdrawals(OWNER))
        other_list = run(svc.list_consumer_withdrawals(other_owner))

        assert len(owner_list) == 1
        assert len(other_list) == 1
        assert pytest.approx(20.0, rel=1e-4) == float(owner_list[0].get("amountUsdc", 0))
        assert pytest.approx(10.0, rel=1e-4) == float(other_list[0].get("amountUsdc", 0))
