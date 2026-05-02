from __future__ import annotations

import time
from decimal import Decimal
from unittest.mock import patch

from src.core.config import settings
from src.services.platform.tasks import consumer_withdraw_processor as withdraw_processor

from tests.unit.test_consumer_withdraw_unit import (
    FakeStorage,
    _make_service,
    run,
)


def _created_at_seconds_ago(seconds: int) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(time.time() - seconds))


def test_processor_expires_manual_review_and_releases_frozen() -> None:
    storage = FakeStorage()
    owner = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"
    storage.balance_repo.seed_balance(owner, available=600.0)
    svc = _make_service(storage)
    run(
        svc.create_consumer_withdraw_intent(
            payload={"amountUsdc": 600.0, "reason": "manual expiry"},
            owner_wallet=owner,
            idempotency_key="manual-expiry-key-001",
        )
    )
    storage.gateway_state.refund_rows[0].created_at = _created_at_seconds_ago(5)

    with (
        patch.object(settings, "withdrawal_manual_review_expiry_min_sec", 1),
        patch.object(settings, "withdrawal_manual_review_expiry_sec", 3),
    ):
        result = run(withdraw_processor.run_consumer_withdraw_processor_once(storage))

    ledger = storage.balance_repo.read_balance_ledger()
    assert result.completedOrExpired == 1
    assert ledger.consumer_available_balance(owner) == Decimal("600.000000")
    assert ledger.consumer_frozen_balance(owner) == Decimal("0.000000")
    assert storage.gateway_state.refund_rows[0].status == "FAILED_EXPIRED"
    assert "safely returned" in str(storage.gateway_state.refund_rows[0].message or "")


def test_processor_keeps_fresh_manual_review_pending_with_short_expiry() -> None:
    storage = FakeStorage()
    owner = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"
    storage.balance_repo.seed_balance(owner, available=600.0)
    svc = _make_service(storage)
    run(
        svc.create_consumer_withdraw_intent(
            payload={"amountUsdc": 600.0, "reason": "manual expiry fresh"},
            owner_wallet=owner,
            idempotency_key="manual-expiry-key-002",
        )
    )
    storage.gateway_state.refund_rows[0].created_at = _created_at_seconds_ago(1)

    with (
        patch.object(settings, "withdrawal_manual_review_expiry_min_sec", 1),
        patch.object(settings, "withdrawal_manual_review_expiry_sec", 3),
    ):
        result = run(withdraw_processor.run_consumer_withdraw_processor_once(storage))

    ledger = storage.balance_repo.read_balance_ledger()
    assert result.completedOrExpired == 0
    assert ledger.consumer_available_balance(owner) == Decimal("0.000000")
    assert ledger.consumer_frozen_balance(owner) == Decimal("600.000000")
    assert storage.gateway_state.refund_rows[0].status == "PENDING_MANUAL_REVIEW"


def test_processor_limits_manual_review_expiry_batch_size() -> None:
    storage = FakeStorage()
    owners = [f"0x{i:040x}" for i in range(1, 4)]
    svc = _make_service(storage)
    for index, owner in enumerate(owners):
        storage.balance_repo.seed_balance(owner, available=600.0)
        run(
            svc.create_consumer_withdraw_intent(
                payload={"amountUsdc": 600.0, "reason": f"manual expiry {index}"},
                owner_wallet=owner,
                idempotency_key=f"manual-expiry-{index}".rjust(20, "x"),
            )
        )
    for row in storage.gateway_state.refund_rows:
        row.created_at = _created_at_seconds_ago(5)

    with (
        patch.object(settings, "withdrawal_manual_review_expiry_min_sec", 1),
        patch.object(settings, "withdrawal_manual_review_expiry_sec", 3),
        patch.object(settings, "withdrawal_reaper_batch_size", 2),
    ):
        result = run(withdraw_processor.run_consumer_withdraw_processor_once(storage))

    statuses = [row.status for row in storage.gateway_state.refund_rows]
    assert result.completedOrExpired == 2
    assert statuses.count("FAILED_EXPIRED") == 2
    assert statuses.count("PENDING_MANUAL_REVIEW") == 1
