# pyright: reportMissingImports=false

import asyncio

import pytest
from fastapi import HTTPException

from src.core.redis_lock import RedisLockManager
from src.services.buyer.finance_service import BuyerFinanceService


async def _no_redis():
    await asyncio.sleep(0)
    return None


def _seed_buyer_balance(storage, owner: str, amount: float) -> None:
    ledger = storage.get_collection("balance_ledger") or {}
    if not isinstance(ledger, dict):
        ledger = {}
    buyers = ledger.get("buyers") if isinstance(ledger.get("buyers"), dict) else {}
    buyers_locked = ledger.get("buyersLocked") if isinstance(ledger.get("buyersLocked"), dict) else {}
    buyers[str(owner).lower()] = round(float(amount), 6)
    ledger["buyers"] = buyers
    ledger["buyersLocked"] = buyers_locked
    storage.save_collection("balance_ledger", ledger)


@pytest.mark.asyncio
async def test_buyer_refund_creates_pending_and_locks_balance(temp_storage):
    owner = "0xabc123"
    _seed_buyer_balance(temp_storage, owner, 80)

    service = BuyerFinanceService(
        storage=temp_storage,
        mutation_lock=RedisLockManager(redis_getter=_no_redis),
    )

    result = await service.process_refund_intent(
        payload={"amountUsdc": 25, "reason": "unit-refund"},
        owner_wallet=owner,
        idempotency_key="buyer-refund-pending-0001",
    )

    assert result["status"] == "PENDING"
    assert result["gasPayer"] == "BUYER"

    ledger = temp_storage.get_collection("balance_ledger")
    assert abs(float(ledger["buyers"][owner]) - 55.0) < 1e-9
    assert abs(float(ledger["buyersLocked"][owner]) - 25.0) < 1e-9


@pytest.mark.asyncio
async def test_buyer_refund_rejects_second_pending_intent(temp_storage):
    owner = "0xabc123"
    _seed_buyer_balance(temp_storage, owner, 80)

    service = BuyerFinanceService(
        storage=temp_storage,
        mutation_lock=RedisLockManager(redis_getter=_no_redis),
    )

    await service.process_refund_intent(
        payload={"amountUsdc": 20, "reason": "first"},
        owner_wallet=owner,
        idempotency_key="buyer-refund-pending-0002",
    )

    with pytest.raises(HTTPException) as exc:
        await service.process_refund_intent(
            payload={"amountUsdc": 21, "reason": "second"},
            owner_wallet=owner,
            idempotency_key="buyer-refund-pending-0003",
        )

    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "PENDING_REFUND_EXISTS"


@pytest.mark.asyncio
async def test_buyer_refund_complete_is_idempotent_and_replay_safe(temp_storage):
    owner = "0xabc123"
    _seed_buyer_balance(temp_storage, owner, 80)

    service = BuyerFinanceService(
        storage=temp_storage,
        mutation_lock=RedisLockManager(redis_getter=_no_redis),
    )

    created = await service.process_refund_intent(
        payload={"amountUsdc": 30, "reason": "complete"},
        owner_wallet=owner,
        idempotency_key="buyer-refund-pending-0004",
    )

    refund_id = str(created["refundId"])
    tx_hash = "0x" + "1" * 64

    done = await service.complete_refund_intent(owner, refund_id, tx_hash)
    assert done["status"] == "COMPLETED"

    same = await service.complete_refund_intent(owner, refund_id, tx_hash)
    assert same["status"] == "COMPLETED"

    with pytest.raises(HTTPException) as exc:
        await service.complete_refund_intent(owner, refund_id, "0x" + "2" * 64)
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "REFUND_ALREADY_COMPLETED"
