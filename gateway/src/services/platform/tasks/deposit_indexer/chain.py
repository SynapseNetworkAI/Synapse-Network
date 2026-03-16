from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

from web3 import Web3
from web3.exceptions import TransactionNotFound

from src.core.common import normalize_wallet
from src.core.config import settings

from .shared import TOKEN_DECIMALS_CACHE, TRANSFER_TOPIC, w3


def _normalize_tx_hash(value: str) -> str:
    """校验并标准化 tx hash。"""
    tx_hash = str(value or "").strip().lower()
    if tx_hash.startswith("0x") and len(tx_hash) == 66:
        return tx_hash
    return ""


def _topic_to_address(topic: Any) -> str:
    """把 event topic 末 20 字节解码为地址。"""
    topic_hex = Web3.to_hex(topic).lower()
    if len(topic_hex) < 42:
        return ""
    return Web3.to_checksum_address("0x" + topic_hex[-40:]).lower()


def _make_event_row(
    tx_hash: str, log_index: int, buyer: str, amount_raw: int, token: str
) -> Optional[Dict[str, Any]]:
    """把原始链上日志转换为统一的 deposit event 行。"""
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
    """兼容 bytes/int/hex string 三种 data 表达，解出原始金额。"""
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
    """从路由合约 receipt 中提取指定事件名的充值事件。"""
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
    """优先按 SynapseCore ABI 解码标准 deposit 事件。"""
    base_dir = os.path.abspath(__file__)
    candidate_paths = [
        os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(base_dir))),
            "SynapseCoreABI.json",
        ),
        os.path.join(
            os.path.dirname(
                os.path.dirname(
                    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(base_dir))))
                )
            ),
            "SynapseCoreABI.json",
        ),
    ]
    abi_path = next((path for path in candidate_paths if os.path.exists(path)), "")
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
    """当标准事件缺失时，退化为解析 ERC20 Transfer 到路由地址。"""
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


def _decode_deposit_events_from_receipt(tx_receipt: Any) -> List[Dict[str, Any]]:
    """统一封装 receipt -> deposit events 的解码策略。"""
    events = _decode_router_deposit_events(tx_receipt)
    if not events:
        events = _decode_erc20_transfer_to_router(tx_receipt)
    return events


def _amount_usdc_from_raw(amount_raw: int, decimals: int = 6) -> float:
    """把链上最小单位金额转换成人类可读 USDC。"""
    return round(float(amount_raw) / float(10**decimals), 6)


def _resolve_token_decimals(token_address: str) -> int:
    """读取并缓存 token decimals，避免重复 RPC。"""
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
    """从候选事件中挑出属于 owner 且金额满足下限的最佳匹配。"""
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
    """根据 receipt.blockNumber 计算当前确认数。"""
    latest_block = int(w3.eth.block_number)
    block_number = int(tx_receipt.get("blockNumber") or 0)
    if block_number <= 0:
        return 0
    return max(0, latest_block - block_number + 1)


def _get_confirmed_receipt_or_none(tx_hash: str) -> Optional[Dict[str, Any]]:
    """读取 receipt；未确认返回 None，失败交易返回 failed 标记。"""
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
    """从 receipt 中解出并匹配当前 intent 对应的 deposit 事件。"""
    return _pick_matching_event(
        _decode_deposit_events_from_receipt(tx_receipt), owner_wallet, min_amount_usdc
    )


def _confirmed_head_block() -> int:
    """返回满足确认数门槛后的安全扫描上界。"""
    latest = int(w3.eth.block_number or 0)
    confirmations = max(1, int(settings.v2_deposit_confirmations))
    return max(0, latest - confirmations + 1)


def _tx_hash_to_hex(value: Any) -> str:
    """兼容不同 web3 返回类型，统一提取 tx hash。"""
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


def _extract_block_transactions(block: Any) -> List[Any]:
    """兼容 dict/AttributeDict 两种 block 结构，抽取 transactions 列表。"""
    transactions = (
        block.get("transactions", [])
        if isinstance(block, dict)
        else getattr(block, "transactions", [])
    )
    return transactions if isinstance(transactions, list) else []


def _extract_tx_route_snapshot(tx: Any) -> tuple[str, str]:
    """抽取交易目标地址和 tx hash，供路由过滤使用。"""
    if isinstance(tx, dict):
        return (
            normalize_wallet(str(tx.get("to") or "")),
            _tx_hash_to_hex(tx.get("hash")),
        )
    return (
        normalize_wallet(str(getattr(tx, "to", "") or "")),
        _tx_hash_to_hex(getattr(tx, "hash", None)),
    )


def _collect_router_candidate_tx_hashes(start_block: int, end_block: int) -> List[str]:
    """扫描区块范围，找出所有打到 router 的候选交易哈希。"""
    router = normalize_wallet(settings.router_address)
    if not router:
        return []

    dedup: set[str] = set()
    for block_number in range(int(start_block), int(end_block) + 1):
        try:
            block = w3.eth.get_block(block_number, full_transactions=True)
        except Exception:
            continue

        for tx in _extract_block_transactions(block):
            to_addr, tx_hash = _extract_tx_route_snapshot(tx)
            if to_addr != router:
                continue
            if tx_hash:
                dedup.add(tx_hash)
    return sorted(dedup)