from __future__ import annotations

import asyncio
from decimal import Decimal
from typing import Any, List, Optional
from uuid import uuid4

from src.core.common import normalize_wallet
from src.core.config import settings
from src.domain.execution import DepositIntentConfirmCommand, DepositIntentRegisterCommand
from src.domain.finance import BalanceLedger
from src.domain.ledger import DepositIntentRow
from src.services.analytics.gateway_events import (
    emit_deposit_completed,
    emit_deposit_failed,
)
from src.storage import BaseStorage
from src.utils.datetime_utils import now_dt_str, to_dt_str, to_epoch_seconds
from src.utils.money import MoneyCodec, money_str

from .chain import (
    _amount_usdc_from_raw,
    _get_confirmed_receipt_or_none,
    _normalize_tx_hash,
    _resolve_matched_event,
    _resolve_token_decimals,
)
from .persistence import (
    _append_audit_log,
    _load_balance_ledger,
    _save_balance_ledger,
    _save_deposit_intents,
    _save_processed_deposit_event_keys,
)
from .shared import logger


def _mark_intent_failed(intent: dict[str, Any], reason: str, now: int) -> None:
    """把 intent 标记为失败，并记录失败原因。"""
    intent["status"] = "FAILED"
    intent["failureReason"] = reason
    intent["updatedAt"] = to_dt_str(now, now_dt_str()) or now_dt_str()

    owner = str(intent.get("ownerAddress") or "")
    amount = MoneyCodec.coerce_decimal(intent.get("amountUsdc") or Decimal("0"))
    if owner and amount > 0:
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(emit_deposit_failed(owner, amount_usdc=amount, error_code=reason))
        except RuntimeError:
            pass


def _intent_created_at_epoch(intent: dict[str, Any], now: int) -> int:
    created_at = intent.get("createdAt") or intent.get("updatedAt")
    return to_epoch_seconds(created_at, default=now)


def _intent_is_stale(intent: dict[str, Any], now: int) -> bool:
    created_at = _intent_created_at_epoch(intent, now)
    return max(0, int(now) - int(created_at)) >= int(
        settings.deposit_pending_intent_stale_after_sec
    )


def _extract_intent_fields(intent: dict[str, Any]) -> Optional[dict[str, Any]]:
    """抽取充值确认所需的最小字段集合。"""
    tx_hash = _normalize_tx_hash(str(intent.get("txHash") or ""))
    owner_wallet = normalize_wallet(str(intent.get("ownerAddress") or ""))
    min_amount_usdc = MoneyCodec.coerce_decimal(intent.get("amountUsdc") or Decimal("0"))
    if not tx_hash or not owner_wallet or min_amount_usdc <= 0:
        return None
    return {
        "tx_hash": tx_hash,
        "owner_wallet": owner_wallet,
        "min_amount_usdc": min_amount_usdc,
    }


def _repair_confirmed_intent_if_needed(
    storage: BaseStorage, intent: dict[str, Any]
) -> dict[str, Any]:
    """修复历史脏数据：intent 已确认，但余额仍卡在 pending。"""
    if not hasattr(storage, "confirm_deposit_intent_atomic"):
        return {"result": "skip"}

    intent_fields = _extract_intent_fields(intent)
    if not intent_fields:
        return {"result": "skip"}

    try:
        confirmed = storage.confirm_deposit_intent_atomic(
            DepositIntentConfirmCommand(
                owner_wallet=str(intent_fields["owner_wallet"]),
                deposit_intent_id=str(intent.get("id") or ""),
                event_key=str(
                    intent.get("eventKey")
                    or f"{intent_fields['tx_hash']}:confirmed_repair"
                ),
                confirmations=int(intent.get("confirmations") or 0),
            )
        )
    except RuntimeError:
        return {"result": "skip"}

    if isinstance(confirmed, DepositIntentRow):
        intent.update(confirmed.model_dump(by_alias=True, mode="json"))
    elif isinstance(confirmed, dict):
        intent.update(confirmed)
    intent["status"] = "CONFIRMED"
    return {"result": "skip"}


def _build_deposit_confirmation_context(
    intent: dict[str, Any],
) -> Optional[dict[str, Any]]:
    """构造 intent 链上确认所需的上下文。"""
    intent_fields = _extract_intent_fields(intent)
    if not intent_fields:
        return None
    return {
        "tx_hash": str(intent_fields["tx_hash"]),
        "owner_wallet": str(intent_fields["owner_wallet"]),
        "min_amount_usdc": MoneyCodec.coerce_decimal(intent_fields["min_amount_usdc"]),
    }


def _resolve_deposit_receipt_state(
    *,
    tx_hash: str,
    owner_wallet: str,
    min_amount_usdc: Decimal,
    now: int,
    intent: dict[str, Any],
) -> Optional[dict[str, Any]]:
    """判断链上交易是否已确认且能匹配到合法 deposit 事件。"""
    tx_receipt = _get_confirmed_receipt_or_none(tx_hash)
    if tx_receipt is None:
        if _intent_is_stale(intent, now):
            _mark_intent_failed(intent, "MISSING_TX_RECEIPT_TIMEOUT", now)
            return {"result": "failed"}
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


def _resolve_event_key_or_mark_duplicate(
    intent: dict[str, Any],
    matched: dict[str, Any],
    processed_keys: set[str],
    now: int,
) -> str:
    """判断 eventKey 是否已消费；重复则把 intent 标成 DUPLICATE。"""
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
    intent: dict[str, Any],
    owner_wallet: str,
    event_key: str,
    confirmations: int,
    ledger: BalanceLedger,
    amount_usdc: Decimal,
    now: int,
) -> dict[str, Any]:
    """应用余额变更，优先走数据库原子确认路径。"""
    if hasattr(storage, "confirm_deposit_intent_atomic"):
        try:
            confirmed = storage.confirm_deposit_intent_atomic(
                DepositIntentConfirmCommand(
                    owner_wallet=owner_wallet,
                    deposit_intent_id=str(intent.get("id") or ""),
                    event_key=event_key,
                    confirmations=confirmations,
                )
            )
        except RuntimeError:
            _mark_intent_failed(intent, "DEPOSIT_CONFIRM_APPLY_FAILED", now)
            return {"result": "failed"}

        if isinstance(confirmed, DepositIntentRow):
            intent.update(confirmed.model_dump(by_alias=True, mode="json"))
        elif isinstance(confirmed, dict):
            intent.update(confirmed)
        intent["status"] = "CONFIRMED"
        fresh_ledger = _load_balance_ledger(storage)
        return {
            "result": "ok",
            "next_balance": fresh_ledger.consumer_available_balance(owner_wallet),
            "changedLedger": False,
        }

    consumer_wallet = ledger.ensure_consumer_wallet(owner_wallet)
    next_balance = MoneyCodec.coerce_decimal(
        (consumer_wallet.available_balance or Decimal("0")) + amount_usdc
    )
    consumer_wallet.available_balance = next_balance
    intent["status"] = "CONFIRMED"
    intent["creditedAmountUsdc"] = money_str(amount_usdc)
    return {"result": "ok", "next_balance": next_balance}


def _apply_confirmed_deposit(
    *,
    storage: BaseStorage,
    intent: dict[str, Any],
    context: dict[str, Any],
    tx_state: dict[str, Any],
    processed_keys: set[str],
    ledger: BalanceLedger,
    now: int,
) -> dict[str, Any]:
    """把链上已确认的 deposit 应用到系统账本和审计。"""
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
        ledger=ledger,
        amount_usdc=amount_usdc,
        now=now,
    )
    if str(applied.get("result") or "") == "failed":
        return {"result": "failed", "changedIntent": True}
    next_balance = MoneyCodec.coerce_decimal(applied.get("next_balance") or Decimal("0"))

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
            "businessType": "deposit",
            "status": "CONFIRMED",
            "txHash": tx_hash,
            "eventKey": event_key,
            "amountUsdc": money_str(intent.get("creditedAmountUsdc") or amount_usdc),
            "balanceAfter": money_str(next_balance),
        },
    )
    logger.info(
        "event=DEPOSIT_CREDITED deposit_id=%s status=confirmed tx_hash=%s owner_wallet=%s event_key=%s amount_usdc=%s balance_after=%s",
        str(intent.get("id") or ""),
        tx_hash,
        owner_wallet,
        event_key,
        money_str(intent.get("creditedAmountUsdc") or amount_usdc),
        money_str(next_balance),
    )

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(emit_deposit_completed(
            owner_wallet,
            amount_usdc=MoneyCodec.coerce_decimal(intent.get("creditedAmountUsdc") or amount_usdc),
            tx_hash=tx_hash,
        ))
    except RuntimeError:
        pass

    return {
        "result": "credited",
        "changedIntent": True,
        "changedLedger": bool(applied.get("changedLedger")),
        "changedProcessed": True,
    }


def _process_single_intent(
    storage: BaseStorage,
    intent: dict[str, Any],
    processed_keys: set[str],
    ledger: BalanceLedger,
    now: int,
) -> dict[str, Any]:
    """处理单条充值 intent 的状态推进。"""
    status = str(intent.get("status") or "PENDING_CONFIRMATION").upper()
    if status == "CONFIRMED":
        return _repair_confirmed_intent_if_needed(storage, intent)
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
        ledger=ledger,
        now=now,
    )


def _accumulate_outcome_counts(
    outcome: dict[str, Any], counters: dict[str, int]
) -> None:
    """把单条处理结果折叠进轮次计数器。"""
    result = str(outcome.get("result") or "skip")
    if result == "credited":
        counters["credited"] += 1
        return
    if result == "failed":
        counters["failed"] += 1
        return
    if result == "pending":
        counters["pending"] += 1


def _apply_outcome_flags(
    outcome: dict[str, Any],
    *,
    changed_intents: bool,
    changed_ledger: bool,
    changed_processed: bool,
) -> tuple[bool, bool, bool]:
    """把单条 outcome 的脏标记并入批量 flush 标记。"""
    return (
        changed_intents or bool(outcome.get("changedIntent")),
        changed_ledger or bool(outcome.get("changedLedger")),
        changed_processed or bool(outcome.get("changedProcessed")),
    )


def _persist_processing_changes(
    storage: BaseStorage,
    *,
    intents: List[dict[str, Any]],
    processed_keys: set[str],
    ledger: BalanceLedger,
    changed_intents: bool,
    changed_ledger: bool,
    changed_processed: bool,
) -> None:
    """按脏标记把 intent / ledger / eventKey 写回存储层。"""
    if changed_ledger:
        _save_balance_ledger(storage, ledger)
    if changed_processed:
        _save_processed_deposit_event_keys(storage, sorted(processed_keys))
    if changed_intents:
        _save_deposit_intents(storage, intents)


def _find_intent_by_tx_owner(
    intents: List[dict[str, Any]], tx_hash: str, owner_wallet: str
) -> Optional[dict[str, Any]]:
    """按 txHash + owner 定位对应的 deposit intent。"""
    owner = normalize_wallet(owner_wallet)
    tx = _normalize_tx_hash(tx_hash)
    if not owner or not tx:
        return None
    for row in intents:
        if (
            normalize_wallet(str(row.get("ownerAddress") or ""))
            != owner
        ):
            continue
        if _normalize_tx_hash(str(row.get("txHash") or "")) != tx:
            continue
        return row
    return None


def _build_recovery_intent(
    tx_hash: str, owner_wallet: str, amount_usdc: Decimal, event_key: str, now: int
) -> dict[str, Any]:
    """为链上已存在但本地缺失的充值构造补账 intent。"""
    now_text = to_dt_str(now, now_dt_str()) or now_dt_str()
    return {
        "id": str(uuid4()),
        "ownerAddress": normalize_wallet(owner_wallet),
        "consumerAddress": normalize_wallet(owner_wallet),
        "txHash": _normalize_tx_hash(tx_hash),
        "amountUsdc": money_str(amount_usdc),
        "creditedAmountUsdc": money_str(Decimal("0")),
        "idempotencyKey": f"deposit_backfill_{event_key.replace(':', '_')}",
        "status": "PENDING_CONFIRMATION",
        "createdAt": now_text,
        "updatedAt": now_text,
        "source": "INDEXER_BACKFILL",
    }


def _register_recovery_intent_if_atomic(
    storage: BaseStorage,
    intent: dict[str, Any],
    owner_wallet: str,
    tx_hash: str,
) -> dict[str, Any]:
    """Persist a backfilled recovery intent before atomic confirmation."""
    if not hasattr(storage, "register_deposit_intent_atomic"):
        return intent
    row = DepositIntentRow.model_validate(intent)
    registered = storage.register_deposit_intent_atomic(
        DepositIntentRegisterCommand(
            owner_wallet=owner_wallet,
            tx_hash=tx_hash,
            request_id=str(intent.get("idempotencyKey") or row.id),
            intent_row=row,
        )
    )
    if isinstance(registered, DepositIntentRow):
        return registered.model_dump(by_alias=True, mode="json")
    if isinstance(registered, dict):
        return dict(registered)
    raise RuntimeError("DEPOSIT_BACKFILL_REGISTER_RESULT_INVALID")
