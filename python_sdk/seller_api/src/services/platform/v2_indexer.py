import asyncio
import json
import os
import time
from threading import Lock
from typing import Any, Dict, List, Optional
from uuid import uuid4

from web3 import Web3
from web3.exceptions import TransactionNotFound

from src.core.common import normalize_wallet
from src.core.config import settings
from src.storage.finance_repository import FinanceRepository
from src.storage import BaseStorage

lock = Lock()
w3 = Web3(Web3.HTTPProvider(settings.rpc_url))

INDEXER_STATUS: Dict[str, Any] = {
    "running": False,
    "listenerAddress": normalize_wallet(settings.router_address),
    "lastCounters": {"credited": 0, "failed": 0, "pending": 0},
    "lastProcessedAt": None,
    "lastError": None,
}


def _set_status(**kwargs: Any) -> None:
    with lock:
        INDEXER_STATUS.update(kwargs)


def get_indexer_status() -> Dict[str, Any]:
    with lock:
        return {
            "running": bool(INDEXER_STATUS.get("running")),
            "listenerAddress": str(INDEXER_STATUS.get("listenerAddress") or ""),
            "lastCounters": dict(INDEXER_STATUS.get("lastCounters") or {"credited": 0, "failed": 0, "pending": 0}),
            "lastProcessedAt": INDEXER_STATUS.get("lastProcessedAt"),
            "lastError": INDEXER_STATUS.get("lastError"),
            "pollIntervalSec": settings.v2_indexer_poll_interval_sec,
        }

TRANSFER_TOPIC = Web3.to_hex(Web3.keccak(text="Transfer(address,address,uint256)")).lower()
TOKEN_DECIMALS_CACHE: Dict[str, int] = {}


def _now() -> int:
    return int(time.time())


def _load_deposit_intents(storage: BaseStorage) -> List[Dict[str, Any]]:
    return FinanceRepository(storage).load_deposit_intents()


def _save_deposit_intents(storage: BaseStorage, rows: List[Dict[str, Any]]) -> None:
    FinanceRepository(storage).save_deposit_intents(rows)


def _load_balance_ledger(storage: BaseStorage) -> Dict[str, Any]:
    return FinanceRepository(storage).load_balance_ledger()


def _save_balance_ledger(storage: BaseStorage, ledger: Dict[str, Any]) -> None:
    FinanceRepository(storage).save_balance_ledger(ledger)


def _load_processed_deposit_event_keys(storage: BaseStorage) -> List[str]:
    return FinanceRepository(storage).load_processed_deposit_event_keys()


def _save_processed_deposit_event_keys(storage: BaseStorage, keys: List[str]) -> None:
    FinanceRepository(storage).save_processed_deposit_event_keys(keys, _now())


def _append_audit_log(storage: BaseStorage, action: str, owner_wallet: str, details: Dict[str, Any]) -> None:
    FinanceRepository(storage).append_audit_log(
        {
            "id": str(uuid4()),
            "timestamp": _now(),
            "action": action,
            "ownerAddress": normalize_wallet(owner_wallet),
            "details": details,
        }
    )


def _normalize_tx_hash(value: str) -> str:
    tx_hash = str(value or "").strip().lower()
    if tx_hash.startswith("0x") and len(tx_hash) == 66:
        return tx_hash
    return ""


def _topic_to_address(topic: Any) -> str:
    topic_hex = Web3.to_hex(topic).lower()
    if len(topic_hex) < 42:
        return ""
    return Web3.to_checksum_address("0x" + topic_hex[-40:]).lower()


def _make_event_row(tx_hash: str, log_index: int, buyer: str, amount_raw: int, token: str) -> Optional[Dict[str, Any]]:
    normalized_buyer = normalize_wallet(buyer)
    if not normalized_buyer or amount_raw <= 0:
        return None
    return {
        "eventKey": f"{tx_hash}:{log_index}",
        "buyer": normalized_buyer,
        "amountRaw": amount_raw,
        "token": normalize_wallet(token),
        "logIndex": log_index,
    }


def _decode_amount_raw(data: Any) -> int:
    if isinstance(data, int):
        return data
    if isinstance(data, (bytes, bytearray)):
        return int.from_bytes(data, byteorder="big", signed=False)
    try:
        return int(str(data), 16)
    except Exception:
        return 0


def _extract_router_event_rows(contract: Any, event_name: str, tx_receipt: Any, tx_hash: str) -> List[Dict[str, Any]]:
    event_cls = getattr(contract.events, event_name, None)
    if event_cls is None:
        return []

    try:
        rows = event_cls().process_receipt(tx_receipt)
    except Exception:
        return []

    parsed: List[Dict[str, Any]] = []
    for row in rows:
        args = row.get("args", {})
        maybe_event = _make_event_row(
            tx_hash,
            int(row.get("logIndex", 0)),
            str(args.get("buyer") or args.get("from") or ""),
            int(args.get("amount") or args.get("value") or 0),
            str(args.get("token") or ""),
        )
        if maybe_event:
            parsed.append(maybe_event)

    return parsed


def _decode_router_deposit_events(tx_receipt: Any) -> List[Dict[str, Any]]:
    abi_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "A2APaySyncRouterABI.json")
    if not os.path.exists(abi_path):
        return []

    try:
        with open(abi_path, "r", encoding="utf-8") as file:
            router_abi = json.load(file)
        contract = w3.eth.contract(address=w3.to_checksum_address(settings.router_address), abi=router_abi)
    except Exception:
        return []

    tx_hash = tx_receipt["transactionHash"].hex().lower()
    events: List[Dict[str, Any]] = []
    for event_name in ("DepositInfo", "Deposit", "Deposited"):
        events.extend(_extract_router_event_rows(contract, event_name, tx_receipt, tx_hash))
    return events


def _decode_erc20_transfer_to_router(tx_receipt: Any) -> List[Dict[str, Any]]:
    router = normalize_wallet(settings.router_address)
    if not router or router == "0x0000000000000000000000000000000000000000":
        return []

    events: List[Dict[str, Any]] = []
    tx_hash = tx_receipt["transactionHash"].hex().lower()

    for log in tx_receipt.get("logs", []):
        topics = log.get("topics") or []
        if len(topics) < 3:
            continue
        topic0 = Web3.to_hex(topics[0]).lower()
        if topic0 != TRANSFER_TOPIC:
            continue

        from_addr = _topic_to_address(topics[1])
        to_addr = _topic_to_address(topics[2])
        if to_addr != router:
            continue

        maybe_event = _make_event_row(
            tx_hash,
            int(log.get("logIndex", 0)),
            from_addr,
            _decode_amount_raw(log.get("data", "0x0")),
            str(log.get("address", "")),
        )
        if maybe_event:
            events.append(maybe_event)

    return events


def _amount_usdc_from_raw(amount_raw: int, decimals: int = 6) -> float:
    return round(float(amount_raw) / float(10**decimals), 6)


def _resolve_token_decimals(token_address: str) -> int:
    token = normalize_wallet(token_address)
    if not token:
        return 6
    cached = TOKEN_DECIMALS_CACHE.get(token)
    if cached is not None:
        return cached

    try:
        abi = [
            {
                "constant": True,
                "inputs": [],
                "name": "decimals",
                "outputs": [{"name": "", "type": "uint8"}],
                "stateMutability": "view",
                "type": "function",
            }
        ]
        contract = w3.eth.contract(address=w3.to_checksum_address(token), abi=abi)
        value = int(contract.functions.decimals().call())
        if value <= 0 or value > 36:
            value = 6
        TOKEN_DECIMALS_CACHE[token] = value
        return value
    except Exception:
        TOKEN_DECIMALS_CACHE[token] = 6
        return 6


def _pick_matching_event(events: List[Dict[str, Any]], owner_wallet: str, min_amount_usdc: float) -> Optional[Dict[str, Any]]:
    owner = normalize_wallet(owner_wallet)
    candidate: Optional[Dict[str, Any]] = None

    for row in events:
        buyer = normalize_wallet(str(row.get("buyer", "")))
        if buyer != owner:
            continue
        decimals = _resolve_token_decimals(str(row.get("token") or ""))
        amount_usdc = _amount_usdc_from_raw(int(row.get("amountRaw", 0)), decimals=decimals)
        if amount_usdc + 1e-9 < min_amount_usdc:
            continue
        if candidate is None or int(row.get("amountRaw", 0)) > int(candidate.get("amountRaw", 0)):
            candidate = row

    return candidate


def _confirmations_for_receipt(tx_receipt: Any) -> int:
    latest_block = int(w3.eth.block_number)
    block_number = int(tx_receipt.get("blockNumber") or 0)
    if block_number <= 0:
        return 0
    return max(0, latest_block - block_number + 1)


def _mark_intent_failed(intent: Dict[str, Any], reason: str, now: int) -> None:
    intent["status"] = "failed"
    intent["failureReason"] = reason
    intent["updatedAt"] = now


def _extract_intent_fields(intent: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    tx_hash = _normalize_tx_hash(str(intent.get("txHash") or ""))
    owner_wallet = normalize_wallet(str(intent.get("ownerAddress") or ""))
    min_amount_usdc = float(intent.get("amountUsdc") or 0.0)
    if not tx_hash or not owner_wallet or min_amount_usdc <= 0:
        return None
    return {
        "tx_hash": tx_hash,
        "owner_wallet": owner_wallet,
        "min_amount_usdc": min_amount_usdc,
    }


def _get_confirmed_receipt_or_none(tx_hash: str) -> Optional[Dict[str, Any]]:
    try:
        tx_receipt = w3.eth.get_transaction_receipt(tx_hash)
    except TransactionNotFound:
        return None
    except Exception:
        return None

    if tx_receipt is None:
        return None
    if int(tx_receipt.get("status", 0)) != 1:
        return {"failed": True}
    confirmations = _confirmations_for_receipt(tx_receipt)
    if confirmations < settings.v2_deposit_confirmations:
        return None
    return {
        "failed": False,
        "receipt": tx_receipt,
        "confirmations": confirmations,
    }


def _resolve_matched_event(tx_receipt: Any, owner_wallet: str, min_amount_usdc: float) -> Optional[Dict[str, Any]]:
    events = _decode_router_deposit_events(tx_receipt)
    if not events:
        events = _decode_erc20_transfer_to_router(tx_receipt)
    return _pick_matching_event(events, owner_wallet, min_amount_usdc)


def _process_single_intent(
    storage: BaseStorage,
    intent: Dict[str, Any],
    processed_keys: set[str],
    buyers: Dict[str, float],
    now: int,
) -> Dict[str, Any]:
    if str(intent.get("status") or "pending").lower() != "pending":
        return {"result": "skip"}

    intent_fields = _extract_intent_fields(intent)
    if not intent_fields:
        _mark_intent_failed(intent, "INVALID_INTENT", now)
        return {"result": "failed", "changedIntent": True}

    tx_hash = str(intent_fields["tx_hash"])
    owner_wallet = str(intent_fields["owner_wallet"])
    min_amount_usdc = float(intent_fields["min_amount_usdc"])

    tx_receipt = _get_confirmed_receipt_or_none(tx_hash)
    if tx_receipt is None:
        return {"result": "pending"}

    if tx_receipt.get("failed") is True:
        _mark_intent_failed(intent, "CHAIN_TX_FAILED", now)
        return {"result": "failed", "changedIntent": True}

    receipt_obj = tx_receipt.get("receipt")
    if receipt_obj is None:
        _mark_intent_failed(intent, "MISSING_TX_RECEIPT", now)
        return {"result": "failed", "changedIntent": True}

    matched = _resolve_matched_event(receipt_obj, owner_wallet, min_amount_usdc)
    if not matched:
        _mark_intent_failed(intent, "NO_MATCHING_DEPOSIT_EVENT", now)
        return {"result": "failed", "changedIntent": True}

    event_key = str(matched.get("eventKey") or "")
    if not event_key or event_key in processed_keys:
        intent["status"] = "duplicate"
        intent["failureReason"] = "DEPOSIT_EVENT_REPLAY"
        intent["updatedAt"] = now
        return {"result": "failed", "changedIntent": True}

    token = str(matched.get("token") or "")
    decimals = _resolve_token_decimals(token) if token else 6
    amount_usdc = _amount_usdc_from_raw(int(matched.get("amountRaw", 0)), decimals=decimals)
    next_balance = round(float(buyers.get(owner_wallet, 0.0)) + amount_usdc, 6)
    buyers[owner_wallet] = next_balance
    processed_keys.add(event_key)

    intent["status"] = "confirmed"
    intent["creditedAmountUsdc"] = amount_usdc
    intent["confirmedAt"] = now
    intent["confirmations"] = int(tx_receipt.get("confirmations") or 0)
    intent["eventKey"] = event_key
    intent["eventToken"] = matched.get("token")
    intent["updatedAt"] = now

    _append_audit_log(
        storage,
        "V2_DEPOSIT_CONFIRMED",
        owner_wallet,
        {
            "txHash": tx_hash,
            "eventKey": event_key,
            "amountUsdc": amount_usdc,
            "balanceAfter": next_balance,
        },
    )

    return {
        "result": "credited",
        "changedIntent": True,
        "changedLedger": True,
        "changedProcessed": True,
    }


def _accumulate_outcome_counts(outcome: Dict[str, Any], counters: Dict[str, int]) -> None:
    result = str(outcome.get("result") or "skip")
    if result == "credited":
        counters["credited"] += 1
        return
    if result == "failed":
        counters["failed"] += 1
        return
    if result == "pending":
        counters["pending"] += 1


def process_pending_deposit_intents_once(storage: BaseStorage) -> Dict[str, int]:
    # 单轮处理：扫描所有 pending intent，链上核验后进行幂等入账。
    # 这个函数是“最终一致性”的核心，重启后也可继续恢复处理。
    now = _now()
    counters = {"credited": 0, "failed": 0, "pending": 0}

    with lock:
        intents = _load_deposit_intents(storage)
        if not intents:
            return {"credited": 0, "failed": 0, "pending": 0}

        processed_keys = set(_load_processed_deposit_event_keys(storage))
        ledger = _load_balance_ledger(storage)
        buyers = ledger.setdefault("buyers", {})

        changed_intents = False
        changed_ledger = False
        changed_processed = False

        for intent in intents:
            # 核心幂等点：同一笔 intent 多次执行不会重复记账，
            # 因为 outcome 与 processed_keys 会拦截重放。
            outcome = _process_single_intent(storage, intent, processed_keys, buyers, now)

            if outcome.get("changedIntent"):
                changed_intents = True
            if outcome.get("changedLedger"):
                changed_ledger = True
            if outcome.get("changedProcessed"):
                changed_processed = True

            _accumulate_outcome_counts(outcome, counters)

        if changed_ledger:
            _save_balance_ledger(storage, ledger)
        if changed_processed:
            _save_processed_deposit_event_keys(storage, sorted(processed_keys))
        if changed_intents:
            _save_deposit_intents(storage, intents)

    _set_status(lastCounters=counters, lastProcessedAt=now, lastError=None)
    return counters


async def run_v2_deposit_indexer(stop_event: asyncio.Event, storage: BaseStorage) -> None:
    # 常驻索引循环：按固定周期轮询 pending intents。
    # 设计目标：让“链上成功但服务端暂未入账”在后续周期自动修复。
    _set_status(running=True, listenerAddress=normalize_wallet(settings.router_address))
    while not stop_event.is_set():
        try:
            process_pending_deposit_intents_once(storage)
        except Exception as e:
            _set_status(lastError=str(e), lastProcessedAt=_now())
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=settings.v2_indexer_poll_interval_sec)
        except asyncio.TimeoutError:
            continue
    _set_status(running=False)
