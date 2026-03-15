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


def _seed_refundable_usage(storage, owner: str, origin_request_id: str, total_charge: float) -> None:
    rows = storage.get_collection("usage_log")
    usage_rows = [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []
    usage_rows.append(
        {
            "id": f"usage-{origin_request_id}",
            "buyer": str(owner).lower(),
            "seller": "0xseller",
            "status": "succeeded",
            "totalCharge": round(float(total_charge), 6),
            "originRequestId": origin_request_id,
            "timestamp": 1700000000,
        }
    )
    storage.save_collection("usage_log", usage_rows)


@pytest.mark.asyncio
async def test_buyer_refund_creates_pending_and_locks_balance(temp_storage):
    owner = "0xabc123"
    origin_request_id = "req-unit-refund-1"
    _seed_buyer_balance(temp_storage, owner, 80)
    _seed_refundable_usage(temp_storage, owner, origin_request_id, 50)

    service = BuyerFinanceService(
        storage=temp_storage,
        mutation_lock=RedisLockManager(redis_getter=_no_redis),
    )

    result = await service.process_refund_intent(
        payload={"amountUsdc": 25, "reason": "unit-refund", "originRequestId": origin_request_id},
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
    origin_request_id = "req-unit-refund-2"
    _seed_buyer_balance(temp_storage, owner, 80)
    _seed_refundable_usage(temp_storage, owner, origin_request_id, 60)

    service = BuyerFinanceService(
        storage=temp_storage,
        mutation_lock=RedisLockManager(redis_getter=_no_redis),
    )

    await service.process_refund_intent(
        payload={"amountUsdc": 20, "reason": "first", "originRequestId": origin_request_id},
        owner_wallet=owner,
        idempotency_key="buyer-refund-pending-0002",
    )

    with pytest.raises(HTTPException) as exc:
        await service.process_refund_intent(
            payload={"amountUsdc": 21, "reason": "second", "originRequestId": origin_request_id},
            owner_wallet=owner,
            idempotency_key="buyer-refund-pending-0003",
        )

    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "PENDING_REFUND_EXISTS"


@pytest.mark.asyncio
async def test_buyer_refund_complete_is_idempotent_and_replay_safe(temp_storage):
    owner = "0xabc123"
    origin_request_id = "req-unit-refund-3"
    _seed_buyer_balance(temp_storage, owner, 80)
    _seed_refundable_usage(temp_storage, owner, origin_request_id, 70)

    service = BuyerFinanceService(
        storage=temp_storage,
        mutation_lock=RedisLockManager(redis_getter=_no_redis),
    )

    created = await service.process_refund_intent(
        payload={"amountUsdc": 30, "reason": "complete", "originRequestId": origin_request_id},
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


@pytest.mark.asyncio
async def test_buyer_refund_requires_origin_reference(temp_storage):
    owner = "0xabc123"
    _seed_buyer_balance(temp_storage, owner, 80)
    service = BuyerFinanceService(
        storage=temp_storage,
        mutation_lock=RedisLockManager(redis_getter=_no_redis),
    )

    with pytest.raises(HTTPException) as exc:
        await service.process_refund_intent(
            payload={"amountUsdc": 20, "reason": "missing-origin"},
            owner_wallet=owner,
            idempotency_key="buyer-refund-origin-required-0001",
        )
    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "REFUND_ORIGIN_REQUIRED"


@pytest.mark.asyncio
async def test_buyer_refund_blocks_amount_exceeding_origin_remaining(temp_storage):
    owner = "0xabc123"
    origin_request_id = "req-unit-refund-limit-1"
    _seed_buyer_balance(temp_storage, owner, 120)
    _seed_refundable_usage(temp_storage, owner, origin_request_id, 30)

    service = BuyerFinanceService(
        storage=temp_storage,
        mutation_lock=RedisLockManager(redis_getter=_no_redis),
    )

    with pytest.raises(HTTPException) as exc:
        await service.process_refund_intent(
            payload={"amountUsdc": 40, "reason": "too-much", "originRequestId": origin_request_id},
            owner_wallet=owner,
            idempotency_key="buyer-refund-limit-0001",
        )
    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "REFUND_EXCEEDS_ORIGIN_LIMIT"


@pytest.mark.asyncio
async def test_manual_review_refund_reject_releases_locked_amount(temp_storage):
    owner = "0xabc123"
    origin_request_id = "req-unit-refund-review-1"
    _seed_buyer_balance(temp_storage, owner, 800)
    _seed_refundable_usage(temp_storage, owner, origin_request_id, 800)

    service = BuyerFinanceService(
        storage=temp_storage,
        mutation_lock=RedisLockManager(redis_getter=_no_redis),
    )

    created = await service.process_refund_intent(
        payload={
            "amountUsdc": 600,
            "reason": "manual-review",
            "originRequestId": origin_request_id,
            "refundType": "MANUAL_APPEAL",
        },
        owner_wallet=owner,
        idempotency_key="buyer-refund-manual-0001",
    )
    assert created["status"] == "PENDING_MANUAL_REVIEW"

    refund_id = str(created["refundId"])
    rejected = await service.complete_refund_intent(
        owner,
        refund_id,
        "0x" + "3" * 64,
        request_meta={
            "review": {
                "decision": "REJECT",
                "reviewerAddress": "0xreviewer",
                "reviewerNote": "evidence not sufficient",
            }
        },
    )
    assert rejected["status"] == "REJECTED"

    ledger = temp_storage.get_collection("balance_ledger")
    assert abs(float(ledger["buyers"][owner]) - 800.0) < 1e-9
    assert abs(float(ledger["buyersLocked"][owner]) - 0.0) < 1e-9
