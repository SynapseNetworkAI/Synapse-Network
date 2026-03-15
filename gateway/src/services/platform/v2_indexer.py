import asyncio
import json
import os
import time
import logging
from threading import Lock
from typing import Any, Dict, List, Optional
from uuid import uuid4

from web3 import Web3
from web3.exceptions import TransactionNotFound

from src.core.common import normalize_wallet
from src.core.config import settings
from src.domain.audit import AuditLogEntry
from src.domain.finance import BalanceLedger
from src.domain.finance import DepositIntentRow
from src.storage import BaseStorage
from src.utils.datetime_utils import now_dt_str, to_dt_str

lock = Lock()
w3 = Web3(Web3.HTTPProvider(settings.rpc_url))
logger = logging.getLogger(__name__)

_INDEXER_LOOP_ERROR_CODE = "INDEXER_LOOP_FAILED"
_BACKFILL_ERROR_CODE = "INDEXER_BACKFILL_SCAN_FAILED"
_RECONCILIATION_ERROR_CODE = "INDEXER_RECONCILIATION_FAILED"

INDEXER_STATUS: Dict[str, Any] = {
    "running": False,
    "listenerAddress": normalize_wallet(settings.router_address),
    "lastCounters": {"credited": 0, "failed": 0, "pending": 0},
    "lastProcessedAt": None,
    "lastError": None,
    "backfill": {
        "enabled": bool(settings.v2_backfill_enabled),
        "lastScannedBlock": None,
        "lastScanAt": None,
        "lastRecovered": 0,
        "lastError": None,
    },
    "reconciliation": {
        "enabled": bool(settings.v2_reconciliation_enabled),
        "lastCheckAt": None,
        "chainVaultUsdc": 0.0,
        "ledgerObligationUsdc": 0.0,
        "deltaUsdc": 0.0,
        "alert": False,
        "lastError": None,
    },
}


def _set_status(**kwargs: Any) -> None:
    with lock:
        INDEXER_STATUS.update(kwargs)


def _to_public_error_code(value: Any, default_code: str) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.replace("_", "").isalnum() and text.upper() == text:
        return text
    return default_code


def _public_status_snapshot() -> Dict[str, Any]:
    snapshot = dict(INDEXER_STATUS)
    backfill = dict(snapshot.get("backfill") or {})
    reconciliation = dict(snapshot.get("reconciliation") or {})

    snapshot["lastError"] = _to_public_error_code(
        snapshot.get("lastError"), _INDEXER_LOOP_ERROR_CODE
    )
    backfill["lastError"] = _to_public_error_code(
        backfill.get("lastError"), _BACKFILL_ERROR_CODE
    )
    reconciliation["lastError"] = _to_public_error_code(
        reconciliation.get("lastError"),
        _RECONCILIATION_ERROR_CODE,
    )

    snapshot["backfill"] = backfill
    snapshot["reconciliation"] = reconciliation
    return snapshot


def get_indexer_status() -> Dict[str, Any]:
    with lock:
        snapshot = _public_status_snapshot()
        return {
            "running": bool(snapshot.get("running")),
            "listenerAddress": str(snapshot.get("listenerAddress") or ""),
            "lastCounters": dict(
                snapshot.get("lastCounters")
                or {"credited": 0, "failed": 0, "pending": 0}
            ),
            "lastProcessedAt": snapshot.get("lastProcessedAt"),
            "lastError": snapshot.get("lastError"),
            "pollIntervalSec": settings.v2_indexer_poll_interval_sec,
            "backfill": dict(snapshot.get("backfill") or {}),
            "reconciliation": dict(snapshot.get("reconciliation") or {}),
        }


TRANSFER_TOPIC = Web3.to_hex(
    Web3.keccak(text="Transfer(address,address,uint256)")
).lower()
TOKEN_DECIMALS_CACHE: Dict[str, int] = {}


def _now() -> int:
    return int(time.time())


def _load_deposit_intents(storage: BaseStorage) -> List[Dict[str, Any]]:
    raw_rows = storage.get_data_manager().system.gateway_state.read_deposit_intents()
    if not isinstance(raw_rows, list):
        return []
    rows: List[Dict[str, Any]] = []
    for row in raw_rows:
        if isinstance(row, DepositIntentRow):
            rows.append(row.model_dump(by_alias=True, mode="json"))
        elif isinstance(row, dict):
            rows.append(row)
    return rows


def _save_deposit_intents(storage: BaseStorage, rows: List[Dict[str, Any]]) -> None:
    typed_rows = [
        DepositIntentRow.model_validate(row) for row in rows if isinstance(row, dict)
    ]
    repo = storage.get_data_manager().system.gateway_state
    try:
        repo.write_deposit_intents(typed_rows)
    except Exception:
        repo.write_deposit_intents(rows)


def _load_balance_ledger(storage: BaseStorage) -> BalanceLedger:
    return storage.get_data_manager().finance.balance.read_balance_ledger()


def _save_balance_ledger(storage: BaseStorage, ledger: BalanceLedger) -> None:
    ledger.updated_at = now_dt_str()
    storage.get_data_manager().finance.balance.write_balance_ledger(ledger)


def _load_processed_deposit_event_keys(storage: BaseStorage) -> List[str]:
    keys = storage.get_data_manager().system.gateway_state.read_processed_deposit_event_keys()
    return [str(item) for item in keys] if isinstance(keys, list) else []


def _save_processed_deposit_event_keys(storage: BaseStorage, keys: List[str]) -> None:
    storage.get_data_manager().system.gateway_state.write_processed_deposit_event_keys(
        keys, now_dt_str()
    )


def _load_backfill_state(storage: BaseStorage) -> Dict[str, Any]:
    raw = storage.get_data_manager().system.gateway_state.read_runtime_state(
        "deposit_backfill_state"
    )
    if isinstance(raw, dict):
        return dict(raw)
    return {}


def _save_backfill_state(storage: BaseStorage, state: Dict[str, Any]) -> None:
    payload = dict(state)
    payload["updatedAt"] = now_dt_str()
    storage.get_data_manager().system.gateway_state.write_runtime_state(
        "deposit_backfill_state", payload
    )


def _append_audit_log(
    storage: BaseStorage, action: str, owner_wallet: str, details: Dict[str, Any]
) -> None:
    storage.get_data_manager().audit.logs.append_audit_row(
        AuditLogEntry(
            id=str(uuid4()),
            timestamp=_now(),
            action=action,
            owner_address=normalize_wallet(owner_wallet),
            details=details,
        )
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


def _make_event_row(
    tx_hash: str, log_index: int, buyer: str, amount_raw: int, token: str
) -> Optional[Dict[str, Any]]:
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


def _extract_router_event_rows(
    contract: Any, event_name: str, tx_receipt: Any, tx_hash: str
) -> List[Dict[str, Any]]:
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
    abi_path = os.path.join(
        os.path.dirname(os.path.dirname(__file__)), "SynapseCoreABI.json"
    )
    if not os.path.exists(abi_path):
        return []

    try:
        with open(abi_path, "r", encoding="utf-8") as file:
            router_abi = json.load(file)
        contract = w3.eth.contract(
            address=w3.to_checksum_address(settings.router_address), abi=router_abi
        )
    except Exception:
        return []

    tx_hash = tx_receipt["transactionHash"].hex().lower()
    events: List[Dict[str, Any]] = []
    for event_name in ("DepositInfo", "Deposit", "Deposited"):
        events.extend(
            _extract_router_event_rows(contract, event_name, tx_receipt, tx_hash)
        )
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


def _pick_matching_event(
    events: List[Dict[str, Any]], owner_wallet: str, min_amount_usdc: float
) -> Optional[Dict[str, Any]]:
    owner = normalize_wallet(owner_wallet)
    candidate: Optional[Dict[str, Any]] = None

    for row in events:
        buyer = normalize_wallet(str(row.get("buyer", "")))
        if buyer != owner:
            continue
        decimals = _resolve_token_decimals(str(row.get("token") or ""))
        amount_usdc = _amount_usdc_from_raw(
            int(row.get("amountRaw", 0)), decimals=decimals
        )
        if amount_usdc + 1e-9 < min_amount_usdc:
            continue
        if candidate is None or int(row.get("amountRaw", 0)) > int(
            candidate.get("amountRaw", 0)
        ):
            candidate = row

    return candidate


def _confirmations_for_receipt(tx_receipt: Any) -> int:
    latest_block = int(w3.eth.block_number)
    block_number = int(tx_receipt.get("blockNumber") or 0)
    if block_number <= 0:
        return 0
    return max(0, latest_block - block_number + 1)


def _mark_intent_failed(intent: Dict[str, Any], reason: str, now: int) -> None:
    intent["status"] = "FAILED"
    intent["failureReason"] = reason
    intent["updatedAt"] = to_dt_str(now, now_dt_str()) or now_dt_str()


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


def _resolve_matched_event(
    tx_receipt: Any, owner_wallet: str, min_amount_usdc: float
) -> Optional[Dict[str, Any]]:
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
    status = str(intent.get("status") or "PENDING_CONFIRMATION").upper()
    if status not in {"PENDING_CONFIRMATION", "PENDING"}:
        return {"result": "skip"}

    context = _build_deposit_confirmation_context(intent)
    if context is None:
        _mark_intent_failed(intent, "INVALID_INTENT", now)
        return {"result": "failed", "changedIntent": True}

    tx_state = _resolve_deposit_receipt_state(
        tx_hash=context["tx_hash"],
        owner_wallet=context["owner_wallet"],
        min_amount_usdc=context["min_amount_usdc"],
        now=now,
        intent=intent,
    )
    if tx_state is None:
        return {"result": "pending"}
    if str(tx_state.get("result") or "") == "failed":
        return {"result": "failed", "changedIntent": True}

    return _apply_confirmed_deposit(
        storage=storage,
        intent=intent,
        context=context,
        tx_state=tx_state,
        processed_keys=processed_keys,
        buyers=buyers,
        now=now,
    )


def _build_deposit_confirmation_context(
    intent: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    intent_fields = _extract_intent_fields(intent)
    if not intent_fields:
        return None
    return {
        "tx_hash": str(intent_fields["tx_hash"]),
        "owner_wallet": str(intent_fields["owner_wallet"]),
        "min_amount_usdc": float(intent_fields["min_amount_usdc"]),
    }


def _resolve_deposit_receipt_state(
    *,
    tx_hash: str,
    owner_wallet: str,
    min_amount_usdc: float,
    now: int,
    intent: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    tx_receipt = _get_confirmed_receipt_or_none(tx_hash)
    if tx_receipt is None:
        return None
    if tx_receipt.get("failed") is True:
        _mark_intent_failed(intent, "CHAIN_TX_FAILED", now)
        return {"result": "failed"}

    receipt_obj = tx_receipt.get("receipt")
    if receipt_obj is None:
        _mark_intent_failed(intent, "MISSING_TX_RECEIPT", now)
        return {"result": "failed"}

    matched = _resolve_matched_event(receipt_obj, owner_wallet, min_amount_usdc)
    if not matched:
        _mark_intent_failed(intent, "NO_MATCHING_DEPOSIT_EVENT", now)
        return {"result": "failed"}

    return {
        "result": "ok",
        "tx_receipt": tx_receipt,
        "matched": matched,
    }


def _apply_confirmed_deposit(
    *,
    storage: BaseStorage,
    intent: Dict[str, Any],
    context: Dict[str, Any],
    tx_state: Dict[str, Any],
    processed_keys: set[str],
    buyers: Dict[str, float],
    now: int,
) -> Dict[str, Any]:
    matched = tx_state["matched"]
    tx_receipt = tx_state["tx_receipt"]
    owner_wallet = context["owner_wallet"]
    tx_hash = context["tx_hash"]

    event_key = _resolve_event_key_or_mark_duplicate(
        intent, matched, processed_keys, now
    )
    if not event_key:
        return {"result": "failed", "changedIntent": True}

    token = str(matched.get("token") or "")
    decimals = _resolve_token_decimals(token) if token else 6
    amount_usdc = _amount_usdc_from_raw(
        int(matched.get("amountRaw", 0)), decimals=decimals
    )
    applied = _apply_confirmed_balance_to_ledger(
        storage=storage,
        intent=intent,
        owner_wallet=owner_wallet,
        event_key=event_key,
        confirmations=int(tx_receipt.get("confirmations") or 0),
        buyers=buyers,
        amount_usdc=amount_usdc,
        now=now,
    )
    if str(applied.get("result") or "") == "failed":
        return {"result": "failed", "changedIntent": True}
    next_balance = float(applied.get("next_balance") or 0.0)

    processed_keys.add(event_key)
    intent["confirmedAt"] = now
    intent["confirmations"] = int(tx_receipt.get("confirmations") or 0)
    intent["eventKey"] = event_key
    intent["eventToken"] = matched.get("token")
    intent["updatedAt"] = to_dt_str(now, now_dt_str()) or now_dt_str()

    _append_audit_log(
        storage,
        "V2_DEPOSIT_CONFIRMED",
        owner_wallet,
        {
            "txHash": tx_hash,
            "eventKey": event_key,
            "amountUsdc": float(intent.get("creditedAmountUsdc") or amount_usdc),
            "balanceAfter": next_balance,
        },
    )

    return {
        "result": "credited",
        "changedIntent": True,
        "changedLedger": True,
        "changedProcessed": True,
    }


def _resolve_event_key_or_mark_duplicate(
    intent: Dict[str, Any],
    matched: Dict[str, Any],
    processed_keys: set[str],
    now: int,
) -> str:
    event_key = str(matched.get("eventKey") or "")
    if event_key and event_key not in processed_keys:
        return event_key
    intent["status"] = "DUPLICATE"
    intent["failureReason"] = "DEPOSIT_EVENT_REPLAY"
    intent["updatedAt"] = to_dt_str(now, now_dt_str()) or now_dt_str()
    return ""


def _apply_confirmed_balance_to_ledger(
    *,
    storage: BaseStorage,
    intent: Dict[str, Any],
    owner_wallet: str,
    event_key: str,
    confirmations: int,
    buyers: Dict[str, float],
    amount_usdc: float,
    now: int,
) -> Dict[str, Any]:
    if hasattr(storage, "confirm_deposit_intent_atomic"):
        try:
            confirmed = getattr(storage, "confirm_deposit_intent_atomic")(
                owner_wallet=owner_wallet,
                deposit_intent_id=str(intent.get("id") or ""),
                event_key=event_key,
                confirmations=confirmations,
            )
        except RuntimeError:
            _mark_intent_failed(intent, "DEPOSIT_CONFIRM_APPLY_FAILED", now)
            return {"result": "failed"}

        if isinstance(confirmed, DepositIntentRow):
            intent.update(confirmed.model_dump(by_alias=True, mode="json"))
        elif isinstance(confirmed, dict):
            intent.update(confirmed)
        intent["status"] = "CONFIRMED"
        return {
            "result": "ok",
            "next_balance": float(
                intent.get("availableAfter") or buyers.get(owner_wallet, 0.0) or 0.0
            ),
        }

    next_balance = round(float(buyers.get(owner_wallet, 0.0)) + amount_usdc, 6)
    buyers[owner_wallet] = next_balance
    intent["status"] = "CONFIRMED"
    intent["creditedAmountUsdc"] = amount_usdc
    return {"result": "ok", "next_balance": next_balance}


def _accumulate_outcome_counts(
    outcome: Dict[str, Any], counters: Dict[str, int]
) -> None:
    result = str(outcome.get("result") or "skip")
    if result == "credited":
        counters["credited"] += 1
        return
    if result == "failed":
        counters["failed"] += 1
        return
    if result == "pending":
        counters["pending"] += 1


def _confirmed_head_block() -> int:
    latest = int(w3.eth.block_number or 0)
    confirmations = max(1, int(settings.v2_deposit_confirmations))
    return max(0, latest - confirmations + 1)


def _tx_hash_to_hex(value: Any) -> str:
    if value is None:
        return ""
    if hasattr(value, "hex"):
        try:
            return str(value.hex()).lower()
        except Exception:
            return ""
    text = str(value).strip().lower()
    if text.startswith("0x") and len(text) == 66:
        return text
    return ""


def _collect_router_candidate_tx_hashes(start_block: int, end_block: int) -> List[str]:
    router = normalize_wallet(settings.router_address)
    if not router:
        return []

    dedup: set[str] = set()
    for block_number in range(int(start_block), int(end_block) + 1):
        try:
            block = w3.eth.get_block(block_number, full_transactions=True)
        except Exception:
            continue

        transactions = (
            block.get("transactions", [])
            if isinstance(block, dict)
            else getattr(block, "transactions", [])
        )
        if not isinstance(transactions, list):
            continue
        for tx in transactions:
            to_addr = ""
            tx_hash = ""
            if isinstance(tx, dict):
                to_addr = normalize_wallet(str(tx.get("to") or ""))
                tx_hash = _tx_hash_to_hex(tx.get("hash"))
            else:
                to_addr = normalize_wallet(str(getattr(tx, "to", "") or ""))
                tx_hash = _tx_hash_to_hex(getattr(tx, "hash", None))
            if to_addr != router:
                continue
            if tx_hash:
                dedup.add(tx_hash)
    return sorted(dedup)


def _find_intent_by_tx_owner(
    intents: List[Dict[str, Any]], tx_hash: str, owner_wallet: str
) -> Optional[Dict[str, Any]]:
    owner = normalize_wallet(owner_wallet)
    tx = _normalize_tx_hash(tx_hash)
    if not owner or not tx:
        return None
    for row in intents:
        if (
            normalize_wallet(
                str(row.get("ownerAddress") or row.get("buyerAddress") or "")
            )
            != owner
        ):
            continue
        if _normalize_tx_hash(str(row.get("txHash") or "")) != tx:
            continue
        return row
    return None


def _build_recovery_intent(
    tx_hash: str, owner_wallet: str, amount_usdc: float, event_key: str, now: int
) -> Dict[str, Any]:
    now_text = to_dt_str(now, now_dt_str()) or now_dt_str()
    return {
        "id": str(uuid4()),
        "ownerAddress": normalize_wallet(owner_wallet),
        "buyerAddress": normalize_wallet(owner_wallet),
        "txHash": _normalize_tx_hash(tx_hash),
        "amountUsdc": round(float(amount_usdc), 6),
        "creditedAmountUsdc": 0.0,
        "idempotencyKey": f"deposit_backfill_{event_key.replace(':', '_')}",
        "status": "PENDING_CONFIRMATION",
        "createdAt": now_text,
        "updatedAt": now_text,
        "source": "INDEXER_BACKFILL",
    }


def run_backfill_scan_once(storage: BaseStorage) -> Dict[str, Any]:
    if not bool(settings.v2_backfill_enabled):
        return {"enabled": False}

    now = _now()
    state = _load_backfill_state(storage)
    confirmed_head = _confirmed_head_block()
    if confirmed_head <= 0:
        return {
            "enabled": True,
            "scanned": 0,
            "recovered": 0,
            "lastScannedBlock": state.get("lastScannedBlock"),
        }

    last_scanned = int(state.get("lastScannedBlock") or 0)
    if last_scanned <= 0:
        configured_start = int(settings.v2_backfill_start_block)
        if configured_start > 0:
            start_block = configured_start
        else:
            start_block = max(
                1, confirmed_head - max(1, int(settings.v2_backfill_block_batch)) + 1
            )
    else:
        start_block = last_scanned + 1

    end_block = min(
        confirmed_head, start_block + max(1, int(settings.v2_backfill_block_batch)) - 1
    )
    if start_block > end_block:
        _set_status(
            backfill={
                "enabled": True,
                "lastScannedBlock": last_scanned,
                "lastScanAt": now,
                "lastRecovered": 0,
                "lastError": None,
            }
        )
        return {
            "enabled": True,
            "scanned": 0,
            "recovered": 0,
            "lastScannedBlock": last_scanned,
        }

    with lock:
        intents = _load_deposit_intents(storage)
        processed_keys = set(_load_processed_deposit_event_keys(storage))
        ledger = _load_balance_ledger(storage)
        buyers = ledger.buyers

        changed_intents = False
        changed_ledger = False
        changed_processed = False
        recovered = 0

        tx_hashes = _collect_router_candidate_tx_hashes(start_block, end_block)
        for tx_hash in tx_hashes:
            tx_state = _get_confirmed_receipt_or_none(tx_hash)
            if tx_state is None or tx_state.get("failed") is True:
                continue
            receipt_obj = tx_state.get("receipt")
            if receipt_obj is None:
                continue

            events = _decode_router_deposit_events(receipt_obj)
            if not events:
                events = _decode_erc20_transfer_to_router(receipt_obj)
            for event in events:
                event_key = str(event.get("eventKey") or "")
                if not event_key or event_key in processed_keys:
                    continue
                owner_wallet = normalize_wallet(str(event.get("buyer") or ""))
                if not owner_wallet:
                    continue
                token = str(event.get("token") or "")
                decimals = _resolve_token_decimals(token) if token else 6
                amount_usdc = _amount_usdc_from_raw(
                    int(event.get("amountRaw") or 0), decimals=decimals
                )
                if amount_usdc <= 0:
                    continue

                target_intent = _find_intent_by_tx_owner(intents, tx_hash, owner_wallet)
                if target_intent is None:
                    target_intent = _build_recovery_intent(
                        tx_hash, owner_wallet, amount_usdc, event_key, now
                    )
                    intents.append(target_intent)
                    changed_intents = True

                outcome = _process_single_intent(
                    storage, target_intent, processed_keys, buyers, now
                )
                if outcome.get("changedIntent"):
                    changed_intents = True
                if outcome.get("changedLedger"):
                    changed_ledger = True
                if outcome.get("changedProcessed"):
                    changed_processed = True
                if str(outcome.get("result") or "") == "credited":
                    recovered += 1

        if changed_ledger:
            _save_balance_ledger(storage, ledger)
        if changed_processed:
            _save_processed_deposit_event_keys(storage, sorted(processed_keys))
        if changed_intents:
            _save_deposit_intents(storage, intents)

    next_state = {
        "lastScannedBlock": end_block,
        "lastScanAt": now,
    }
    _save_backfill_state(storage, next_state)
    _set_status(
        backfill={
            "enabled": True,
            "lastScannedBlock": end_block,
            "lastScanAt": now,
            "lastRecovered": recovered,
            "lastError": None,
        }
    )
    return {
        "enabled": True,
        "scanned": max(0, end_block - start_block + 1),
        "recovered": recovered,
        "lastScannedBlock": end_block,
    }


def _sum_ledger_obligation_usdc(ledger: BalanceLedger) -> float:
    available = sum(float(value) for value in ledger.buyers.values())
    pending = sum(float(value) for value in ledger.buyers_locked.values())
    return round(available + pending, 6)


def _read_chain_vault_balance_usdc() -> float:
    token = normalize_wallet(settings.usdc_token_address)
    router = normalize_wallet(settings.router_address)
    if not token or not router:
        return 0.0

    abi = [
        {
            "constant": True,
            "inputs": [{"name": "account", "type": "address"}],
            "name": "balanceOf",
            "outputs": [{"name": "", "type": "uint256"}],
            "stateMutability": "view",
            "type": "function",
        }
    ]
    contract = w3.eth.contract(address=w3.to_checksum_address(token), abi=abi)
    raw_balance = int(
        contract.functions.balanceOf(w3.to_checksum_address(router)).call()
    )
    decimals = _resolve_token_decimals(token)
    return _amount_usdc_from_raw(raw_balance, decimals=decimals)


def run_reconciliation_check_once(storage: BaseStorage) -> Dict[str, Any]:
    if not bool(settings.v2_reconciliation_enabled):
        return {"enabled": False}

    now = _now()
    ledger = _load_balance_ledger(storage)
    ledger_obligation = _sum_ledger_obligation_usdc(ledger)
    chain_vault = _read_chain_vault_balance_usdc()
    delta = round(abs(chain_vault - ledger_obligation), 6)
    alert = bool(delta > float(settings.v2_reconciliation_alert_delta_usdc))

    alert_state = storage.get_data_manager().system.gateway_state.read_runtime_state(
        "deposit_reconciliation_state"
    )
    state = dict(alert_state) if isinstance(alert_state, dict) else {}
    last_alert_at = int(state.get("lastAlertAt") or 0)
    should_emit_alert = alert and (now - last_alert_at >= 300)

    if should_emit_alert:
        state["lastAlertAt"] = now
        storage.get_data_manager().system.gateway_state.write_runtime_state(
            "deposit_reconciliation_state", state
        )
        _append_audit_log(
            storage,
            "V2_DEPOSIT_RECONCILIATION_ALERT",
            normalize_wallet(settings.router_address),
            {
                "chainVaultUsdc": chain_vault,
                "ledgerObligationUsdc": ledger_obligation,
                "deltaUsdc": delta,
                "thresholdUsdc": float(settings.v2_reconciliation_alert_delta_usdc),
            },
        )

    summary = {
        "enabled": True,
        "lastCheckAt": now,
        "chainVaultUsdc": chain_vault,
        "ledgerObligationUsdc": ledger_obligation,
        "deltaUsdc": delta,
        "alert": alert,
        "lastError": None,
    }
    _set_status(reconciliation=summary)
    return summary


def replay_deposit_tx(
    storage: BaseStorage, tx_hash: str, requested_by: str
) -> Dict[str, Any]:
    normalized_tx = _normalize_tx_hash(tx_hash)
    if not normalized_tx:
        raise ValueError("INVALID_TX_HASH")

    now = _now()
    tx_state = _get_confirmed_receipt_or_none(normalized_tx)
    if tx_state is None:
        raise RuntimeError("TX_NOT_CONFIRMED")
    if tx_state.get("failed") is True:
        raise RuntimeError("TX_FAILED")
    receipt_obj = tx_state.get("receipt")
    if receipt_obj is None:
        raise RuntimeError("MISSING_TX_RECEIPT")

    events = _decode_router_deposit_events(receipt_obj)
    if not events:
        events = _decode_erc20_transfer_to_router(receipt_obj)
    if not events:
        raise RuntimeError("NO_MATCHING_DEPOSIT_EVENT")

    summary = {
        "txHash": normalized_tx,
        "events": len(events),
        "intentsCreated": 0,
        "credited": 0,
        "failed": 0,
        "pending": 0,
    }

    with lock:
        intents = _load_deposit_intents(storage)
        processed_keys = set(_load_processed_deposit_event_keys(storage))
        ledger = _load_balance_ledger(storage)
        buyers = ledger.buyers

        changed_intents = False
        changed_ledger = False
        changed_processed = False

        for event in events:
            owner_wallet = normalize_wallet(str(event.get("buyer") or ""))
            if not owner_wallet:
                continue
            token = str(event.get("token") or "")
            decimals = _resolve_token_decimals(token) if token else 6
            amount_usdc = _amount_usdc_from_raw(
                int(event.get("amountRaw") or 0), decimals=decimals
            )
            event_key = str(event.get("eventKey") or "")

            target_intent = _find_intent_by_tx_owner(
                intents, normalized_tx, owner_wallet
            )
            if target_intent is None:
                target_intent = _build_recovery_intent(
                    normalized_tx, owner_wallet, amount_usdc, event_key, now
                )
                intents.append(target_intent)
                changed_intents = True
                summary["intentsCreated"] += 1

            outcome = _process_single_intent(
                storage, target_intent, processed_keys, buyers, now
            )
            if outcome.get("changedIntent"):
                changed_intents = True
            if outcome.get("changedLedger"):
                changed_ledger = True
            if outcome.get("changedProcessed"):
                changed_processed = True
            _accumulate_outcome_counts(outcome, summary)

        if changed_ledger:
            _save_balance_ledger(storage, ledger)
        if changed_processed:
            _save_processed_deposit_event_keys(storage, sorted(processed_keys))
        if changed_intents:
            _save_deposit_intents(storage, intents)

    _append_audit_log(
        storage,
        "V2_DEPOSIT_REPLAY_ADMIN",
        normalize_wallet(requested_by),
        summary,
    )
    return summary


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
        buyers = ledger.buyers

        changed_intents = False
        changed_ledger = False
        changed_processed = False

        for intent in intents:
            # 核心幂等点：同一笔 intent 多次执行不会重复记账，
            # 因为 outcome 与 processed_keys 会拦截重放。
            outcome = _process_single_intent(
                storage, intent, processed_keys, buyers, now
            )

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


async def run_v2_deposit_indexer(
    stop_event: asyncio.Event, storage: BaseStorage
) -> None:
    # 常驻索引循环：按固定周期轮询 pending intents。
    # 设计目标：让“链上成功但服务端暂未入账”在后续周期自动修复。
    _set_status(running=True, listenerAddress=normalize_wallet(settings.router_address))
    last_reconciliation_at = 0
    while not stop_event.is_set():
        try:
            if settings.v2_backfill_enabled:
                try:
                    run_backfill_scan_once(storage)
                except Exception:
                    logger.exception("V2 backfill scan failed")
                    _set_status(
                        backfill={
                            "enabled": True,
                            "lastScannedBlock": None,
                            "lastScanAt": _now(),
                            "lastRecovered": 0,
                            "lastError": _BACKFILL_ERROR_CODE,
                        }
                    )
            process_pending_deposit_intents_once(storage)

            now = _now()
            if settings.v2_reconciliation_enabled and (
                now - last_reconciliation_at
            ) >= int(settings.v2_reconciliation_interval_sec):
                try:
                    run_reconciliation_check_once(storage)
                    last_reconciliation_at = now
                except Exception:
                    logger.exception("V2 reconciliation check failed")
                    _set_status(
                        reconciliation={
                            "enabled": True,
                            "lastCheckAt": now,
                            "chainVaultUsdc": 0.0,
                            "ledgerObligationUsdc": 0.0,
                            "deltaUsdc": 0.0,
                            "alert": False,
                            "lastError": _RECONCILIATION_ERROR_CODE,
                        }
                    )
        except Exception:
            logger.exception("V2 indexer loop failed")
            _set_status(lastError=_INDEXER_LOOP_ERROR_CODE, lastProcessedAt=_now())
        try:
            await asyncio.wait_for(
                stop_event.wait(), timeout=settings.v2_indexer_poll_interval_sec
            )
        except asyncio.TimeoutError:
            continue
    _set_status(running=False)
