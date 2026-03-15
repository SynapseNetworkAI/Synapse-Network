import asyncio
import logging
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit, urlunsplit

import httpx

from src.core.config import settings
from src.storage.base import BaseStorage

logger = logging.getLogger(__name__)

DEFAULT_HEALTH_PATH = "/health"
_last_health_history_prune_ms = 0


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
    return urlunsplit((parsed.scheme, parsed.netloc, _normalize_health_path(health_path), "", ""))


def _health_check_config(service: Dict[str, Any]) -> Dict[str, Any]:
    spec = service.get("healthCheck") if isinstance(service.get("healthCheck"), dict) else {}
    timeout_ms = int(spec.get("timeoutMs") or settings.service_health_probe_timeout_ms)
    success_codes = spec.get("successCodes") if isinstance(spec.get("successCodes"), list) else [200]
    return {
        "path": _normalize_health_path(str(spec.get("path") or DEFAULT_HEALTH_PATH)),
        "method": str(spec.get("method") or "GET").upper(),
        "timeoutMs": max(200, timeout_ms),
        "successCodes": [int(code) for code in success_codes if str(code).isdigit()] or [200],
        "healthyThreshold": max(1, int(spec.get("healthyThreshold") or 2)),
        "unhealthyThreshold": max(1, int(spec.get("unhealthyThreshold") or 3)),
    }


def _target_health_map(service: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    health = service.get("serviceHealth") if isinstance(service.get("serviceHealth"), dict) else {}
    targets = health.get("targets") if isinstance(health.get("targets"), dict) else {}
    normalized: Dict[str, Dict[str, Any]] = {}
    for url, row in targets.items():
        if not isinstance(row, dict):
            continue
        normalized[str(url)] = row
    return normalized


def _service_targets(service: Dict[str, Any]) -> List[Dict[str, Any]]:
    invoke = service.get("invoke") if isinstance(service.get("invoke"), dict) else {}
    targets = invoke.get("targets") if isinstance(invoke.get("targets"), list) else []
    normalized: List[Dict[str, Any]] = []
    for target in targets:
        if not isinstance(target, dict):
            continue
        url = str(target.get("url") or "").strip()
        if not url:
            continue
        normalized.append(target)
    return normalized


def public_health_summary(service: Dict[str, Any]) -> Dict[str, Any]:
    health = service.get("serviceHealth") if isinstance(service.get("serviceHealth"), dict) else {}
    return {
        "overallStatus": str(health.get("overallStatus") or "unknown"),
        "healthyTargets": int(health.get("healthyTargets") or 0),
        "totalTargets": int(health.get("totalTargets") or len(_service_targets(service))),
        "lastCheckedAt": health.get("lastCheckedAt"),
    }


def public_discover_status(service: Dict[str, Any]) -> str:
    return str(public_health_summary(service).get("overallStatus") or "unknown")


def get_healthy_target_urls(
    service: Dict[str, Any],
    now_ms: Optional[int] = None,
    stale_after_sec: Optional[int] = None,
) -> List[str]:
    now = int(now_ms if now_ms is not None else _now_ms())
    stale_sec = int(stale_after_sec if stale_after_sec is not None else settings.service_health_stale_after_sec)
    stale_after_ms = max(1000, stale_sec * 1000)

    health = service.get("serviceHealth") if isinstance(service.get("serviceHealth"), dict) else {}
    last_checked = int(health.get("lastCheckedAt") or 0)
    if last_checked <= 0 or now - last_checked > stale_after_ms:
        return []

    target_health = _target_health_map(service)
    healthy_urls: List[str] = []
    for target in _service_targets(service):
        url = str(target.get("url") or "").strip()
        row = target_health.get(url) or {}
        if str(row.get("status") or "").lower() == "healthy":
            healthy_urls.append(url)
    return healthy_urls


def is_service_discoverable(service: Dict[str, Any]) -> bool:
    if not bool(service.get("isActive", False)):
        return False
    if str(service.get("status") or "active").lower() != "active":
        return False
    return len(get_healthy_target_urls(service)) > 0


def _service_health_row(service: Dict[str, Any], target: Dict[str, Any], target_health: Dict[str, Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    service_id = str(service.get("serviceId") or "").strip()
    if not service_id:
        return None
    target_url = str(target.get("url") or "").strip()
    if not target_url:
        return None

    row = target_health.get(target_url) or {}
    return {
        "serviceId": service_id,
        "ownerAddress": str(service.get("ownerAddress") or "").strip(),
        "targetUrl": target_url,
        "weight": int(target.get("weight") or 100),
        "region": target.get("region"),
        "status": str(row.get("status") or "unknown"),
        "overallStatus": public_discover_status(service),
        "httpStatus": row.get("httpStatus"),
        "latencyMs": row.get("latencyMs"),
        "consecutiveSuccesses": int(row.get("consecutiveSuccesses") or 0),
        "consecutiveFailures": int(row.get("consecutiveFailures") or 0),
        "probeUrl": row.get("probeUrl") or None,
        "lastCheckedAt": row.get("lastCheckedAt") or None,
        "lastHealthyAt": row.get("lastHealthyAt") or None,
        "error": row.get("error") or None,
    }


def _build_service_target_health_rows(services: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for service in services:
        if not isinstance(service, dict):
            continue
        target_health = _target_health_map(service)
        for target in _service_targets(service):
            next_row = _service_health_row(service, target, target_health)
            if next_row is not None:
                rows.append(next_row)
    return rows


def sync_service_target_health_table(storage: BaseStorage, services: Optional[List[Dict[str, Any]]] = None) -> int:
    if services is None:
        raw_rows = storage.get_data_manager().system.registry.read_service_registry_rows()
        services = [row for row in raw_rows if isinstance(row, dict)] if isinstance(raw_rows, list) else []
    rows = _build_service_target_health_rows(services)
    storage.get_data_manager().system.registry.write_service_target_health_rows(rows)
    return len(rows)


def _history_row_from_target(service: Dict[str, Any], target_url: str, target_status: Dict[str, Any]) -> Dict[str, Any]:
    checked_at = int(target_status.get("lastCheckedAt") or _now_ms())
    return {
        "serviceId": str(service.get("serviceId") or "").strip(),
        "ownerAddress": str(service.get("ownerAddress") or "").strip(),
        "targetUrl": target_url,
        "status": str(target_status.get("status") or "unknown"),
        "httpStatus": target_status.get("httpStatus"),
        "latencyMs": target_status.get("latencyMs"),
        "probeUrl": target_status.get("probeUrl") or None,
        "consecutiveSuccesses": int(target_status.get("consecutiveSuccesses") or 0),
        "consecutiveFailures": int(target_status.get("consecutiveFailures") or 0),
        "checkedAt": checked_at,
        "lastHealthyAt": target_status.get("lastHealthyAt") or None,
        "error": target_status.get("error") or None,
    }


def build_probe_history_rows(service: Dict[str, Any]) -> List[Dict[str, Any]]:
    service_id = str(service.get("serviceId") or "").strip()
    if not service_id:
        return []

    rows: List[Dict[str, Any]] = []
    target_health = _target_health_map(service)
    for target in _service_targets(service):
        target_url = str(target.get("url") or "").strip()
        if not target_url:
            continue
        status_row = target_health.get(target_url)
        if not isinstance(status_row, dict):
            continue
        rows.append(_history_row_from_target(service, target_url, status_row))
    return rows


def append_health_history_rows(storage: BaseStorage, rows: List[Dict[str, Any]]) -> int:
    if not rows:
        return 0
    raw_rows = storage.get_data_manager().system.registry.read_service_target_health_history_rows()
    existing = [row for row in raw_rows if isinstance(row, dict)] if isinstance(raw_rows, list) else []
    existing.extend(rows)
    storage.get_data_manager().system.registry.write_service_target_health_history_rows(existing)
    return len(rows)


def _current_valid_service_ids(storage: BaseStorage) -> set[str]:
    raw_rows = storage.get_data_manager().system.registry.read_service_registry_rows()
    services = [row for row in raw_rows if isinstance(row, dict)] if isinstance(raw_rows, list) else []
    return {
        str(row.get("serviceId") or "").strip()
        for row in services
        if isinstance(row, dict) and str(row.get("serviceId") or "").strip()
    }


def _history_row_kept(row: Dict[str, Any], valid_ids: set[str], cutoff_ms: int) -> bool:
    service_id = str(row.get("serviceId") or "").strip()
    if not service_id or service_id not in valid_ids:
        return False
    checked_at = int(row.get("checkedAt") or 0)
    return checked_at >= cutoff_ms


def _history_cutoff_ms() -> int:
    retention_hours = max(1, int(settings.service_health_history_retention_hours))
    return _now_ms() - (retention_hours * 60 * 60 * 1000)


def _should_prune_history(now_ms: int) -> bool:
    global _last_health_history_prune_ms
    interval_ms = max(30, int(settings.service_health_history_prune_interval_sec)) * 1000
    if now_ms - _last_health_history_prune_ms < interval_ms:
        return False
    _last_health_history_prune_ms = now_ms
    return True


def prune_health_history(storage: BaseStorage, valid_service_ids: Optional[set[str]] = None) -> Dict[str, int]:
    raw_rows = storage.get_data_manager().system.registry.read_service_target_health_history_rows()
    existing = [row for row in raw_rows if isinstance(row, dict)] if isinstance(raw_rows, list) else []

    cutoff_ms = _history_cutoff_ms()
    valid_ids = valid_service_ids if valid_service_ids is not None else _current_valid_service_ids(storage)

    before = len(existing)
    filtered = [row for row in existing if isinstance(row, dict) and _history_row_kept(row, valid_ids, cutoff_ms)]

    after = len(filtered)
    if after != before:
        storage.get_data_manager().system.registry.write_service_target_health_history_rows(filtered)
    return {"before": before, "after": after, "removed": max(0, before - after)}


async def _probe_target(
    client: httpx.AsyncClient,
    probe_url: str,
    method: str,
    timeout_sec: float,
    success_codes: List[int],
) -> Dict[str, Any]:
    started = time.perf_counter()
    http_status = None
    error = None
    healthy = False

    try:
        response = await client.request(method, probe_url, timeout=timeout_sec)
        http_status = int(response.status_code)
        healthy = http_status in success_codes
    except Exception as exc:
        error = str(exc)

    latency_ms = int((time.perf_counter() - started) * 1000)
    return {
        "healthy": healthy,
        "httpStatus": http_status,
        "latencyMs": latency_ms,
        "error": error,
    }


def _merge_target_health(
    previous: Dict[str, Any],
    probe: Dict[str, Any],
    checked_at_ms: int,
    healthy_threshold: int,
    unhealthy_threshold: int,
    probe_url: str,
) -> Dict[str, Any]:
    prev_success = int(previous.get("consecutiveSuccesses") or 0)
    prev_failure = int(previous.get("consecutiveFailures") or 0)

    if bool(probe.get("healthy")):
        success = prev_success + 1
        failure = 0
        if success >= healthy_threshold:
            status = "healthy"
        else:
            status = str(previous.get("status") or "unknown")
        last_healthy_at = checked_at_ms
    else:
        success = 0
        failure = prev_failure + 1
        if failure >= unhealthy_threshold:
            status = "unhealthy"
        else:
            status = "degraded"
        last_healthy_at = previous.get("lastHealthyAt")

    return {
        "status": status,
        "probeUrl": probe_url,
        "httpStatus": probe.get("httpStatus"),
        "latencyMs": int(probe.get("latencyMs") or 0),
        "lastCheckedAt": checked_at_ms,
        "lastHealthyAt": last_healthy_at,
        "consecutiveSuccesses": success,
        "consecutiveFailures": failure,
        "error": probe.get("error"),
    }


async def probe_service_health(service: Dict[str, Any], client: Optional[httpx.AsyncClient] = None) -> Dict[str, Any]:
    targets = _service_targets(service)
    if not targets:
        updated = dict(service)
        updated["serviceHealth"] = {
            "overallStatus": "unhealthy",
            "healthyTargets": 0,
            "totalTargets": 0,
            "lastCheckedAt": _now_ms(),
            "targets": {},
        }
        return updated

    health_spec = _health_check_config(service)
    target_health = _target_health_map(service)
    timeout_sec = float(health_spec["timeoutMs"]) / 1000.0
    checked_at_ms = _now_ms()

    owns_client = client is None
    async_client = client
    if async_client is None:
        async_client = httpx.AsyncClient()

    try:
        next_target_health: Dict[str, Dict[str, Any]] = {}
        for target in targets:
            url = str(target.get("url") or "").strip()
            previous = target_health.get(url) or {}
            try:
                probe_url = build_probe_url(url, health_spec["path"])
                probe = await _probe_target(
                    async_client,
                    probe_url,
                    health_spec["method"],
                    timeout_sec,
                    health_spec["successCodes"],
                )
            except Exception as exc:
                probe_url = ""
                probe = {
                    "healthy": False,
                    "httpStatus": None,
                    "latencyMs": 0,
                    "error": str(exc),
                }

            next_target_health[url] = _merge_target_health(
                previous,
                probe,
                checked_at_ms,
                int(health_spec["healthyThreshold"]),
                int(health_spec["unhealthyThreshold"]),
                probe_url,
            )

        healthy_targets = len([row for row in next_target_health.values() if str(row.get("status") or "") == "healthy"])
        total_targets = len(targets)
        if healthy_targets == 0:
            overall = "unhealthy"
        elif healthy_targets < total_targets:
            overall = "degraded"
        else:
            overall = "healthy"

        updated = dict(service)
        updated["serviceHealth"] = {
            "overallStatus": overall,
            "healthyTargets": healthy_targets,
            "totalTargets": total_targets,
            "lastCheckedAt": checked_at_ms,
            "targets": next_target_health,
        }
        return updated
    finally:
        if owns_client and async_client is not None:
            await async_client.aclose()


async def refresh_all_service_health(storage: BaseStorage) -> Dict[str, int]:
    raw_rows = storage.get_data_manager().system.registry.read_service_registry_rows()
    rows = [row for row in raw_rows if isinstance(row, dict)] if isinstance(raw_rows, list) else []

    checked = 0
    updated = 0
    appended_history = 0
    next_rows: List[Dict[str, Any]] = []

    async with httpx.AsyncClient() as client:
        for row in rows:
            if not isinstance(row, dict) or not bool(row.get("isActive", False)):
                next_rows.append(row)
                continue

            checked += 1
            next_row = await probe_service_health(row, client=client)
            if next_row != row:
                updated += 1
            if settings.service_health_history_enabled:
                history_rows = build_probe_history_rows(next_row)
                appended_history += append_health_history_rows(storage, history_rows)
            next_rows.append(next_row)

    if updated > 0:
        storage.get_data_manager().system.registry.write_service_registry_rows(next_rows)

    synced_rows = sync_service_target_health_table(storage, next_rows)
    valid_service_ids = {
        str(row.get("serviceId") or "").strip()
        for row in next_rows
        if isinstance(row, dict) and str(row.get("serviceId") or "").strip()
    }
    now_ms = _now_ms()
    if _should_prune_history(now_ms):
        prune_stats = prune_health_history(storage, valid_service_ids=valid_service_ids)
    else:
        prune_stats = {"before": 0, "after": 0, "removed": 0}

    return {
        "checked": checked,
        "updated": updated,
        "syncedRows": synced_rows,
        "historyAppended": appended_history,
        "historyPruned": int(prune_stats.get("removed") or 0),
    }


async def run_service_health_monitor(stop_event: asyncio.Event, storage: BaseStorage) -> None:
    interval = max(1.0, float(settings.service_health_probe_interval_sec))
    logger.info("Service health monitor started: interval=%ss", interval)

    while not stop_event.is_set():
        try:
            result = await refresh_all_service_health(storage)
            logger.debug(
                "Service health monitor tick: checked=%s updated=%s",
                result.get("checked"),
                result.get("updated"),
            )
        except Exception as exc:
            logger.warning("Service health monitor tick failed: %s", exc)

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
        except asyncio.TimeoutError:
            pass

    logger.info("Service health monitor stopped")
