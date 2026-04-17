"""Service health probe and monitor functions.

Extracted from service_health_service to keep each module under 500 lines.
Utility and persistence functions live in service_health_utils.py.
service_health_service.py re-exports everything so module-attribute access
patterns continue to work unchanged.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, List, Optional

import httpx

from src.core.config import settings
from src.domain.service_contract import (
    ServiceDefinitionRecord,
    ServiceHealthTargetRecord,
    ServiceInvokeTargetRecord,
    ServiceRuntimeHealthRecord,
)
from src.storage.base import BaseStorage
from src.services.platform.service_health_utils import (
    _health_check_config,
    _now_ms,
    _seed_service_health_from_persisted_rows,
    _service_targets,
    _should_prune_history,
    _target_health_map,
    append_health_history_rows,
    build_probe_history_rows,
    build_probe_url,
    is_service_probeable,
    prune_health_history,
    sync_service_target_health_table,
)
from src.services.analytics.gateway_events import (
    emit_provider_health_degraded,
    emit_provider_health_outage,
    emit_provider_health_recovered,
)

logger = logging.getLogger(__name__)


async def _probe_target(
    client: httpx.AsyncClient,
    probe_url: str,
    method: str,
    timeout_sec: float,
    success_codes: List[int],
) -> dict[str, Any]:
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
    previous: ServiceHealthTargetRecord | None,
    target: ServiceInvokeTargetRecord,
    probe: dict[str, Any],
    checked_at_ms: int,
    healthy_threshold: int,
    unhealthy_threshold: int,
    probe_url: str,
) -> ServiceHealthTargetRecord:
    prev_success = int(getattr(previous, "consecutive_successes", 0) or 0)
    prev_failure = int(getattr(previous, "consecutive_failures", 0) or 0)

    if bool(probe.get("healthy")):
        success = prev_success + 1
        failure = 0
        if success >= healthy_threshold:
            status = "healthy"
        else:
            status = str(getattr(previous, "status", None) or "unknown")
        last_healthy_at = checked_at_ms
    else:
        success = 0
        failure = prev_failure + 1
        if failure >= unhealthy_threshold:
            status = "unhealthy"
        else:
            status = "degraded"
        last_healthy_at = getattr(previous, "last_healthy_at", None)

    return ServiceHealthTargetRecord(
        targetUrl=str(target.url or "").strip(),
        status=status,
        weight=int(target.weight or 100),
        region=target.region,
        probeUrl=probe_url,
        httpStatus=probe.get("httpStatus"),
        latencyMs=int(probe.get("latencyMs") or 0),
        lastCheckedAt=checked_at_ms,
        lastHealthyAt=last_healthy_at,
        consecutiveSuccesses=success,
        consecutiveFailures=failure,
        error=probe.get("error"),
    )


async def probe_service_health(
    service: ServiceDefinitionRecord, client: Optional[httpx.AsyncClient] = None
) -> ServiceDefinitionRecord:
    targets = _service_targets(service)
    if not targets:
        return service.model_copy(
            update={
                "runtime_health": ServiceRuntimeHealthRecord(
                    overallStatus="unhealthy",
                    healthyTargets=0,
                    totalTargets=0,
                    lastCheckedAt=_now_ms(),
                    targets=[],
                )
            }
        )

    health_spec = _health_check_config(service)
    target_health = _target_health_map(service)
    timeout_sec = float(health_spec["timeoutMs"]) / 1000.0
    checked_at_ms = _now_ms()

    owns_client = client is None
    async_client = client
    if async_client is None:
        async_client = httpx.AsyncClient()

    try:
        next_target_health: List[ServiceHealthTargetRecord] = []
        for target in targets:
            url = str(target.url or "").strip()
            previous = target_health.get(url)
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

            next_target_health.append(
                _merge_target_health(
                    previous,
                    target,
                    probe,
                    checked_at_ms,
                    int(health_spec["healthyThreshold"]),
                    int(health_spec["unhealthyThreshold"]),
                    probe_url,
                )
            )

        healthy_targets = len(
            [row for row in next_target_health if str(row.status or "") == "healthy"]
        )
        total_targets = len(targets)
        if healthy_targets == 0:
            overall = "unhealthy"
        elif healthy_targets < total_targets:
            overall = "degraded"
        else:
            overall = "healthy"

        return service.model_copy(
            update={
                "runtime_health": ServiceRuntimeHealthRecord(
                    overallStatus=overall,
                    healthyTargets=healthy_targets,
                    totalTargets=total_targets,
                    lastCheckedAt=checked_at_ms,
                    targets=next_target_health,
                )
            }
        )
    finally:
        if owns_client and async_client is not None:
            await async_client.aclose()


async def refresh_all_service_health(storage: BaseStorage) -> dict[str, int]:
    raw_rows = storage.get_data_manager().system.registry.read_service_registry_rows()
    if isinstance(raw_rows, list):
        rows = [
            row
            for row in raw_rows
            if isinstance(row, ServiceDefinitionRecord)
        ]
    else:
        rows = []

    rows = _seed_service_health_from_persisted_rows(storage, rows)

    checked = 0
    updated = 0
    appended_history = 0
    next_rows: List[ServiceDefinitionRecord] = []

    async with httpx.AsyncClient() as client:
        for row in rows:
            if not is_service_probeable(row):
                next_rows.append(row)
                continue

            checked += 1
            next_row = await probe_service_health(row, client=client)
            # Analytics: emit when overall health transitions to degraded or unhealthy
            prev_overall = str(
                getattr(getattr(row, "runtime_health", None), "overall_status", None) or ""
            ).lower()
            next_overall = str(
                getattr(getattr(next_row, "runtime_health", None), "overall_status", None) or ""
            ).lower()
            if next_overall in {"degraded", "unhealthy"} and prev_overall not in {
                "degraded",
                "unhealthy",
            }:
                next_health = getattr(next_row, "runtime_health", None)
                await emit_provider_health_degraded(
                    str(next_row.owner_address or ""),
                    service_id=str(next_row.service_id or ""),
                    overall_status=next_overall,
                    healthy_targets=int(getattr(next_health, "healthy_targets", 0) or 0),
                    total_targets=int(getattr(next_health, "total_targets", 0) or 0),
                )
            if prev_overall in {"degraded", "unhealthy"} and next_overall == "healthy":
                next_health = getattr(next_row, "runtime_health", None)
                await emit_provider_health_recovered(
                    str(next_row.owner_address or ""),
                    service_id=str(next_row.service_id or ""),
                    healthy_targets=int(getattr(next_health, "healthy_targets", 0) or 0),
                    total_targets=int(getattr(next_health, "total_targets", 0) or 0),
                )
            if next_overall == "unhealthy":
                next_health = getattr(next_row, "runtime_health", None)
                prev_health = getattr(row, "runtime_health", None)
                last_healthy_at = max(
                    [
                        int(getattr(target, "last_healthy_at", 0) or 0)
                        for target in getattr(next_health, "targets", []) or []
                    ]
                    or [0]
                )
                prev_checked_at = int(getattr(prev_health, "last_checked_at", 0) or 0)
                now_ms = _now_ms()
                outage_after_ms = max(
                    1,
                    int(settings.service_health_outage_after_sec),
                ) * 1000
                crossed_outage_window = (
                    last_healthy_at > 0
                    and now_ms - last_healthy_at >= outage_after_ms
                    and (
                        prev_checked_at <= 0
                        or prev_checked_at - last_healthy_at < outage_after_ms
                    )
                )
                if crossed_outage_window:
                    await emit_provider_health_outage(
                        str(next_row.owner_address or ""),
                        service_id=str(next_row.service_id or ""),
                        healthy_targets=0,
                        total_targets=int(getattr(next_health, "total_targets", 0) or 0),
                        outage_age_ms=now_ms - last_healthy_at,
                    )
            if next_row != row:
                updated += 1
            if settings.service_health_history_enabled:
                history_rows = build_probe_history_rows(next_row)
                appended_history += append_health_history_rows(storage, history_rows)
            next_rows.append(next_row)

    # Discovery hydrates runtime health from the health snapshot tables, so the
    # monitor only needs to sync health rows here. Rewriting manifests on every
    # probe tick can break quote foreign keys and silently starve discovery.
    synced_rows = sync_service_target_health_table(storage, next_rows)
    valid_service_ids = {
        str(row.service_id or "").strip()
        for row in next_rows
        if str(row.service_id or "").strip()
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


async def run_service_health_monitor(
    stop_event: asyncio.Event, storage: BaseStorage
) -> None:
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
