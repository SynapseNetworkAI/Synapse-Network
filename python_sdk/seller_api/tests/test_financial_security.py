# pyright: reportMissingImports=false

import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = ROOT / "seller_api"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from src.services.balance_service import BalanceService  # noqa: E402


class FakeRedis:
    def __init__(self):
        self.store = {}
        self.expire_map = {}

    async def ping(self):
        await asyncio.sleep(0)
        return True

    async def get(self, key):
        await asyncio.sleep(0)
        return self.store.get(key)

    async def set(self, key, value, ex=None, nx=False):
        await asyncio.sleep(0)
        if nx and key in self.store:
            return False
        self.store[key] = value
        if ex is not None:
            self.expire_map[key] = int(ex)
        return True

    async def incr(self, key):
        await asyncio.sleep(0)
        value = int(self.store.get(key, "0")) + 1
        self.store[key] = str(value)
        return value

    async def expire(self, key, ttl):
        await asyncio.sleep(0)
        self.expire_map[key] = int(ttl)
        return True


@pytest.fixture()
def balance_service(temp_storage):
    return BalanceService(temp_storage)


@pytest.mark.asyncio
async def test_refund_min_amount_enforced(balance_service):
    with pytest.raises(HTTPException) as exc:
        await balance_service.process_refund_intent(
            {"amountUsdc": 9.99, "reason": "too-small"},
            "0xabc",
            "refund_key_1234567890",
        )
    assert exc.value.status_code == 400
    assert "10 USDC" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_deposit_replay_protection(balance_service):
    await balance_service.register_deposit_intent(
        {"txHash": "0x" + "1" * 64, "amountUsdc": 15},
        "0xowner",
        "deposit_key_1234567890",
    )

    with pytest.raises(HTTPException) as exc:
        await balance_service.register_deposit_intent(
            {"txHash": "0x" + "1" * 64, "amountUsdc": 15},
            "0xowner",
            "deposit_key_abcdefghijk1",
        )
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_owner_scope_isolation_for_refunds(balance_service):
    await balance_service.process_refund_intent(
        {"amountUsdc": 12, "reason": "r1"},
        "0xowner1",
        "refund_key_owner1_123456",
    )
    await balance_service.process_refund_intent(
        {"amountUsdc": 18, "reason": "r2"},
        "0xowner2",
        "refund_key_owner2_123456",
    )

    owner1_rows = await balance_service.list_refunds("0xowner1")
    owner2_rows = await balance_service.list_refunds("0xowner2")

    assert len(owner1_rows) == 1
    assert len(owner2_rows) == 1
    assert owner1_rows[0]["ownerAddress"] == "0xowner1"
    assert owner2_rows[0]["ownerAddress"] == "0xowner2"


@pytest.mark.asyncio
async def test_idempotency_consistency_with_concurrency(balance_service):
    key = "refund_key_concurrency_1234"

    async def _call_once():
        return await balance_service.process_refund_intent(
            {"amountUsdc": 20, "reason": "concurrency"},
            "0xowner",
            key,
        )

    first, second = await asyncio.gather(_call_once(), _call_once())
    assert first["refundId"] == second["refundId"]
    assert first["amountRefunded"] == second["amountRefunded"]


@pytest.mark.asyncio
async def test_redis_distributed_rate_limit_is_used(balance_service, monkeypatch):
    fake = FakeRedis()

    async def _fake_get_redis_client():
        await asyncio.sleep(0)
        return fake

    monkeypatch.setattr(balance_service, "_get_redis_client", _fake_get_redis_client)

    await balance_service.set_router_config("0xowner", 100)
    await balance_service.set_router_config("0xowner", 100)

    # Force a tiny limit by monkeypatching config value at runtime.
    from src.core import config as cfg

    old_limit = cfg.settings.finance_write_rate_limit_per_min
    cfg.settings.finance_write_rate_limit_per_min = 2
    try:
        with pytest.raises(HTTPException) as exc:
            await balance_service.set_router_config("0xowner", 100)
        assert exc.value.status_code == 429
    finally:
        cfg.settings.finance_write_rate_limit_per_min = old_limit

    # Verify Redis increment key pattern exists.
    assert any(k.startswith("finance:rl:0xowner:router_config:") for k in fake.store.keys())


@pytest.mark.asyncio
async def test_idempotency_payload_mismatch_returns_409(balance_service):
    key = "refund_key_mismatch_12345"
    await balance_service.process_refund_intent(
        {"amountUsdc": 20, "reason": "mismatch-a"},
        "0xowner",
        key,
    )

    with pytest.raises(HTTPException) as exc:
        await balance_service.process_refund_intent(
            {"amountUsdc": 21, "reason": "mismatch-b"},
            "0xowner",
            key,
        )
    assert exc.value.status_code == 409
