from __future__ import annotations

from typing import Any, Dict, List
from uuid import uuid4

from src.core.common import normalize_wallet
from src.domain.audit import AuditLogEntry
from src.domain.finance import BalanceLedger
from src.domain.ledger import DepositIntentRow
from src.storage import BaseStorage
from src.utils.datetime_utils import now_dt_str

from .shared import _now


def _load_deposit_intents(storage: BaseStorage) -> List[Dict[str, Any]]:
    """从存储层读取充值意图，并统一转换成 indexer 可变 dict。"""
    raw_rows = storage.get_data_manager().system.gateway_state.read_deposit_intents()
    if not isinstance(raw_rows, list):
        return []

    normalized: List[Dict[str, Any]] = []
    for row in raw_rows:
        if isinstance(row, DepositIntentRow):
            normalized.append(row.model_dump(by_alias=True, mode="json"))
        elif isinstance(row, dict):
            normalized.append(dict(row))
    return normalized


def _save_deposit_intents(storage: BaseStorage, rows: List[Dict[str, Any]]) -> None:
    """把充值意图刷回存储层。"""
    repo = storage.get_data_manager().system.gateway_state
    repo.write_deposit_intents(rows)


def _load_balance_ledger(storage: BaseStorage) -> BalanceLedger:
    """读取当前账本快照。"""
    return storage.get_data_manager().finance.balance.read_balance_ledger()


def _save_balance_ledger(storage: BaseStorage, ledger: BalanceLedger) -> None:
    """持久化账本快照，仅用于非原子存储实现的兜底路径。"""
    ledger.updated_at = now_dt_str()
    storage.get_data_manager().finance.balance.write_balance_ledger(ledger)


def _load_processed_deposit_event_keys(storage: BaseStorage) -> List[str]:
    """读取已处理过的链上 deposit eventKey，用于防重放。"""
    keys = (
        storage.get_data_manager().system.gateway_state.read_processed_deposit_event_keys()
    )
    return [str(item) for item in keys] if isinstance(keys, list) else []


def _save_processed_deposit_event_keys(storage: BaseStorage, keys: List[str]) -> None:
    """持久化 eventKey 去重集合。"""
    storage.get_data_manager().system.gateway_state.write_processed_deposit_event_keys(
        keys, now_dt_str()
    )


def _load_runtime_state(storage: BaseStorage, state_key: str) -> Dict[str, Any]:
    """读取指定 runtime state payload。"""
    raw = storage.get_data_manager().system.gateway_state.read_runtime_state(state_key)
    return dict(raw) if isinstance(raw, dict) else {}


def _save_runtime_state(
    storage: BaseStorage, state_key: str, payload: Dict[str, Any]
) -> None:
    """写入指定 runtime state payload。"""
    storage.get_data_manager().system.gateway_state.write_runtime_state(
        state_key, dict(payload)
    )


def _load_backfill_state(storage: BaseStorage) -> Dict[str, Any]:
    """读取 block backfill 的数据库游标状态。"""
    return _load_runtime_state(storage, "deposit_backfill_state")


def _save_backfill_state(storage: BaseStorage, state: Dict[str, Any]) -> None:
    """写入 block backfill 的数据库游标状态。"""
    payload = dict(state)
    payload["updatedAt"] = now_dt_str()
    _save_runtime_state(storage, "deposit_backfill_state", payload)


def _append_audit_log(
    storage: BaseStorage, action: str, owner_wallet: str, details: Dict[str, Any]
) -> None:
    """追加 indexer 相关审计事件。"""
    storage.get_data_manager().audit.logs.append_audit_row(
        AuditLogEntry(
            id=str(uuid4()),
            timestamp=_now(),
            action=action,
            owner_address=normalize_wallet(owner_wallet),
            details=details,
        )
    )