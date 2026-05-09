from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from src.core.common import normalize_wallet
from src.core.config import settings
from src.domain.finance import BalanceLedger
from src.storage import BaseStorage

from .chain import (
    _amount_usdc_from_raw,
    _collect_deposit_event_rows,
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
    _register_recovery_intent_if_atomic,
)
from .shared import _now, _set_status, lock, logger


@dataclass(frozen=True)
class BackfillScanResult:
    enabled: bool
    scanned: int = 0
    recovered: int = 0
    last_scanned_block: int | None = None


def _resolve_initial_backfill_start_block(confirmed_head: int) -> int:
    """当数据库还没有游标时，决定首次 backfill 起点。"""
    configured_start = int(settings.v2_backfill_start_block)
    if configured_start > 0:
        return configured_start
    return max(
        1, confirmed_head - max(1, int(settings.v2_backfill_block_batch)) + 1
    )


def _resolve_backfill_scan_range(
    state: dict[str, Any], confirmed_head: int
) -> Optional[dict[str, int]]:
    """根据数据库游标和配置，计算本轮 backfill 的区块范围。"""
    if confirmed_head <= 0:
        return None

    last_scanned = int(state.get("lastScannedBlock") or 0)
    configured_start = int(settings.v2_backfill_start_block)
    start_block = (
        last_scanned + 1
        if last_scanned > 0 and last_scanned <= confirmed_head
        else configured_start
        if configured_start > 0
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


def _iter_event_scan_chunks(
    start_block: int, end_block: int
) -> list[tuple[int, int]]:
    chunk_size = max(1, int(settings.deposit_event_max_log_block_range))
    chunks: list[tuple[int, int]] = []
    current_from = int(start_block)
    final_block = int(end_block)
    while current_from <= final_block:
        current_to = min(current_from + chunk_size - 1, final_block)
        chunks.append((current_from, current_to))
        current_from = current_to + 1
    return chunks


def _process_backfill_tx(
    storage: BaseStorage,
    *,
    intents: list[dict[str, Any]],
    processed_keys: set[str],
    ledger: BalanceLedger,
    tx_hash: str,
    now: int,
) -> dict[str, Any]:
    """Repair fallback: process all deposit events discovered from a tx receipt."""
    tx_state = _get_confirmed_receipt_or_none(tx_hash)
    if tx_state is None or tx_state.get("failed") is True:
        return {
            "changedIntents": False,
            "changedLedger": False,
            "changedProcessed": False,
            "recovered": 0,
        }
    receipt_obj = tx_state.get("receipt")
    if receipt_obj is None:
        return {
            "changedIntents": False,
            "changedLedger": False,
            "changedProcessed": False,
            "recovered": 0,
        }

    changed_intents = False
    changed_ledger = False
    changed_processed = False
    recovered = 0
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
    return {
        "changedIntents": changed_intents,
        "changedLedger": changed_ledger,
        "changedProcessed": changed_processed,
        "recovered": recovered,
    }


def _process_backfill_event(
    storage: BaseStorage,
    *,
    intents: list[dict[str, Any]],
    processed_keys: set[str],
    ledger: BalanceLedger,
    tx_hash: str,
    event: dict[str, Any],
    now: int,
) -> dict[str, Any]:
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
        target_intent = _register_recovery_intent_if_atomic(
            storage, target_intent, owner_wallet, tx_hash
        )
        intents.append(target_intent)
        changed_intent = True
    else:
        changed_intent = False

    outcome = _process_single_intent(storage, target_intent, processed_keys, ledger, now)
    if changed_intent:
        outcome["changedIntent"] = True
    return outcome


def _process_backfill_range(
    storage: BaseStorage,
    start_block: int,
    end_block: int,
    now: int,
    *,
    mode: str = "event",
) -> dict[str, int]:
    """Scan a concrete range and persist recovered deposit state."""
    with lock:
        intents = _load_deposit_intents(storage)
        processed_keys = set(_load_processed_deposit_event_keys(storage))
        ledger = _load_balance_ledger(storage)
        changed_intents = False
        changed_ledger = False
        changed_processed = False
        recovered = 0
        processed_item_count = 0
        if mode == "repair":
            tx_hashes = _collect_router_candidate_tx_hashes(start_block, end_block)
            processed_item_count = len(tx_hashes)
            for tx_hash in tx_hashes:
                outcome = _process_backfill_tx(
                    storage,
                    intents=intents,
                    processed_keys=processed_keys,
                    ledger=ledger,
                    tx_hash=tx_hash,
                    now=now,
                )
                changed_intents = changed_intents or bool(outcome["changedIntents"])
                changed_ledger = changed_ledger or bool(outcome["changedLedger"])
                changed_processed = changed_processed or bool(outcome["changedProcessed"])
                recovered += int(outcome["recovered"])
        else:
            event_rows = _collect_deposit_event_rows(start_block, end_block)
            processed_item_count = len(event_rows)
            for event in event_rows:
                tx_hash = str(event.get("eventKey", "")).split(":", 1)[0]
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
    return {"itemCount": processed_item_count, "recovered": recovered}


def _persist_backfill_success(
    storage: BaseStorage, *, end_block: int, recovered: int, now: int
) -> None:
    """Persist successful backfill cursor and runtime status."""
    _save_backfill_state(storage, {"lastScannedBlock": end_block, "lastScanAt": now})
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


def run_backfill_scan_once(
    storage: BaseStorage, *, mode: str = "event"
) -> BackfillScanResult:
    """Scan confirmed deposit evidence and recover missed deposit credits."""
    if not bool(settings.v2_backfill_enabled):
        return BackfillScanResult(enabled=False)

    now = _now()
    state = _load_backfill_state(storage)
    confirmed_head = _confirmed_head_block()
    scan_range = _resolve_backfill_scan_range(state, confirmed_head)
    if scan_range is None:
        last_block = state.get("lastScannedBlock")
        return BackfillScanResult(
            enabled=True,
            last_scanned_block=int(last_block) if last_block is not None else None,
        )

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
        return BackfillScanResult(enabled=True, last_scanned_block=last_scanned)

    logger.info(
        "deposit backfill start start_block=%s end_block=%s last_scanned_block=%s confirmed_head=%s",
        start_block,
        end_block,
        last_scanned,
        confirmed_head,
    )

    scanned = 0
    recovered = 0
    event_count = 0
    for chunk_start, chunk_end in _iter_event_scan_chunks(start_block, end_block):
        outcome = _process_backfill_range(
            storage, chunk_start, chunk_end, now, mode=mode
        )
        scanned += max(0, chunk_end - chunk_start + 1)
        recovered += int(outcome["recovered"])
        event_count += int(outcome["itemCount"])
        _persist_backfill_success(
            storage,
            end_block=chunk_end,
            recovered=recovered,
            now=now,
        )
    logger.info(
        "deposit backfill done mode=%s start_block=%s end_block=%s scanned=%s items=%s recovered=%s",
        mode,
        start_block,
        end_block,
        scanned,
        event_count,
        recovered,
    )
    return BackfillScanResult(
        enabled=True,
        scanned=scanned,
        recovered=recovered,
        last_scanned_block=end_block,
    )
