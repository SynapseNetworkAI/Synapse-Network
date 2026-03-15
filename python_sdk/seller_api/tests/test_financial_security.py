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

from src.services.platform.balance_service import BalanceService  # noqa: E402


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


def _set_buyer_balance(balance_service, owner: str, amount: float) -> None:
    ledger = balance_service.storage.get_collection("balance_ledger") or {}
    if not isinstance(ledger, dict):
        ledger = {}
    buyers = ledger.get("buyers") if isinstance(ledger.get("buyers"), dict) else {}
    buyers_locked = ledger.get("buyersLocked") if isinstance(ledger.get("buyersLocked"), dict) else {}
    buyers[str(owner).lower()] = round(float(amount), 6)
    ledger["buyers"] = buyers
    ledger["buyersLocked"] = buyers_locked
    balance_service.storage.save_collection("balance_ledger", ledger)


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
async def test_deposit_uses_atomic_storage_hook_when_available(balance_service):
    called = {"ok": False}

    def _register_deposit_intent_atomic(**kwargs):
        called["ok"] = True
        row = dict(kwargs["intent_row"])
        row["id"] = "dep-atomic-1"
        return row

    setattr(balance_service.storage, "register_deposit_intent_atomic", _register_deposit_intent_atomic)

    result = await balance_service.register_deposit_intent(
        {"txHash": "0x" + "2" * 64, "amountUsdc": 12.345678},
        "0xowner",
        "deposit_key_atomic_123456",
    )

    assert called["ok"] is True
    assert result["id"] == "dep-atomic-1"


@pytest.mark.asyncio
async def test_owner_scope_isolation_for_refunds(balance_service):
    _set_buyer_balance(balance_service, "0xowner1", 100)
    _set_buyer_balance(balance_service, "0xowner2", 100)
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
    _set_buyer_balance(balance_service, "0xowner", 100)
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
    _set_buyer_balance(balance_service, "0xowner", 100)
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


@pytest.mark.asyncio
async def test_refund_pending_and_completion_replay_guard(balance_service):
    owner = "0xowner"
    _set_buyer_balance(balance_service, owner, 120)

    created = await balance_service.process_refund_intent(
        {"amountUsdc": 25, "reason": "exit"},
        owner,
        "refund_pending_123456",
    )
    assert created["status"] == "PENDING"
    assert created["gasPayer"] == "BUYER"

    with pytest.raises(HTTPException) as pending_exc:
        await balance_service.process_refund_intent(
            {"amountUsdc": 30, "reason": "second"},
            owner,
            "refund_pending_654321",
        )
    assert pending_exc.value.status_code == 409

    refund_id = str(created["refundId"])
    tx_hash = "0x" + "a" * 64
    completed = await balance_service.complete_refund_intent(owner, refund_id, tx_hash)
    assert completed["status"] == "COMPLETED"

    completed_again = await balance_service.complete_refund_intent(owner, refund_id, tx_hash)
    assert completed_again["status"] == "COMPLETED"

    with pytest.raises(HTTPException) as replay_exc:
        await balance_service.complete_refund_intent(owner, refund_id, "0x" + "b" * 64)
    assert replay_exc.value.status_code == 409
