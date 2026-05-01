"""Service health history append and pruning helpers."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, List, Optional

from src.core.config import settings
from src.domain.registry import ServiceTargetHealthHistory
from src.domain.service_contract import ServiceDefinitionRecord, ServiceHealthTargetRecord
from src.storage.base import BaseStorage
from src.services.platform.service_health_utils import (
    _now_ms,
    _service_targets,
    _target_health_map,
)

_health_history_prune_state = {"last_ms": 0}


@dataclass(frozen=True)
class HealthHistoryPruneStats:
    before: int
    after: int
    removed: int


def _history_row_from_target(
    service: ServiceDefinitionRecord,
    target_url: str,
    target_status: ServiceHealthTargetRecord,
) -> dict[str, Any]:
    checked_at = int(target_status.last_checked_at or _now_ms())
    return {
        "serviceId": str(service.service_id or "").strip(),
        "ownerAddress": str(service.owner_address or "").strip(),
        "targetUrl": target_url,
        "status": str(target_status.status or "unknown"),
        "httpStatus": target_status.http_status,
        "latencyMs": target_status.latency_ms,
        "probeUrl": target_status.probe_url or None,
        "consecutiveSuccesses": int(target_status.consecutive_successes or 0),
        "consecutiveFailures": int(target_status.consecutive_failures or 0),
        "checkedAt": checked_at,
        "lastHealthyAt": target_status.last_healthy_at or None,
        "error": target_status.error or None,
    }


def build_probe_history_rows(
    service: ServiceDefinitionRecord,
    previous_service: ServiceDefinitionRecord | None = None,
) -> List[ServiceTargetHealthHistory]:
    service_id = str(service.service_id or "").strip()
    if not service_id:
        return []

    rows: List[ServiceTargetHealthHistory] = []
    target_health = _target_health_map(service)
    previous_target_health = (
        _target_health_map(previous_service) if previous_service is not None else {}
    )
    for target in _service_targets(service):
        target_url = str(target.url or "").strip()
        if not target_url:
            continue
        status_row = target_health.get(target_url)
        if not isinstance(status_row, ServiceHealthTargetRecord):
            continue
        previous_status = str(
            getattr(previous_target_health.get(target_url), "status", "") or ""
        ).lower()
        current_status = str(status_row.status or "unknown").lower()
        if previous_service is not None and previous_status == current_status:
            continue
        rows.append(
            ServiceTargetHealthHistory.model_validate(
                _history_row_from_target(service, target_url, status_row)
            )
        )
    return rows


def append_health_history_rows(
    storage: BaseStorage, rows: List[ServiceTargetHealthHistory]
) -> int:
    if not rows:
        return 0
    existing: list[ServiceTargetHealthHistory] = list(
        storage.get_data_manager().system.registry.read_service_target_health_history_rows()
    )
    existing.extend(rows)
    repo = storage.get_data_manager().system.registry
    repo.write_service_target_health_history_rows(existing)
    return len(rows)


def _current_valid_service_ids(storage: BaseStorage) -> set[str]:
    raw_rows = storage.get_data_manager().system.registry.read_service_registry_rows()
    if isinstance(raw_rows, list):
        services = [
            row
            for row in raw_rows
            if isinstance(row, ServiceDefinitionRecord)
        ]
    else:
        services = []
    return {
        str(row.service_id or "").strip()
        for row in services
        if str(row.service_id or "").strip()
    }


def _history_row_kept(
    row: ServiceTargetHealthHistory, valid_ids: set[str], cutoff_ms: int
) -> bool:
    service_id = str(row.service_id or "").strip()
    checked_at = int(row.checked_at or 0)
    if not service_id or service_id not in valid_ids:
        return False
    return checked_at >= cutoff_ms


def _history_cutoff_ms() -> int:
    retention_hours = max(1, int(settings.service_health_history_retention_hours))
    return _now_ms() - (retention_hours * 60 * 60 * 1000)


def _should_prune_history(now_ms: int) -> bool:
    interval_ms = (
        max(30, int(settings.service_health_history_prune_interval_sec)) * 1000
    )
    if now_ms - int(_health_history_prune_state.get("last_ms") or 0) < interval_ms:
        return False
    _health_history_prune_state["last_ms"] = now_ms
    return True


def prune_health_history(
    storage: BaseStorage, valid_service_ids: Optional[set[str]] = None
) -> HealthHistoryPruneStats:
    existing: list[ServiceTargetHealthHistory] = list(
        storage.get_data_manager().system.registry.read_service_target_health_history_rows()
    )

    cutoff_ms = _history_cutoff_ms()
    valid_ids = (
        valid_service_ids
        if valid_service_ids is not None
        else _current_valid_service_ids(storage)
    )

    before = len(existing)
    filtered = [row for row in existing if _history_row_kept(row, valid_ids, cutoff_ms)]

    after = len(filtered)
    if after != before:
        repo = storage.get_data_manager().system.registry
        repo.write_service_target_health_history_rows(filtered)
    return HealthHistoryPruneStats(
        before=before,
        after=after,
        removed=max(0, before - after),
    )
