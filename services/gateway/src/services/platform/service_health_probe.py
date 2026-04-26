"""Service health probe and monitor functions.

Extracted from service_health_service to keep each module under 500 lines.
Utility and persistence functions live in service_health_utils.py.
service_health_service.py re-exports everything so module-attribute access
patterns continue to work unchanged.
"""
from __future__ import annotations

# ruff: noqa: C901, PLC0415, PLR0912, PLW0603

import asyncio
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, List, Optional

import httpx

from src.core.config import settings
from src.core.scheduling import BoundedTaskRunner
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
    _target_health_map,
    build_probe_url,
    sync_service_target_health_table,
)
from src.services.platform.service_health_history import (
    _should_prune_history,
    append_health_history_rows,
    build_probe_history_rows,
    prune_health_history,
)
from src.services.platform.service_health_tiers import (
    latest_service_health_checked_at,
    service_probe_tier,
    should_probe_service_now,
)
from src.services.analytics.gateway_events import (
    emit_provider_health_degraded,
    emit_provider_health_outage,
    emit_provider_health_recovered,
)

logger = logging.getLogger(__name__)
_probe_limiter: asyncio.Semaphore | None = None
_probe_limiter_size = 0
_probe_limiter_loop_id = 0


@dataclass(frozen=True)
class _ProbeCandidate:
    index: int
    service: ServiceDefinitionRecord


@dataclass(frozen=True)
class _ProbeResult:
    index: int
    previous: ServiceDefinitionRecord
    current: ServiceDefinitionRecord


def _max_probe_concurrency() -> int:
    return max(1, int(settings.service_health_max_concurrency or 1))


def _max_candidates_per_tick() -> int:
    raw_value = str(os.getenv("SERVICE_HEALTH_MAX_CANDIDATES_PER_TICK") or "").strip()
    if not raw_value:
        if str(settings.environment or "").strip().lower() == "local":
            return 25
        return 0
    try:
        return max(0, int(raw_value))
    except ValueError:
        return 0


def _record_timestamp_ms(raw_value: object) -> int:
    value = str(raw_value or "").strip()
    if not value:
        return 0
    try:
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return int(parsed.timestamp() * 1000)
    except ValueError:
        return 0


def _candidate_priority(candidate: _ProbeCandidate) -> tuple[int, int, int, int, str]:
    service = candidate.service
    checked_at = latest_service_health_checked_at(service)
    updated_at = max(
        _record_timestamp_ms(getattr(service, "updated_at", "")),
        _record_timestamp_ms(getattr(service, "created_at", "")),
    )
    tier = service_probe_tier(service)
    active_rank = 0 if str(getattr(service, "status", "") or "").lower() == "active" else 1
    tier_rank = 1 if tier == "slow_lane" else 0
    missing_health_rank = 0 if checked_at <= 0 else 1
    return (
        tier_rank,
        active_rank,
        missing_health_rank,
        -updated_at,
        str(service.service_id or ""),
    )


def _global_probe_limiter() -> asyncio.Semaphore:
    global _probe_limiter, _probe_limiter_size, _probe_limiter_loop_id
    size = _max_probe_concurrency()
    loop_id = id(asyncio.get_running_loop())
    if (
        _probe_limiter is None
        or _probe_limiter_size != size
        or _probe_limiter_loop_id != loop_id
    ):
        _probe_limiter = asyncio.Semaphore(size)
        _probe_limiter_size = size
        _probe_limiter_loop_id = loop_id
    return _probe_limiter


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
        status = "unhealthy" if failure >= unhealthy_threshold else "degraded"
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
        async_client = httpx.AsyncClient(timeout=httpx.Timeout(timeout_sec))

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


_DEFAULT_PROBE_SERVICE_HEALTH = probe_service_health


async def force_probe_service_health(
    service: ServiceDefinitionRecord,
    client: Optional[httpx.AsyncClient] = None,
) -> ServiceDefinitionRecord:
    from src.services.platform import service_health_service

    local_probe_impl = probe_service_health
    shared_probe_impl = getattr(
        service_health_service,
        "probe_service_health",
        _DEFAULT_PROBE_SERVICE_HEALTH,
    )
    probe_impl = local_probe_impl
    if (
        local_probe_impl is _DEFAULT_PROBE_SERVICE_HEALTH
        and shared_probe_impl is not _DEFAULT_PROBE_SERVICE_HEALTH
    ):
        probe_impl = shared_probe_impl
    async with _global_probe_limiter():
        if client is None:
            return await probe_impl(service)
        return await probe_impl(service, client=client)


async def _probe_candidate(
    candidate: _ProbeCandidate,
    client: httpx.AsyncClient,
) -> _ProbeResult:
    next_service = await probe_service_health(candidate.service, client=client)
    return _ProbeResult(
        index=candidate.index,
        previous=candidate.service,
        current=next_service,
    )


async def _emit_health_transition_events(
    previous: ServiceDefinitionRecord,
    current: ServiceDefinitionRecord,
) -> None:
    prev_overall = str(
        getattr(getattr(previous, "runtime_health", None), "overall_status", None) or ""
    ).lower()
    next_overall = str(
        getattr(getattr(current, "runtime_health", None), "overall_status", None) or ""
    ).lower()
    if next_overall in {"degraded", "unhealthy"} and prev_overall not in {
        "degraded",
        "unhealthy",
    }:
        next_health = getattr(current, "runtime_health", None)
        await emit_provider_health_degraded(
            str(current.owner_address or ""),
            service_id=str(current.service_id or ""),
            overall_status=next_overall,
            healthy_targets=int(getattr(next_health, "healthy_targets", 0) or 0),
            total_targets=int(getattr(next_health, "total_targets", 0) or 0),
        )
    if prev_overall in {"degraded", "unhealthy"} and next_overall == "healthy":
        next_health = getattr(current, "runtime_health", None)
        await emit_provider_health_recovered(
            str(current.owner_address or ""),
            service_id=str(current.service_id or ""),
            healthy_targets=int(getattr(next_health, "healthy_targets", 0) or 0),
            total_targets=int(getattr(next_health, "total_targets", 0) or 0),
        )
    if next_overall != "unhealthy":
        return

    next_health = getattr(current, "runtime_health", None)
    prev_health = getattr(previous, "runtime_health", None)
    last_healthy_at = max(
        [
            int(getattr(target, "last_healthy_at", 0) or 0)
            for target in getattr(next_health, "targets", []) or []
        ]
        or [0]
    )
    prev_checked_at = int(getattr(prev_health, "last_checked_at", 0) or 0)
    now_ms = _now_ms()
    outage_after_ms = max(1, int(settings.service_health_outage_after_sec)) * 1000
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
            str(current.owner_address or ""),
            service_id=str(current.service_id or ""),
            healthy_targets=0,
            total_targets=int(getattr(next_health, "total_targets", 0) or 0),
            outage_age_ms=now_ms - last_healthy_at,
        )


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
    jitter_skipped = 0
    slow_lane_skipped = 0
    next_rows: list[ServiceDefinitionRecord | None] = [None] * len(rows)
    candidates: list[_ProbeCandidate] = []

    for index, row in enumerate(rows):
        now_ms = _now_ms()
        tier = service_probe_tier(row, now_ms=now_ms)
        if not should_probe_service_now(row, now_ms=now_ms):
            if tier == "slow_lane":
                slow_lane_skipped += 1
            elif tier == "normal":
                jitter_skipped += 1
            next_rows[index] = row
            continue
        candidates.append(_ProbeCandidate(index=index, service=row))

    candidates.sort(key=_candidate_priority)
    scheduled_before_limit = len(candidates)
    max_candidates = _max_candidates_per_tick()
    if max_candidates > 0 and len(candidates) > max_candidates:
        for candidate in candidates[max_candidates:]:
            next_rows[candidate.index] = candidate.service
        candidates = candidates[:max_candidates]

    default_timeout_sec = max(0.1, float(settings.service_health_probe_timeout_ms) / 1000.0)
    async with httpx.AsyncClient(timeout=httpx.Timeout(default_timeout_sec)) as client:
        runner = BoundedTaskRunner(
            _max_probe_concurrency(),
            semaphore=_global_probe_limiter(),
        )
        probe_results = await runner.run(
            candidates,
            lambda candidate: _probe_candidate(candidate, client),
        )

    for result in probe_results:
        checked += 1
        next_rows[result.index] = result.current
        await _emit_health_transition_events(result.previous, result.current)
        if result.current != result.previous:
            updated += 1
        if settings.service_health_history_enabled:
            history_rows = build_probe_history_rows(result.current)
            appended_history += append_health_history_rows(storage, history_rows)

    final_rows = [row for row in next_rows if row is not None]

    # Discovery hydrates runtime health from the health snapshot tables, so the
    # monitor only needs to sync health rows here. Rewriting manifests on every
    # probe tick can break quote foreign keys and silently starve discovery.
    synced_rows = sync_service_target_health_table(storage, final_rows)
    valid_service_ids = {
        str(row.service_id or "").strip()
        for row in final_rows
        if str(row.service_id or "").strip()
    }
    now_ms = _now_ms()
    if _should_prune_history(now_ms):
        prune_stats = prune_health_history(storage, valid_service_ids=valid_service_ids)
    else:
        prune_stats = {"before": 0, "after": 0, "removed": 0}

    return {
        "scheduled": len(candidates),
        "scheduledBeforeLimit": scheduled_before_limit,
        "checked": checked,
        "updated": updated,
        "syncedRows": synced_rows,
        "historyAppended": appended_history,
        "historyPruned": int(prune_stats.get("removed") or 0),
        "jitterSkipped": jitter_skipped,
        "slowLaneSkipped": slow_lane_skipped,
        "maxConcurrency": _max_probe_concurrency(),
        "maxCandidatesPerTick": max_candidates,
    }
