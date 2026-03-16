from __future__ import annotations

import logging
import time
from threading import Lock
from typing import Any, Dict, Optional

from web3 import Web3

from src.core.common import normalize_wallet
from src.core.config import settings

lock = Lock()
w3 = Web3(Web3.HTTPProvider(settings.rpc_url))
logger = logging.getLogger("src.services.platform.tasks.deposit_indexer")

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

TRANSFER_TOPIC = Web3.to_hex(
    Web3.keccak(text="Transfer(address,address,uint256)")
).lower()
TOKEN_DECIMALS_CACHE: Dict[str, int] = {}


def _set_status(**kwargs: Any) -> None:
    """更新 indexer 对外可见的内存状态快照。"""
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
    """生成对外暴露的状态副本，避免把内部异常原样泄露出去。"""
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
        reconciliation.get("lastError"), _RECONCILIATION_ERROR_CODE
    )

    snapshot["backfill"] = backfill
    snapshot["reconciliation"] = reconciliation
    return snapshot


def get_indexer_status() -> Dict[str, Any]:
    """返回前端/管理端可读取的 indexer 运行状态。"""
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


def _now() -> int:
    """返回当前 Unix 秒级时间戳。"""
    return int(time.time())