# pyright: reportMissingImports=false

import pytest
from fastapi import HTTPException

from src.services.platform.balance_service import BalanceService


class _MockNonceCall:
    def __init__(self, nonce: int):
        self._nonce = nonce

    def call(self) -> int:
        return self._nonce


class _MockContractFunctions:
    def __init__(self, nonce: int):
        self._nonce = nonce

    def user_nonces(self, _address: str) -> _MockNonceCall:
        return _MockNonceCall(self._nonce)

    def __getattr__(self, name: str):
        if name == "userNonces":
            return self.user_nonces
        raise AttributeError(name)


class _MockContract:
    def __init__(self, nonce: int):
        self.functions = _MockContractFunctions(nonce)


class _MockEth:
    def __init__(self, chain_id: int):
        self.chain_id = chain_id


class _MockProvider:
    def __init__(self, chain_id: int):
        self.eth = _MockEth(chain_id)


def _stub_withdraw_contract(nonce: int = 3, chain_id: int = 31337):
    return _MockProvider(chain_id), _MockContract(nonce)


@pytest.mark.asyncio
async def test_create_provider_withdraw_intent_locks_receivable(monkeypatch, temp_storage):
    owner = "0xD856907D7E35A8F9BD225859A59E58577147A092"
    service = BalanceService(temp_storage)

    temp_storage.save_collection(
        "balance_ledger",
        {
            "buyers": {},
            "sellers": {owner.lower(): 12.5},
            "sellersLocked": {},
            "platform": {"feeAccrued": 0},
        },
    )

    monkeypatch.setattr(service, "_withdraw_contract", lambda: _stub_withdraw_contract(nonce=9, chain_id=31337))
    monkeypatch.setattr(service, "_require_withdraw_signer", lambda: "0x" + "11" * 32)
    monkeypatch.setattr(service, "_sign_withdraw_ticket", lambda _typed, _key: "0x" + "aa" * 65)

    result = await service.create_provider_withdraw_intent(
        payload={},
        owner_wallet=owner,
        idempotency_key="provider-withdraw-0001",
        request_meta={"requestId": "req-1"},
    )

    assert result["status"] == "PENDING"
    assert abs(float(result["amountUsdc"]) - 12.5) < 1e-9
    assert int(result["ticket"]["nonce"]) == 9

    ledger = temp_storage.get_collection("balance_ledger")
    assert abs(float(ledger["sellers"][owner.lower()]) - 0.0) < 1e-9
    assert abs(float(ledger["sellersLocked"][owner.lower()]) - 12.5) < 1e-9


@pytest.mark.asyncio
async def test_create_provider_withdraw_intent_is_idempotent(monkeypatch, temp_storage):
    owner = "0xD856907D7E35A8F9BD225859A59E58577147A092"
    service = BalanceService(temp_storage)

    temp_storage.save_collection(
        "balance_ledger",
        {
            "buyers": {},
            "sellers": {owner.lower(): 5.0},
            "sellersLocked": {},
            "platform": {"feeAccrued": 0},
        },
    )

    monkeypatch.setattr(service, "_withdraw_contract", lambda: _stub_withdraw_contract(nonce=4, chain_id=31337))
    monkeypatch.setattr(service, "_require_withdraw_signer", lambda: "0x" + "11" * 32)
    monkeypatch.setattr(service, "_sign_withdraw_ticket", lambda _typed, _key: "0x" + "bb" * 65)

    first = await service.create_provider_withdraw_intent(
        payload={"amountUsdc": 5},
        owner_wallet=owner,
        idempotency_key="provider-withdraw-0002",
        request_meta={"requestId": "req-2"},
    )
    second = await service.create_provider_withdraw_intent(
        payload={"amountUsdc": 5},
        owner_wallet=owner,
        idempotency_key="provider-withdraw-0002",
        request_meta={"requestId": "req-2-repeat"},
    )

    assert first["withdrawalId"] == second["withdrawalId"]

    rows = temp_storage.get_collection("provider_withdrawal_intents")
    assert isinstance(rows, dict)
    assert len(rows.get("rows") or []) == 1


@pytest.mark.asyncio
async def test_create_provider_withdraw_intent_rejects_parallel_pending(monkeypatch, temp_storage):
    owner = "0xD856907D7E35A8F9BD225859A59E58577147A092"
    service = BalanceService(temp_storage)

    temp_storage.save_collection(
        "balance_ledger",
        {
            "buyers": {},
            "sellers": {owner.lower(): 9.0},
            "sellersLocked": {},
            "platform": {"feeAccrued": 0},
        },
    )

    monkeypatch.setattr(service, "_withdraw_contract", lambda: _stub_withdraw_contract(nonce=1, chain_id=31337))
    monkeypatch.setattr(service, "_require_withdraw_signer", lambda: "0x" + "11" * 32)
    monkeypatch.setattr(service, "_sign_withdraw_ticket", lambda _typed, _key: "0x" + "cc" * 65)

    await service.create_provider_withdraw_intent(
        payload={"amountUsdc": 3},
        owner_wallet=owner,
        idempotency_key="provider-withdraw-0003",
        request_meta={"requestId": "req-3"},
    )

    with pytest.raises(HTTPException) as exc:
        await service.create_provider_withdraw_intent(
            payload={"amountUsdc": 2},
            owner_wallet=owner,
            idempotency_key="provider-withdraw-0004",
            request_meta={"requestId": "req-4"},
        )

    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "PENDING_WITHDRAWAL_EXISTS"


@pytest.mark.asyncio
async def test_complete_provider_withdrawal_releases_lock_and_is_idempotent(monkeypatch, temp_storage):
    owner = "0xD856907D7E35A8F9BD225859A59E58577147A092"
    service = BalanceService(temp_storage)

    temp_storage.save_collection(
        "balance_ledger",
        {
            "buyers": {},
            "sellers": {owner.lower(): 0.0},
            "sellersLocked": {owner.lower(): 4.0},
            "platform": {"feeAccrued": 0},
        },
    )
    temp_storage.save_collection(
        "provider_withdrawal_intents",
        {
            "rows": [
                {
                    "id": "wd-1",
                    "ownerAddress": owner.lower(),
                    "amountUsdc": 4.0,
                    "status": "PENDING",
                    "nonce": 5,
                    "createdAt": 1,
                    "updatedAt": 1,
                }
            ]
        },
    )

    done = await service.complete_provider_withdrawal(
        owner_wallet=owner,
        withdrawal_id="wd-1",
        tx_hash="0x" + "12" * 32,
        request_meta={"requestId": "req-5"},
    )

    assert done["status"] == "COMPLETED"
    assert done["txHash"] == "0x" + "12" * 32

    ledger = temp_storage.get_collection("balance_ledger")
    assert abs(float(ledger["sellersLocked"][owner.lower()]) - 0.0) < 1e-9

    again = await service.complete_provider_withdrawal(
        owner_wallet=owner,
        withdrawal_id="wd-1",
        tx_hash="0x" + "12" * 32,
        request_meta={"requestId": "req-5-repeat"},
    )
    assert again["status"] == "COMPLETED"

    with pytest.raises(HTTPException) as exc:
        await service.complete_provider_withdrawal(
            owner_wallet=owner,
            withdrawal_id="wd-1",
            tx_hash="0x" + "34" * 32,
            request_meta={"requestId": "req-6"},
        )
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "WITHDRAWAL_ALREADY_COMPLETED"


@pytest.mark.asyncio
async def test_complete_provider_withdrawal_uses_db_tx_dedup_hook(temp_storage):
    owner = "0xD856907D7E35A8F9BD225859A59E58577147A092"
    service = BalanceService(temp_storage)

    temp_storage.save_collection(
        "balance_ledger",
        {
            "buyers": {},
            "sellers": {owner.lower(): 0.0},
            "sellersLocked": {owner.lower(): 1.5},
            "platform": {"feeAccrued": 0},
        },
    )
    temp_storage.save_collection(
        "provider_withdrawal_intents",
        {
            "rows": [
                {
                    "id": "wd-db-1",
                    "ownerAddress": owner.lower(),
                    "amountUsdc": 1.5,
                    "status": "PENDING",
                    "nonce": 7,
                    "createdAt": 1,
                    "updatedAt": 1,
                }
            ]
        },
    )

    dedup_state = {"seen": set()}

    def _complete_withdraw_tx_atomic(owner_wallet: str, tx_hash: str, kind: str) -> bool:
        key = (owner_wallet, tx_hash, kind)
        if key in dedup_state["seen"]:
            return False
        dedup_state["seen"].add(key)
        return True

    setattr(temp_storage, "complete_withdraw_tx_atomic", _complete_withdraw_tx_atomic)

    tx_hash = "0x" + "45" * 32
    done = await service.complete_provider_withdrawal(owner_wallet=owner, withdrawal_id="wd-db-1", tx_hash=tx_hash)
    assert done["status"] == "COMPLETED"

    with pytest.raises(HTTPException) as exc:
        await service.complete_provider_withdrawal(owner_wallet=owner, withdrawal_id="wd-db-1", tx_hash=tx_hash)
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "WITHDRAWAL_TX_REPLAY_DETECTED"
