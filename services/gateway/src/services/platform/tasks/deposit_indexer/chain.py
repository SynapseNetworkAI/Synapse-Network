from __future__ import annotations

import json
import os
from decimal import Decimal
from typing import Any, List, Optional

from web3.exceptions import TransactionNotFound

from src.core.common import normalize_wallet
from src.core.config import settings
from src.utils.money import MoneyCodec

from .shared import (
    TOKEN_DECIMALS_CACHE,
    get_transfer_topic,
    get_web3,
    get_web3_class,
    logger,
)


class DepositIndexerRpcUnavailable(RuntimeError):
    """Raised when backfill cannot reach the configured RPC endpoint."""


TX_HASH_HEX_LENGTH = 66
ADDRESS_HEX_LENGTH = 42
TRANSFER_TOPIC_COUNT = 3
MAX_TOKEN_DECIMALS = 36
_DEPOSIT_INFO_TOPIC: str | None = None


def _legacy_deposit_sender_key() -> str:
    return "".join(("bu", "yer"))


def _normalize_tx_hash(value: str) -> str:
    """校验并标准化 tx hash。"""
    tx_hash = str(value or "").strip().lower()
    if tx_hash.startswith("0x") and len(tx_hash) == TX_HASH_HEX_LENGTH:
        return tx_hash
    return ""


def _topic_to_address(topic: Any) -> str:
    """把 event topic 末 20 字节解码为地址。"""
    web3_class = get_web3_class()
    topic_hex = str(topic).lower() if isinstance(topic, str) else web3_class.to_hex(topic).lower()
    if len(topic_hex) < ADDRESS_HEX_LENGTH:
        return ""
    return web3_class.to_checksum_address("0x" + topic_hex[-40:]).lower()


def _get_deposit_info_topic() -> str:
    global _DEPOSIT_INFO_TOPIC
    if _DEPOSIT_INFO_TOPIC is None:
        web3_class = get_web3_class()
        _DEPOSIT_INFO_TOPIC = web3_class.to_hex(
            web3_class.keccak(text="DepositInfo(address,uint256)")
        ).lower()
    return _DEPOSIT_INFO_TOPIC


def _make_event_row(
    tx_hash: str, log_index: int, owner_wallet: str, amount_raw: int, token: str
) -> Optional[dict[str, Any]]:
    """把原始链上日志转换为统一的 deposit event 行。"""
    normalized_owner = normalize_wallet(owner_wallet)
    if not normalized_owner or amount_raw <= 0:
        return None
    return {
        "eventKey": f"{tx_hash}:{log_index}",
        "ownerAddress": normalized_owner,
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
) -> List[dict[str, Any]]:
    """从路由合约 receipt 中提取指定事件名的充值事件。"""
    event_cls = getattr(contract.events, event_name, None)
    if event_cls is None:
        return []

    try:
        rows = event_cls().process_receipt(tx_receipt)
    except Exception:
        return []

    parsed: List[dict[str, Any]] = []
    for row in rows:
        args = row.get("args", {})
        sender = (
            args.get(_legacy_deposit_sender_key())
            or args.get("user")
            or args.get("from")
            or ""
        )
        maybe_event = _make_event_row(
            tx_hash,
            int(row.get("logIndex", 0)),
            str(sender),
            int(args.get("amount") or args.get("value") or 0),
            str(args.get("token") or ""),
        )
        if maybe_event:
            parsed.append(maybe_event)

    return parsed


def _decode_router_deposit_events(tx_receipt: Any) -> List[dict[str, Any]]:
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
        w3 = get_web3()
        contract = w3.eth.contract(
            address=w3.to_checksum_address(settings.router_address), abi=router_abi
        )
    except Exception:
        return []

    tx_hash = tx_receipt["transactionHash"].hex().lower()
    events: List[dict[str, Any]] = []
    for event_name in ("DepositInfo", "Deposit", "Deposited"):
        events.extend(
            _extract_router_event_rows(contract, event_name, tx_receipt, tx_hash)
        )
    return events


def _decode_deposit_info_log(log: Any) -> Optional[dict[str, Any]]:
    topics = log.get("topics") or []
    if len(topics) < 2:
        return None
    topic0 = (
        str(topics[0]).lower()
        if isinstance(topics[0], str)
        else get_web3_class().to_hex(topics[0]).lower()
    )
    if topic0 != _get_deposit_info_topic():
        return None

    owner_wallet = _topic_to_address(topics[1])
    tx_hash = _tx_hash_to_hex(log.get("transactionHash"))
    if not owner_wallet or not tx_hash:
        return None

    return _make_event_row(
        tx_hash,
        int(log.get("logIndex", 0)),
        owner_wallet,
        _decode_amount_raw(log.get("data", "0x0")),
        str(settings.usdc_token_address or ""),
    )


def _collect_deposit_event_rows(start_block: int, end_block: int) -> List[dict[str, Any]]:
    """Collect canonical DepositInfo logs for a bounded block range."""
    if int(start_block) > int(end_block):
        return []

    w3 = get_web3()
    _ensure_rpc_connected(w3)
    router = normalize_wallet(settings.router_address)
    if not router:
        return []

    logs = w3.eth.get_logs(
        {
            "address": w3.to_checksum_address(router),
            "fromBlock": int(start_block),
            "toBlock": int(end_block),
            "topics": [_get_deposit_info_topic()],
        }
    )
    events: List[dict[str, Any]] = []
    for log in logs:
        maybe_event = _decode_deposit_info_log(log)
        if maybe_event:
            events.append(maybe_event)
    return events


def _decode_erc20_transfer_to_router(tx_receipt: Any) -> List[dict[str, Any]]:
    """当标准事件缺失时，退化为解析 ERC20 Transfer 到路由地址。"""
    router = normalize_wallet(settings.router_address)
    if not router or router == "0x0000000000000000000000000000000000000000":
        return []

    events: List[dict[str, Any]] = []
    tx_hash = tx_receipt["transactionHash"].hex().lower()
    web3_class = get_web3_class()
    transfer_topic = get_transfer_topic()

    for log in tx_receipt.get("logs", []):
        topics = log.get("topics") or []
        if len(topics) < TRANSFER_TOPIC_COUNT:
            continue
        topic0 = web3_class.to_hex(topics[0]).lower()
        if topic0 != transfer_topic:
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


def _decode_deposit_events_from_receipt(tx_receipt: Any) -> List[dict[str, Any]]:
    """统一封装 receipt -> deposit events 的解码策略。"""
    events = _decode_router_deposit_events(tx_receipt)
    if not events:
        events = _decode_erc20_transfer_to_router(tx_receipt)
    return events


def _amount_usdc_from_raw(amount_raw: int, decimals: int = 6) -> Decimal:
    """把链上最小单位金额转换成人类可读 USDC。"""
    return MoneyCodec.from_atomic(amount_raw, decimals=decimals)


def _resolve_token_decimals(token_address: str) -> int:
    """读取并缓存 token decimals，避免重复 RPC。"""
    token = normalize_wallet(token_address)
    if not token:
        return 6
    cached = TOKEN_DECIMALS_CACHE.get(token)
    if cached is not None:
        return cached

    try:
        w3 = get_web3()
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
        if value <= 0 or value > MAX_TOKEN_DECIMALS:
            value = 6
        TOKEN_DECIMALS_CACHE[token] = value
    except Exception:
        TOKEN_DECIMALS_CACHE[token] = 6
        return 6
    else:
        return value


def _pick_matching_event(
    events: List[dict[str, Any]],
    owner_wallet: str,
    min_amount_usdc: Decimal | str | int,
) -> Optional[dict[str, Any]]:
    """从候选事件中挑出属于 owner 且金额满足下限的最佳匹配。"""
    owner = normalize_wallet(owner_wallet)
    minimum = MoneyCodec.coerce_decimal(min_amount_usdc)
    candidate: Optional[dict[str, Any]] = None

    for row in events:
        row_owner = normalize_wallet(str(row.get("ownerAddress", "")))
        if row_owner != owner:
            continue
        decimals = _resolve_token_decimals(str(row.get("token") or ""))
        amount_usdc = _amount_usdc_from_raw(
            int(row.get("amountRaw", 0)), decimals=decimals
        )
        if amount_usdc < minimum:
            continue
        if candidate is None or int(row.get("amountRaw", 0)) > int(
            candidate.get("amountRaw", 0)
        ):
            candidate = row

    return candidate


def _confirmations_for_receipt(tx_receipt: Any) -> int:
    """根据 receipt.blockNumber 计算当前确认数。"""
    w3 = get_web3()
    latest_block = int(w3.eth.block_number)
    block_number = int(tx_receipt.get("blockNumber") or 0)
    if block_number <= 0:
        return 0
    return max(0, latest_block - block_number + 1)


def _get_confirmed_receipt_or_none(tx_hash: str) -> Optional[dict[str, Any]]:
    """读取 receipt；未确认返回 None，失败交易返回 failed 标记。"""
    try:
        w3 = get_web3()
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
    tx_receipt: Any, owner_wallet: str, min_amount_usdc: Decimal | str | int
) -> Optional[dict[str, Any]]:
    """从 receipt 中解出并匹配当前 intent 对应的 deposit 事件。"""
    return _pick_matching_event(
        _decode_deposit_events_from_receipt(tx_receipt), owner_wallet, min_amount_usdc
    )


def _confirmed_head_block() -> int:
    """返回满足确认数门槛后的安全扫描上界。"""
    try:
        w3 = get_web3()
        _ensure_rpc_connected(w3)
        latest = int(w3.eth.block_number or 0)
    except DepositIndexerRpcUnavailable:
        raise
    except Exception as exc:
        raise DepositIndexerRpcUnavailable("RPC_UNAVAILABLE") from exc

    finality_mode = str(
        getattr(settings, "deposit_event_finality_mode", "confirmations")
        or "confirmations"
    ).strip().lower()
    if finality_mode in {"safe", "finalized"}:
        try:
            block = w3.eth.get_block(finality_mode)
            block_number = int(block.get("number") or 0)
            if block_number > 0:
                return block_number
        except Exception:
            logger.warning(
                "deposit event scanner falling back to confirmation buffer because %s head is unavailable",
                finality_mode,
            )

    buffer = int(
        getattr(
            settings,
            "deposit_event_finality_buffer_blocks",
            max(0, int(settings.v2_deposit_confirmations) - 1),
        )
        or 0
    )
    return max(0, latest - max(0, buffer))


def _ensure_rpc_connected(w3: Any) -> None:
    """Raise a domain error when the configured RPC endpoint is unavailable."""
    is_connected = getattr(w3, "is_connected", None)
    if callable(is_connected) and not bool(is_connected()):
        raise DepositIndexerRpcUnavailable("RPC_UNAVAILABLE")
    legacy_is_connected = getattr(w3, "isConnected", None)
    if callable(legacy_is_connected) and not bool(legacy_is_connected()):
        raise DepositIndexerRpcUnavailable("RPC_UNAVAILABLE")


def _tx_hash_to_hex(value: Any) -> str:
    """兼容不同 web3 返回类型，统一提取 tx hash。"""
    if value is None:
        return ""
    if hasattr(value, "hex"):
        try:
            text = str(value.hex()).strip().lower()
            return text if text.startswith("0x") else f"0x{text}"
        except Exception:
            return ""
    text = str(value).strip().lower()
    if text.startswith("0x") and len(text) == TX_HASH_HEX_LENGTH:
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

    w3 = get_web3()
    dedup: set[str] = set()
    for block_number in range(int(start_block), int(end_block) + 1):
        try:
            block = w3.eth.get_block(block_number, full_transactions=True)
        except Exception as exc:
            logger.warning(
                "deposit backfill skipped block=%s error=%s",
                block_number,
                type(exc).__name__,
            )
            continue

        for tx in _extract_block_transactions(block):
            to_addr, tx_hash = _extract_tx_route_snapshot(tx)
            if to_addr != router:
                continue
            if tx_hash:
                dedup.add(tx_hash)
    return sorted(dedup)
