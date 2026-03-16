"""兼容入口：保留旧模块路径，真实实现迁移到 tasks.deposit_indexer。"""

from src.core.config import settings
from src.services.platform.tasks.deposit_indexer import (
    _apply_confirmed_balance_to_ledger,
    _hydrate_runtime_status,
    _process_single_intent,
    _resolve_backfill_scan_range,
    get_indexer_status,
    process_pending_deposit_intents_once,
    replay_deposit_tx,
    run_backfill_scan_once,
    run_v2_deposit_indexer,
)

__all__ = [
    "settings",
    "get_indexer_status",
    "run_v2_deposit_indexer",
    "replay_deposit_tx",
    "process_pending_deposit_intents_once",
    "run_backfill_scan_once",
    "_process_single_intent",
    "_apply_confirmed_balance_to_ledger",
    "_resolve_backfill_scan_range",
    "_hydrate_runtime_status",
]