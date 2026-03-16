from __future__ import annotations

import asyncio
from typing import Any, Dict

from src.core.common import normalize_wallet
from src.core.config import settings
from src.storage import BaseStorage

from .backfill import run_backfill_scan_once
from .chain import _decode_deposit_events_from_receipt, _get_confirmed_receipt_or_none, _normalize_tx_hash
from .persistence import (
    _append_audit_log,
    _load_backfill_state,
    _load_balance_ledger,
    _load_deposit_intents,
    _load_processed_deposit_event_keys,
    _load_runtime_state,
)
from .processing import (
    _accumulate_outcome_counts,
    _apply_outcome_flags,
    _build_recovery_intent,
    _find_intent_by_tx_owner,
    _persist_processing_changes,
    _process_single_intent,
)
from .reconciliation import run_reconciliation_check_once
from .shared import (
    INDEXER_STATUS,
    _BACKFILL_ERROR_CODE,
    _INDEXER_LOOP_ERROR_CODE,
    _RECONCILIATION_ERROR_CODE,
    _now,
    _set_status,
    lock,
    logger,
)


def _validated_replay_receipt_or_raise(normalized_tx: str) -> Dict[str, Any]:
    """校验重放目标交易必须已确认且 receipt 完整。"""
    tx_state = _get_confirmed_receipt_or_none(normalized_tx)
    if tx_state is None:
        raise RuntimeError("TX_NOT_CONFIRMED")
    if tx_state.get("failed") is True:
        raise RuntimeError("TX_FAILED")
    receipt_obj = tx_state.get("receipt")
    if receipt_obj is None:
        raise RuntimeError("MISSING_TX_RECEIPT")
    return tx_state


def _process_replay_event(
    storage: BaseStorage,
    *,
    intents: list[Dict[str, Any]],
    processed_keys: set[str],
    buyers: Dict[str, float],
    normalized_tx: str,
    event: Dict[str, Any],
    summary: Dict[str, Any],
    now: int,
) -> Dict[str, Any]:
    """处理管理员 replay 流中的单个链上事件。"""
    owner_wallet = normalize_wallet(str(event.get("buyer") or ""))
    if not owner_wallet:
        return {"result": "skip"}

    amount_usdc = 0.0
    event_key = str(event.get("eventKey") or "")
    target_intent = _find_intent_by_tx_owner(intents, normalized_tx, owner_wallet)
    if target_intent is None:
        token = str(event.get("token") or "")
        from .chain import _amount_usdc_from_raw, _resolve_token_decimals

        decimals = _resolve_token_decimals(token) if token else 6
        amount_usdc = _amount_usdc_from_raw(
            int(event.get("amountRaw") or 0), decimals=decimals
        )
        target_intent = _build_recovery_intent(
            normalized_tx, owner_wallet, amount_usdc, event_key, now
        )
        intents.append(target_intent)
        summary["intentsCreated"] += 1
        changed_intent = True
    else:
        changed_intent = False

    outcome = _process_single_intent(storage, target_intent, processed_keys, buyers, now)
    if changed_intent:
        outcome["changedIntent"] = True
    return outcome


def replay_deposit_tx(
    storage: BaseStorage, tx_hash: str, requested_by: str
) -> Dict[str, Any]:
    """管理员按 txHash 强制重放一笔充值交易。"""
    normalized_tx = _normalize_tx_hash(tx_hash)
    if not normalized_tx:
        raise ValueError("INVALID_TX_HASH")

    now = _now()
    tx_state = _validated_replay_receipt_or_raise(normalized_tx)
    receipt_obj = tx_state["receipt"]

    events = _decode_deposit_events_from_receipt(receipt_obj)
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
            outcome = _process_replay_event(
                storage,
                intents=intents,
                processed_keys=processed_keys,
                buyers=buyers,
                normalized_tx=normalized_tx,
                event=event,
                summary=summary,
                now=now,
            )
            changed_intents, changed_ledger, changed_processed = _apply_outcome_flags(
                outcome,
                changed_intents=changed_intents,
                changed_ledger=changed_ledger,
                changed_processed=changed_processed,
            )
            _accumulate_outcome_counts(outcome, summary)

        _persist_processing_changes(
            storage,
            intents=intents,
            processed_keys=processed_keys,
            ledger=ledger,
            changed_intents=changed_intents,
            changed_ledger=changed_ledger,
            changed_processed=changed_processed,
        )

    _append_audit_log(
        storage,
        "V2_DEPOSIT_REPLAY_ADMIN",
        normalize_wallet(requested_by),
        summary,
    )
    logger.info(
        "deposit replay completed tx_hash=%s events=%s intents_created=%s credited=%s failed=%s pending=%s requested_by=%s",
        normalized_tx,
        summary["events"],
        summary["intentsCreated"],
        summary["credited"],
        summary["failed"],
        summary["pending"],
        normalize_wallet(requested_by),
    )
    return summary


def process_pending_deposit_intents_once(storage: BaseStorage) -> Dict[str, int]:
    """单轮处理所有待确认 intent，是最终一致性的主入口。"""
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
            outcome = _process_single_intent(
                storage, intent, processed_keys, buyers, now
            )

            changed_intents, changed_ledger, changed_processed = _apply_outcome_flags(
                outcome,
                changed_intents=changed_intents,
                changed_ledger=changed_ledger,
                changed_processed=changed_processed,
            )
            _accumulate_outcome_counts(outcome, counters)

        _persist_processing_changes(
            storage,
            intents=intents,
            processed_keys=processed_keys,
            ledger=ledger,
            changed_intents=changed_intents,
            changed_ledger=changed_ledger,
            changed_processed=changed_processed,
        )

    _set_status(lastCounters=counters, lastProcessedAt=now, lastError=None)
    if any(int(value) > 0 for value in counters.values()):
        logger.info(
            "deposit pending cycle credited=%s failed=%s pending=%s intent_count=%s",
            counters["credited"],
            counters["failed"],
            counters["pending"],
            len(intents),
        )
    return counters


def _hydrate_runtime_status(storage: BaseStorage) -> None:
    """启动时从数据库恢复 backfill/reconciliation 游标，避免状态只存在内存。"""
    backfill_state = _load_backfill_state(storage)
    reconciliation_state = _load_runtime_state(storage, "deposit_reconciliation_state")
    _set_status(
        backfill={
            "enabled": bool(settings.v2_backfill_enabled),
            "lastScannedBlock": backfill_state.get("lastScannedBlock"),
            "lastScanAt": backfill_state.get("lastScanAt"),
            "lastRecovered": INDEXER_STATUS.get("backfill", {}).get("lastRecovered", 0),
            "lastError": None,
        },
        reconciliation={
            "enabled": bool(settings.v2_reconciliation_enabled),
            "lastCheckAt": reconciliation_state.get("lastCheckAt"),
            "chainVaultUsdc": float(reconciliation_state.get("chainVaultUsdc") or 0.0),
            "ledgerObligationUsdc": float(reconciliation_state.get("ledgerObligationUsdc") or 0.0),
            "deltaUsdc": float(reconciliation_state.get("deltaUsdc") or 0.0),
            "alert": bool(reconciliation_state.get("alert") or False),
            "lastError": None,
        },
    )
    logger.info(
        "deposit indexer runtime hydrated last_scanned_block=%s last_scan_at=%s last_reconciliation_at=%s",
        backfill_state.get("lastScannedBlock"),
        backfill_state.get("lastScanAt"),
        reconciliation_state.get("lastCheckAt"),
    )


def _mark_backfill_failure() -> None:
    """记录 backfill 失败状态，但不让主循环崩掉。"""
    logger.exception("deposit backfill scan failed")
    _set_status(
        backfill={
            "enabled": True,
            "lastScannedBlock": None,
            "lastScanAt": _now(),
            "lastRecovered": 0,
            "lastError": _BACKFILL_ERROR_CODE,
        }
    )


def _mark_reconciliation_failure(now: int) -> None:
    """记录 reconciliation 失败状态，但不让主循环崩掉。"""
    logger.exception("deposit reconciliation check failed")
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


def _run_backfill_if_enabled(storage: BaseStorage) -> None:
    """执行一次 backfill 周期，失败时仅记录状态。"""
    if not settings.v2_backfill_enabled:
        return
    try:
        run_backfill_scan_once(storage)
    except Exception:
        _mark_backfill_failure()


def _run_reconciliation_if_due(
    storage: BaseStorage, last_reconciliation_at: int
) -> int:
    """如果到达对账周期，则执行一次 reconciliation 并返回新的时间戳。"""
    now = _now()
    if not settings.v2_reconciliation_enabled:
        return last_reconciliation_at
    if (now - last_reconciliation_at) < int(settings.v2_reconciliation_interval_sec):
        return last_reconciliation_at
    try:
        run_reconciliation_check_once(storage)
        return now
    except Exception:
        _mark_reconciliation_failure(now)
        return last_reconciliation_at


async def run_v2_deposit_indexer(
    stop_event: asyncio.Event, storage: BaseStorage
) -> None:
    """常驻 indexer 主循环：补扫区块、推进 intent、周期对账。"""
    _set_status(running=True, listenerAddress=normalize_wallet(settings.router_address))
    _hydrate_runtime_status(storage)
    logger.info(
        "deposit indexer started listener=%s poll_interval_sec=%s",
        normalize_wallet(settings.router_address),
        settings.v2_indexer_poll_interval_sec,
    )
    last_reconciliation_at = 0
    while not stop_event.is_set():
        try:
            _run_backfill_if_enabled(storage)
            process_pending_deposit_intents_once(storage)
            last_reconciliation_at = _run_reconciliation_if_due(
                storage, last_reconciliation_at
            )
        except Exception:
            logger.exception("deposit indexer loop failed")
            _set_status(lastError=_INDEXER_LOOP_ERROR_CODE, lastProcessedAt=_now())
        try:
            await asyncio.wait_for(
                stop_event.wait(), timeout=settings.v2_indexer_poll_interval_sec
            )
        except asyncio.TimeoutError:
            continue
    _set_status(running=False)
    logger.info("deposit indexer stopped")