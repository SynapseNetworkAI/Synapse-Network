import asyncio
import logging
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit, urlunsplit

import httpx

from src.core.config import settings
from src.domain.registry import ServiceTargetHealth, ServiceTargetHealthHistory
from src.domain.storage_entities import ServiceRegistryRow
from src.storage.base import BaseStorage

logger = logging.getLogger(__name__)

DEFAULT_HEALTH_PATH = "/health"
_last_health_history_prune_ms = 0


def _service_entity_to_dict(row: ServiceRegistryRow) -> Dict[str, Any]:
    payload = row.model_dump(by_alias=True, mode="json")
    payload["pricing"] = {
        "amount": str(payload.get("pricingAmount") or "0"),
        "currency": str(payload.get("pricingCurrency") or "USDC"),
    }
    payload["constraints"] = {
        "timeoutMs": int(payload.get("timeoutMs") or settings.gateway_default_timeout_ms),
        "maxQps": int(payload.get("maxQps") or settings.gateway_default_service_qps),
        "maxRequestBytes": int(payload.get("maxRequestBytes") or settings.gateway_default_request_bytes),
        "maxResponseBytes": int(payload.get("maxResponseBytes") or settings.gateway_default_response_bytes),
    }
    endpoint = str(payload.get("endpoint") or "").strip()
    payload.setdefault(
        "invoke",
        {
            "method": "POST",
            "targets": ([{"url": endpoint, "weight": 100}] if endpoint else []),
            "timeoutMs": int(payload["constraints"]["timeoutMs"]),
            "request": {},
            "response": {},
            "headersTemplate": {},
            "examples": [],
        },
    )
    return payload


def _service_dict_to_entity(service: Dict[str, Any]) -> ServiceRegistryRow:
    pricing = service.get("pricing") if isinstance(service.get("pricing"), dict) else {}
    constraints = service.get("constraints") if isinstance(service.get("constraints"), dict) else {}
    invoke = service.get("invoke") if isinstance(service.get("invoke"), dict) else {}
    targets = invoke.get("targets") if isinstance(invoke.get("targets"), list) else []
    endpoint = str(service.get("endpoint") or "").strip()
    if not endpoint and targets and isinstance(targets[0], dict):
        endpoint = str(targets[0].get("url") or "").strip()
    return ServiceRegistryRow(
        serviceId=str(service.get("serviceId") or "").strip(),
        ownerAddress=str(service.get("ownerAddress") or "").lower(),
        serviceName=str(service.get("serviceName") or ""),
        summary=str(service.get("summary") or ""),
        endpoint=endpoint or None,
        status=str(service.get("status") or "active"),
        isActive=bool(service.get("isActive", True)),
        pricingAmount=str(pricing.get("amount") or 0),
        pricingCurrency=str(pricing.get("currency") or "USDC"),
        timeoutMs=int(constraints.get("timeoutMs") or service.get("timeoutMs") or settings.gateway_default_timeout_ms),
        maxQps=int(constraints.get("maxQps") or service.get("maxQps") or settings.gateway_default_service_qps),
        maxRequestBytes=int(constraints.get("maxRequestBytes") or service.get("maxRequestBytes") or settings.gateway_default_request_bytes),
        maxResponseBytes=int(constraints.get("maxResponseBytes") or service.get("maxResponseBytes") or settings.gateway_default_response_bytes),
        id=str(service.get("id") or "") or None,
        schemaVersion=int(service.get("schemaVersion")) if service.get("schemaVersion") is not None else None,
        role=str(service.get("role") or "") or None,
        address=str(service.get("address") or "") or None,
        tags=[str(tag) for tag in (service.get("tags") or []) if isinstance(tag, (str, int, float))],
        auth=dict(service.get("auth") or {}),
        healthCheck=dict(service.get("healthCheck") or {}),
        forwarding=dict(service.get("forwarding") or {}),
        metering=dict(service.get("metering") or {}),
        invoke=dict(service.get("invoke") or {}),
        createdAt=int(service.get("createdAt") or 0),
        updatedAt=int(service.get("updatedAt") or 0),
    )


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


def _load_persisted_target_health(storage: BaseStorage) -> Dict[str, Dict[str, Any]]:
    rows = storage.get_data_manager().system.registry.read_service_target_health_rows()
    if not isinstance(rows, list):
        return {}

    index: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        payload = row.model_dump(by_alias=True) if isinstance(row, ServiceTargetHealth) else row
        if not isinstance(payload, dict):
            continue
        service_id = str(payload.get("serviceId") or "").strip()
        target_url = str(payload.get("targetUrl") or "").strip()
        if not service_id or not target_url:
            continue

        bucket = index.setdefault(
            service_id,
            {
                "overallStatus": "unknown",
                "healthyTargets": 0,
                "totalTargets": 0,
                "lastCheckedAt": 0,
                "targets": {},
            },
        )

        row_last_checked = int(payload.get("lastCheckedAt") or 0)
        bucket["targets"][target_url] = {
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

        bucket["totalTargets"] = int(bucket.get("totalTargets") or 0) + 1
        if str(payload.get("status") or "").lower() == "healthy":
            bucket["healthyTargets"] = int(bucket.get("healthyTargets") or 0) + 1
        if row_last_checked > int(bucket.get("lastCheckedAt") or 0):
            bucket["lastCheckedAt"] = row_last_checked

        overall_status = str(payload.get("overallStatus") or "").strip()
        if overall_status:
            bucket["overallStatus"] = overall_status

    return index


def _seed_service_health_from_persisted_rows(storage: BaseStorage, services: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    persisted_index = _load_persisted_target_health(storage)
    if not persisted_index:
        return services

    seeded: List[Dict[str, Any]] = []
    for service in services:
        if not isinstance(service, dict):
            seeded.append(service)
            continue
        service_id = str(service.get("serviceId") or "").strip()
        if not service_id:
            seeded.append(service)
            continue
        current_health = service.get("serviceHealth") if isinstance(service.get("serviceHealth"), dict) else {}
        current_targets = current_health.get("targets") if isinstance(current_health.get("targets"), dict) else {}
        if current_targets:
            seeded.append(service)
            continue

        persisted = persisted_index.get(service_id)
        if not isinstance(persisted, dict):
            seeded.append(service)
            continue

        next_service = dict(service)
        next_service["serviceHealth"] = {
            "overallStatus": str(persisted.get("overallStatus") or "unknown"),
            "healthyTargets": int(persisted.get("healthyTargets") or 0),
            "totalTargets": int(persisted.get("totalTargets") or 0),
            "lastCheckedAt": persisted.get("lastCheckedAt") or None,
            "targets": dict(persisted.get("targets") or {}),
        }
        seeded.append(next_service)
    return seeded


def sync_service_target_health_table(storage: BaseStorage, services: Optional[List[Dict[str, Any]]] = None) -> int:
    if services is None:
        raw_rows = storage.get_data_manager().system.registry.read_service_registry_rows()
        if isinstance(raw_rows, list):
            services = [
                _service_entity_to_dict(row) if isinstance(row, ServiceRegistryRow) else row
                for row in raw_rows
                if isinstance(row, (ServiceRegistryRow, dict))
            ]
        else:
            services = []
    rows = _build_service_target_health_rows(services)
    typed_rows = [ServiceTargetHealth.model_validate(row) for row in rows if isinstance(row, dict)]
    repo = storage.get_data_manager().system.registry
    try:
        repo.write_service_target_health_rows(typed_rows)
    except Exception:
        repo.write_service_target_health_rows(rows)
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
    existing: list = list(storage.get_data_manager().system.registry.read_service_target_health_history_rows())
    existing.extend(ServiceTargetHealthHistory.model_validate(row) for row in rows if isinstance(row, dict))
    repo = storage.get_data_manager().system.registry
    try:
        repo.write_service_target_health_history_rows(existing)
    except Exception:
        repo.write_service_target_health_history_rows(rows)
    return len(rows)


def _current_valid_service_ids(storage: BaseStorage) -> set[str]:
    raw_rows = storage.get_data_manager().system.registry.read_service_registry_rows()
    if isinstance(raw_rows, list):
        services = [
            _service_entity_to_dict(row) if isinstance(row, ServiceRegistryRow) else row
            for row in raw_rows
            if isinstance(row, (ServiceRegistryRow, dict))
        ]
    else:
        services = []
    return {
        str(row.get("serviceId") or "").strip()
        for row in services
        if isinstance(row, dict) and str(row.get("serviceId") or "").strip()
    }


def _history_row_kept(row: Any, valid_ids: set[str], cutoff_ms: int) -> bool:
    if isinstance(row, ServiceTargetHealthHistory):
        service_id = str(row.service_id or "").strip()
        checked_at = int(row.checked_at or 0)
    elif isinstance(row, dict):
        service_id = str(row.get("serviceId") or "").strip()
        checked_at = int(row.get("checkedAt") or 0)
    else:
        return False
    if not service_id or service_id not in valid_ids:
        return False
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
    existing: list = list(storage.get_data_manager().system.registry.read_service_target_health_history_rows())

    cutoff_ms = _history_cutoff_ms()
    valid_ids = valid_service_ids if valid_service_ids is not None else _current_valid_service_ids(storage)

    before = len(existing)
    filtered = [row for row in existing if _history_row_kept(row, valid_ids, cutoff_ms)]

    after = len(filtered)
    if after != before:
        repo = storage.get_data_manager().system.registry
        try:
            repo.write_service_target_health_history_rows(filtered)
        except Exception:
            repo.write_service_target_health_history_rows([row for row in filtered if isinstance(row, dict)])
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
    if isinstance(raw_rows, list):
        rows = [
            _service_entity_to_dict(row) if isinstance(row, ServiceRegistryRow) else row
            for row in raw_rows
            if isinstance(row, (ServiceRegistryRow, dict))
        ]
    else:
        rows = []

    rows = _seed_service_health_from_persisted_rows(storage, rows)

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
        repo = storage.get_data_manager().system.registry
        try:
            repo.write_service_registry_rows([_service_dict_to_entity(row) for row in next_rows])
        except Exception:
            repo.write_service_registry_rows(next_rows)

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
