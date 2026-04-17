"""Service health utility and persistence functions.

Extracted from service_health_service to keep each module under 500 lines.
Probe and monitor functions live in service_health_probe.py.
service_health_service.py re-exports everything so module-attribute access
patterns (``service_health_service.effective_runtime_status(...)``) continue
to work unchanged.
"""
from __future__ import annotations

import time
from typing import Any, List, Optional
from urllib.parse import urlsplit, urlunsplit

from src.core.config import settings
from src.domain.service_contract import (
    ServiceDefinitionRecord,
    ServiceHealthTargetRecord,
    ServiceInvokeTargetRecord,
    ServiceRuntimeHealthRecord,
)
from src.domain.registry import ServiceTargetHealth, ServiceTargetHealthHistory
from src.storage.base import BaseStorage

DEFAULT_HEALTH_PATH = "/health"
_last_health_history_prune_ms = 0


def _runtime_health(service: ServiceDefinitionRecord) -> ServiceRuntimeHealthRecord:
    if service.runtime_health is not None:
        return service.runtime_health
    return ServiceRuntimeHealthRecord()


def _target_health_map(service: ServiceDefinitionRecord) -> dict[str, ServiceHealthTargetRecord]:
    return {
        str(target.target_url): target
        for target in _runtime_health(service).targets
        if str(target.target_url or "").strip()
    }


def _now_ms() -> int:
    return int(time.time() * 1000)


def _normalize_health_path(path: str) -> str:
    value = str(path or DEFAULT_HEALTH_PATH).strip() or DEFAULT_HEALTH_PATH
    if not value.startswith("/"):
        value = f"/{value}"
    return value


def build_probe_url(target_url: str, health_path: str) -> str:
    parsed = urlsplit(str(target_url or "").strip())
    if not parsed.scheme or not parsed.netloc:
        raise ValueError("Invalid target URL")
    return urlunsplit(
        (parsed.scheme, parsed.netloc, _normalize_health_path(health_path), "", "")
    )


def _health_check_config(service: ServiceDefinitionRecord) -> dict[str, Any]:
    spec = service.health_check
    timeout_ms = int(spec.timeout_ms or settings.service_health_probe_timeout_ms)
    success_codes = list(spec.success_codes or [200])
    return {
        "path": _normalize_health_path(str(spec.path or DEFAULT_HEALTH_PATH)),
        "method": str(spec.method or "GET").upper(),
        "timeoutMs": max(200, timeout_ms),
        "successCodes": [int(code) for code in success_codes if str(code).isdigit()]
        or [200],
        "healthyThreshold": max(1, int(spec.healthy_threshold or 2)),
        "unhealthyThreshold": max(1, int(spec.unhealthy_threshold or 3)),
    }


def _service_targets(service: ServiceDefinitionRecord) -> List[ServiceInvokeTargetRecord]:
    return [target for target in service.invoke.targets if str(target.url or "").strip()]


def service_control_status(service: ServiceDefinitionRecord) -> str:
    status = str(service.status or "").strip().lower()
    if status == "paused":
        status = "inactive"
    elif status == "archived":
        status = "deleted"
    if not status:
        status = "active" if bool(service.is_active) else "inactive"
    if status == "active" and not bool(service.is_active):
        return "inactive"
    if status not in {"draft", "active", "inactive", "suspended", "deleted"}:
        return "inactive"
    return status


def is_service_probeable(service: ServiceDefinitionRecord) -> bool:
    lifecycle_status = service_control_status(service)
    if lifecycle_status == "active":
        return bool(service.is_active)
    return lifecycle_status == "suspended"


def public_health_summary(service: ServiceDefinitionRecord) -> dict[str, Any]:
    health = _runtime_health(service)
    raw_status = str(health.overall_status or "unknown")
    stale = is_health_stale(service)
    runtime_available = is_service_discoverable(service)
    health = _runtime_health(service)
    return {
        "overallStatus": effective_runtime_status(service),
        "probeStatus": raw_status,
        "healthyTargets": int(health.healthy_targets or 0),
        "totalTargets": int(health.total_targets or len(_service_targets(service))),
        "lastCheckedAt": health.last_checked_at,
        "isStale": stale,
        "runtimeAvailable": runtime_available,
    }


def public_discover_status(service: ServiceDefinitionRecord) -> str:
    return effective_runtime_status(service)


def is_health_stale(
    service: ServiceDefinitionRecord,
    now_ms: Optional[int] = None,
    stale_after_sec: Optional[int] = None,
) -> bool:
    now = int(now_ms if now_ms is not None else _now_ms())
    stale_sec = int(
        stale_after_sec
        if stale_after_sec is not None
        else settings.service_health_stale_after_sec
    )
    stale_after_ms = max(1000, stale_sec * 1000)
    last_checked = int(_runtime_health(service).last_checked_at or 0)
    return last_checked <= 0 or now - last_checked > stale_after_ms


def effective_runtime_status(
    service: ServiceDefinitionRecord,
    now_ms: Optional[int] = None,
    stale_after_sec: Optional[int] = None,
) -> str:
    lifecycle_status = service_control_status(service)
    if lifecycle_status != "active":
        return lifecycle_status
    if not bool(service.is_active):
        return "inactive"
    if is_health_stale(service, now_ms=now_ms, stale_after_sec=stale_after_sec):
        return "stale"

    healthy_target_urls = get_healthy_target_urls(
        service,
        now_ms=now_ms,
        stale_after_sec=stale_after_sec,
    )
    raw_status = str(_runtime_health(service).overall_status or "unknown").strip().lower()
    if healthy_target_urls:
        if raw_status in {"healthy", "degraded"}:
            return raw_status
        return "healthy"
    if raw_status in {"degraded", "unhealthy", "unknown", "pending"}:
        return raw_status
    return "unknown"


def get_healthy_target_urls(
    service: ServiceDefinitionRecord,
    now_ms: Optional[int] = None,
    stale_after_sec: Optional[int] = None,
) -> List[str]:
    if is_health_stale(service, now_ms=now_ms, stale_after_sec=stale_after_sec):
        return []

    target_health = _target_health_map(service)
    healthy_urls: List[str] = []
    for target in _service_targets(service):
        url = str(target.url or "").strip()
        row = target_health.get(url) or {}
        if str(getattr(row, "status", "") or "").lower() == "healthy":
            healthy_urls.append(url)
    return healthy_urls


def is_service_discoverable(service: ServiceDefinitionRecord) -> bool:
    if service_control_status(service) != "active":
        return False
    if not bool(service.is_active):
        return False
    return len(get_healthy_target_urls(service)) > 0


def _service_health_row(
    service: ServiceDefinitionRecord,
    target: ServiceInvokeTargetRecord,
    target_health: dict[str, ServiceHealthTargetRecord],
) -> Optional[ServiceTargetHealth]:
    service_id = str(service.service_id or "").strip()
    if not service_id:
        return None
    target_url = str(target.url or "").strip()
    if not target_url:
        return None

    row = target_health.get(target_url) or {}
    constraint_timeout_ms = int(getattr(service.constraints, "timeout_ms", None) or 15000)
    return ServiceTargetHealth(
        serviceId=service_id,
        ownerAddress=str(service.owner_address or "").strip(),
        targetUrl=target_url,
        weight=int(target.weight or 100),
        region=target.region,
        status=str(getattr(row, "status", None) or "unknown"),
        overallStatus=public_discover_status(service),
        httpStatus=getattr(row, "http_status", None),
        latencyMs=getattr(row, "latency_ms", None),
        consecutiveSuccesses=int(getattr(row, "consecutive_successes", 0) or 0),
        consecutiveFailures=int(getattr(row, "consecutive_failures", 0) or 0),
        probeUrl=getattr(row, "probe_url", None),
        lastCheckedAt=getattr(row, "last_checked_at", None),
        lastHealthyAt=getattr(row, "last_healthy_at", None),
        timeoutMs=max(300, min(60000, constraint_timeout_ms)),
        error=getattr(row, "error", None),
    )


def _build_service_target_health_rows(
    services: List[ServiceDefinitionRecord],
) -> List[ServiceTargetHealth]:
    rows: List[ServiceTargetHealth] = []
    for service in services:
        if service_control_status(service) == "deleted":
            continue
        target_health = _target_health_map(service)
        for target in _service_targets(service):
            next_row = _service_health_row(service, target, target_health)
            if next_row is not None:
                rows.append(next_row)
    return rows


def _empty_persisted_health_bucket() -> dict[str, Any]:
    return {
        "overallStatus": "unknown",
        "healthyTargets": 0,
        "totalTargets": 0,
        "lastCheckedAt": 0,
        "targets": {},
    }


def _target_health_payload(payload: dict[str, Any]) -> dict[str, Any]:
    row_last_checked = int(payload.get("lastCheckedAt") or 0)
    return {
        "status": str(payload.get("status") or "unknown"),
        "httpStatus": payload.get("httpStatus"),
        "latencyMs": payload.get("latencyMs"),
        "consecutiveSuccesses": int(payload.get("consecutiveSuccesses") or 0),
        "consecutiveFailures": int(payload.get("consecutiveFailures") or 0),
        "probeUrl": payload.get("probeUrl") or None,
        "lastCheckedAt": row_last_checked or None,
        "lastHealthyAt": payload.get("lastHealthyAt") or None,
        "error": payload.get("error") or None,
    }


def _persisted_target_record(
    target_url: str, target_payload: dict[str, Any]
) -> ServiceHealthTargetRecord:
    return ServiceHealthTargetRecord(
        targetUrl=str(target_url),
        status=str(target_payload.get("status") or "unknown"),
        weight=int(target_payload.get("weight") or 100),
        region=target_payload.get("region"),
        httpStatus=target_payload.get("httpStatus"),
        latencyMs=target_payload.get("latencyMs"),
        consecutiveSuccesses=int(target_payload.get("consecutiveSuccesses") or 0),
        consecutiveFailures=int(target_payload.get("consecutiveFailures") or 0),
        probeUrl=target_payload.get("probeUrl"),
        lastCheckedAt=target_payload.get("lastCheckedAt"),
        lastHealthyAt=target_payload.get("lastHealthyAt"),
        error=target_payload.get("error"),
    )


def _persisted_target_records(persisted: dict[str, Any]) -> List[ServiceHealthTargetRecord]:
    return [
        _persisted_target_record(str(target_url), dict(target_payload or {}))
        for target_url, target_payload in dict(persisted.get("targets") or {}).items()
    ]


def _merge_persisted_health_payload(
    index: dict[str, dict[str, Any]], row: ServiceTargetHealth
) -> None:
    service_id = str(row.service_id or "").strip()
    target_url = str(row.target_url or "").strip()
    if not service_id or not target_url:
        return

    bucket = index.setdefault(service_id, _empty_persisted_health_bucket())
    row_last_checked = int(row.last_checked_at or 0)
    bucket["targets"][target_url] = _target_health_payload(row.model_dump(by_alias=True))
    bucket["totalTargets"] = int(bucket.get("totalTargets") or 0) + 1
    if str(row.status or "").lower() == "healthy":
        bucket["healthyTargets"] = int(bucket.get("healthyTargets") or 0) + 1
    if row_last_checked > int(bucket.get("lastCheckedAt") or 0):
        bucket["lastCheckedAt"] = row_last_checked
    overall_status = str(row.overall_status or "").strip()
    if overall_status:
        bucket["overallStatus"] = overall_status


def _runtime_health_from_persisted_payload(persisted: dict[str, Any]) -> ServiceRuntimeHealthRecord:
    return ServiceRuntimeHealthRecord(
        overallStatus=str(persisted.get("overallStatus") or "unknown"),
        healthyTargets=int(persisted.get("healthyTargets") or 0),
        totalTargets=int(persisted.get("totalTargets") or 0),
        lastCheckedAt=persisted.get("lastCheckedAt") or None,
        targets=_persisted_target_records(persisted),
    )


def _seeded_service_health(
    service: ServiceDefinitionRecord, persisted: dict[str, Any] | None
) -> ServiceDefinitionRecord:
    if not persisted or _runtime_health(service).targets:
        return service
    return service.model_copy(
        update={"runtime_health": _runtime_health_from_persisted_payload(persisted)}
    )


def _load_persisted_target_health(storage: BaseStorage) -> dict[str, dict[str, Any]]:
    rows = storage.get_data_manager().system.registry.read_service_target_health_rows()
    if not isinstance(rows, list):
        return {}

    index: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, ServiceTargetHealth):
            continue
        _merge_persisted_health_payload(index, row)

    return index


def _seed_service_health_from_persisted_rows(
    storage: BaseStorage, services: List[ServiceDefinitionRecord]
) -> List[ServiceDefinitionRecord]:
    persisted_index = _load_persisted_target_health(storage)
    if not persisted_index:
        return services

    return [
        _seeded_service_health(
            service,
            persisted_index.get(str(service.service_id or "").strip()),
        )
        for service in services
    ]


def seed_service_health_from_persisted_rows(
    storage: BaseStorage, services: List[ServiceDefinitionRecord]
) -> List[ServiceDefinitionRecord]:
    return _seed_service_health_from_persisted_rows(storage, services)


def sync_service_target_health_table(
    storage: BaseStorage, services: Optional[List[ServiceDefinitionRecord]] = None
) -> int:
    if services is None:
        raw_rows = (
            storage.get_data_manager().system.registry.read_service_registry_rows()
        )
        if isinstance(raw_rows, list):
            services = [
                row
                for row in raw_rows
                if isinstance(row, ServiceDefinitionRecord)
            ]
        else:
            services = []
    rows = _build_service_target_health_rows(services)
    repo = storage.get_data_manager().system.registry
    repo.write_service_target_health_rows(rows)
    return len(rows)


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
) -> List[ServiceTargetHealthHistory]:
    service_id = str(service.service_id or "").strip()
    if not service_id:
        return []

    rows: List[ServiceTargetHealthHistory] = []
    target_health = _target_health_map(service)
    for target in _service_targets(service):
        target_url = str(target.url or "").strip()
        if not target_url:
            continue
        status_row = target_health.get(target_url)
        if not isinstance(status_row, ServiceHealthTargetRecord):
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
    global _last_health_history_prune_ms
    interval_ms = (
        max(30, int(settings.service_health_history_prune_interval_sec)) * 1000
    )
    if now_ms - _last_health_history_prune_ms < interval_ms:
        return False
    _last_health_history_prune_ms = now_ms
    return True


def prune_health_history(
    storage: BaseStorage, valid_service_ids: Optional[set[str]] = None
) -> dict[str, int]:
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
    return {"before": before, "after": after, "removed": max(0, before - after)}
