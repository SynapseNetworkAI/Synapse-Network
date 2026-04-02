from __future__ import annotations

from typing import Any, Dict, Optional

from src.core.common import normalize_wallet
from src.core.config import settings
from src.domain.finance import BalanceLedger
from src.storage import BaseStorage

from .chain import (
    _amount_usdc_from_raw,
    _collect_router_candidate_tx_hashes,
    _confirmed_head_block,
    _decode_deposit_events_from_receipt,
    _get_confirmed_receipt_or_none,
    _resolve_token_decimals,
)
from .persistence import (
    _load_backfill_state,
    _load_balance_ledger,
    _load_deposit_intents,
    _persist_indexer_runtime_state,
    _load_processed_deposit_event_keys,
    _save_backfill_state,
)
from .processing import (
    _apply_outcome_flags,
    _build_recovery_intent,
    _find_intent_by_tx_owner,
    _persist_processing_changes,
    _process_single_intent,
)
from .shared import _now, _set_status, lock, logger


def _resolve_initial_backfill_start_block(confirmed_head: int) -> int:
    """当数据库还没有游标时，决定首次 backfill 起点。"""
    configured_start = int(settings.v2_backfill_start_block)
    if configured_start > 0:
        return configured_start
    return max(
        1, confirmed_head - max(1, int(settings.v2_backfill_block_batch)) + 1
    )


def _resolve_backfill_scan_range(
    state: Dict[str, Any], confirmed_head: int
) -> Optional[Dict[str, int]]:
    """根据数据库游标和配置，计算本轮 backfill 的区块范围。"""
    if confirmed_head <= 0:
        return None

    last_scanned = int(state.get("lastScannedBlock") or 0)
    start_block = (
        last_scanned + 1
        if last_scanned > 0
        else _resolve_initial_backfill_start_block(confirmed_head)
    )
    end_block = min(
        confirmed_head,
        start_block + max(1, int(settings.v2_backfill_block_batch)) - 1,
    )
    return {
        "startBlock": start_block,
        "endBlock": end_block,
        "lastScannedBlock": last_scanned,
    }


def _process_backfill_event(
    storage: BaseStorage,
    *,
    intents: list[Dict[str, Any]],
    processed_keys: set[str],
    ledger: BalanceLedger,
    tx_hash: str,
    event: Dict[str, Any],
    now: int,
) -> Dict[str, Any]:
    """处理 backfill 扫描出的单个链上充值事件。"""
    event_key = str(event.get("eventKey") or "")
    if not event_key or event_key in processed_keys:
        return {"result": "skip"}

    owner_wallet = normalize_wallet(str(event.get("ownerAddress") or ""))
    if not owner_wallet:
        return {"result": "skip"}

    token = str(event.get("token") or "")
    decimals = _resolve_token_decimals(token) if token else 6
    amount_usdc = _amount_usdc_from_raw(
        int(event.get("amountRaw") or 0), decimals=decimals
    )
    if amount_usdc <= 0:
        return {"result": "skip"}

    target_intent = _find_intent_by_tx_owner(intents, tx_hash, owner_wallet)
    if target_intent is None:
        target_intent = _build_recovery_intent(
            tx_hash, owner_wallet, amount_usdc, event_key, now
        )
        intents.append(target_intent)
        changed_intent = True
    else:
        changed_intent = False

    outcome = _process_single_intent(storage, target_intent, processed_keys, ledger, now)
    if changed_intent:
        outcome["changedIntent"] = True
    return outcome


def run_backfill_scan_once(storage: BaseStorage) -> Dict[str, Any]:
    """按区块范围做补扫，把漏掉的链上充值补成 intent/入账结果。"""
    if not bool(settings.v2_backfill_enabled):
        return {"enabled": False}

    now = _now()
    state = _load_backfill_state(storage)
    confirmed_head = _confirmed_head_block()
    scan_range = _resolve_backfill_scan_range(state, confirmed_head)
    if scan_range is None:
        return {
            "enabled": True,
            "scanned": 0,
            "recovered": 0,
            "lastScannedBlock": state.get("lastScannedBlock"),
        }

    last_scanned = int(scan_range["lastScannedBlock"])
    start_block = int(scan_range["startBlock"])
    end_block = int(scan_range["endBlock"])
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
        _persist_indexer_runtime_state(storage)
        return {
            "enabled": True,
            "scanned": 0,
            "recovered": 0,
            "lastScannedBlock": last_scanned,
        }

    logger.info(
        "deposit backfill start start_block=%s end_block=%s last_scanned_block=%s confirmed_head=%s",
        start_block,
        end_block,
        last_scanned,
        confirmed_head,
    )

    candidate_tx_count = 0
    with lock:
        intents = _load_deposit_intents(storage)
        processed_keys = set(_load_processed_deposit_event_keys(storage))
        ledger = _load_balance_ledger(storage)

        changed_intents = False
        changed_ledger = False
        changed_processed = False
        recovered = 0

        tx_hashes = _collect_router_candidate_tx_hashes(start_block, end_block)
        candidate_tx_count = len(tx_hashes)
        for tx_hash in tx_hashes:
            tx_state = _get_confirmed_receipt_or_none(tx_hash)
            if tx_state is None or tx_state.get("failed") is True:
                continue
            receipt_obj = tx_state.get("receipt")
            if receipt_obj is None:
                continue

            for event in _decode_deposit_events_from_receipt(receipt_obj):
                outcome = _process_backfill_event(
                    storage,
                    intents=intents,
                    processed_keys=processed_keys,
                    ledger=ledger,
                    tx_hash=tx_hash,
                    event=event,
                    now=now,
                )
                changed_intents, changed_ledger, changed_processed = _apply_outcome_flags(
                    outcome,
                    changed_intents=changed_intents,
                    changed_ledger=changed_ledger,
                    changed_processed=changed_processed,
                )
                if str(outcome.get("result") or "") == "credited":
                    recovered += 1

        _persist_processing_changes(
            storage,
            intents=intents,
            processed_keys=processed_keys,
            ledger=ledger,
            changed_intents=changed_intents,
            changed_ledger=changed_ledger,
            changed_processed=changed_processed,
        )

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
    _persist_indexer_runtime_state(storage)
    logger.info(
        "deposit backfill done start_block=%s end_block=%s scanned=%s candidate_txs=%s recovered=%s",
        start_block,
        end_block,
        max(0, end_block - start_block + 1),
        candidate_tx_count,
        recovered,
    )
    return {
        "enabled": True,
        "scanned": max(0, end_block - start_block + 1),
        "recovered": recovered,
        "lastScannedBlock": end_block,
    }