# pyright: reportMissingImports=false

import asyncio

import pytest
from fastapi import HTTPException

from src.core.redis_lock import RedisLockManager
from src.services.platform.finance_service import PlatformFinanceService


async def _no_redis():
    await asyncio.sleep(0)
    return None


@pytest.mark.asyncio
async def test_platform_get_balance_owner_scoped(temp_storage):
    owner = "0xabc123"
    other = "0xdef456"
    temp_storage.save_collection(
        "balance_ledger",
        {
            "buyers": {owner: 10.0, other: 999.0},
            "sellers": {owner: 2.5, other: 111.0},
            "sellersLocked": {owner: 1.25, other: 222.0},
            "platform": {"feeAccrued": 7.75},
            "updatedAt": 123,
        },
    )

    service = PlatformFinanceService(
        storage=temp_storage,
        mutation_lock=RedisLockManager(redis_getter=_no_redis),
    )
    result = await service.get_balance(owner)

    assert result["ownerAddress"] == owner
    assert abs(result["buyerBalance"] - 10.0) < 1e-9
    assert abs(result["sellerReceivable"] - 2.5) < 1e-9
    assert abs(result["sellerLocked"] - 1.25) < 1e-9
    assert abs(result["platformFeeAccrued"] - 7.75) < 1e-9
    assert result["updatedAt"] == 123


@pytest.mark.asyncio
async def test_platform_set_router_config_upsert_and_bounds(temp_storage):
    owner = "0xabc123"
    service = PlatformFinanceService(
        storage=temp_storage,
        mutation_lock=RedisLockManager(redis_getter=_no_redis),
    )

    saved = await service.set_router_config(owner, 100.0, request_meta={"requestId": "req-1"})
    assert saved["ownerAddress"] == owner
    assert abs(saved["dailyLimitUsdc"] - 100.0) < 1e-9

    fetched = await service.get_router_config(owner)
    assert abs(fetched["dailyLimitUsdc"] - 100.0) < 1e-9

    updated = await service.set_router_config(owner, 250.0, request_meta={"requestId": "req-2"})
    assert abs(updated["dailyLimitUsdc"] - 250.0) < 1e-9

    rows = temp_storage.get_collection("router_config")
    assert isinstance(rows, dict)
    assert len(rows.get("rows") or []) == 1

    with pytest.raises(HTTPException) as exc:
        await service.set_router_config(owner, 10_001.0)
    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "INVALID_DAILY_LIMIT"
