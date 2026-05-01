"""Startup-aware probe scheduling plan for provider health checks."""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone

from src.core.config import settings
from src.core.scheduling import compute_stable_offset_ms
from src.domain.service_contract import ServiceDefinitionRecord
from src.services.platform.service_health_tiers import (
    latest_service_health_checked_at,
    service_probe_jitter_key,
    service_probe_tier,
    should_probe_service_now,
)
from src.services.platform.service_health_utils import _now_ms


@dataclass(frozen=True)
class _ProbeCandidate:
    index: int
    service: ServiceDefinitionRecord


@dataclass(frozen=True)
class _ProbePlan:
    next_rows: list[ServiceDefinitionRecord | None]
    candidates: list[_ProbeCandidate]
    scheduled_before_limit: int
    max_candidates: int
    jitter_skipped: int
    rehydrate_skipped: int
    slow_lane_skipped: int


@dataclass(frozen=True)
class ServiceHealthRefreshResult:
    scheduled: int
    scheduled_before_limit: int
    checked: int
    updated: int
    synced_rows: int
    history_appended: int
    history_pruned: int
    jitter_skipped: int
    rehydrate_skipped: int
    slow_lane_skipped: int
    max_concurrency: int
    max_candidates_per_tick: int

    def __getitem__(self, key: str) -> int:
        aliases = {
            "scheduled": self.scheduled,
            "scheduledBeforeLimit": self.scheduled_before_limit,
            "checked": self.checked,
            "updated": self.updated,
            "syncedRows": self.synced_rows,
            "historyAppended": self.history_appended,
            "historyPruned": self.history_pruned,
            "jitterSkipped": self.jitter_skipped,
            "rehydrateSkipped": self.rehydrate_skipped,
            "slowLaneSkipped": self.slow_lane_skipped,
            "maxConcurrency": self.max_concurrency,
            "maxCandidatesPerTick": self.max_candidates_per_tick,
        }
        return aliases[key]


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


def _candidate_priority(
    candidate: _ProbeCandidate,
    *,
    now_ms: int,
) -> tuple[int, int, int, int, str]:
    service = candidate.service
    checked_at = latest_service_health_checked_at(service)
    updated_at = max(
        _record_timestamp_ms(getattr(service, "updated_at", "")),
        _record_timestamp_ms(getattr(service, "created_at", "")),
    )
    tier = service_probe_tier(service, now_ms=now_ms)
    active_rank = 0 if str(getattr(service, "status", "") or "").lower() == "active" else 1
    tier_rank = 1 if tier == "slow_lane" else 0
    return (
        tier_rank,
        active_rank,
        -updated_at,
        0 if checked_at <= 0 else 1,
        str(service.service_id or ""),
    )


def _rehydrate_probe_due(
    service: ServiceDefinitionRecord,
    *,
    now_ms: int,
    startup_started_at_ms: int | None,
) -> bool:
    if latest_service_health_checked_at(service) > 0:
        return True
    if startup_started_at_ms is None or startup_started_at_ms <= 0:
        return True
    window_ms = int(
        max(0.0, float(settings.service_health_rehydrate_window_sec)) * 1000
    )
    if window_ms <= 0:
        return True
    tier = service_probe_tier(service, now_ms=now_ms)
    offset_ms = compute_stable_offset_ms(
        service_probe_jitter_key(service, tier),
        window_ms,
    )
    return now_ms - startup_started_at_ms >= offset_ms


def _build_probe_plan(
    rows: list[ServiceDefinitionRecord],
    *,
    now_ms: int | None = None,
    startup_started_at_ms: int | None,
) -> _ProbePlan:
    checked_at_ms = int(now_ms if now_ms is not None else _now_ms())
    jitter_skipped = 0
    rehydrate_skipped = 0
    slow_lane_skipped = 0
    next_rows: list[ServiceDefinitionRecord | None] = [None] * len(rows)
    candidates: list[_ProbeCandidate] = []

    for index, row in enumerate(rows):
        tier = service_probe_tier(row, now_ms=checked_at_ms)
        if not should_probe_service_now(row, now_ms=checked_at_ms):
            if tier == "slow_lane":
                slow_lane_skipped += 1
            elif tier == "normal":
                jitter_skipped += 1
            next_rows[index] = row
            continue
        if not _rehydrate_probe_due(
            row,
            now_ms=checked_at_ms,
            startup_started_at_ms=startup_started_at_ms,
        ):
            rehydrate_skipped += 1
            next_rows[index] = row
            continue
        candidates.append(_ProbeCandidate(index=index, service=row))

    candidates.sort(
        key=lambda candidate: _candidate_priority(candidate, now_ms=checked_at_ms)
    )
    scheduled_before_limit = len(candidates)
    max_candidates = _max_candidates_per_tick()
    if max_candidates > 0 and len(candidates) > max_candidates:
        for candidate in candidates[max_candidates:]:
            next_rows[candidate.index] = candidate.service
        candidates = candidates[:max_candidates]

    return _ProbePlan(
        next_rows=next_rows,
        candidates=candidates,
        scheduled_before_limit=scheduled_before_limit,
        max_candidates=max_candidates,
        jitter_skipped=jitter_skipped,
        rehydrate_skipped=rehydrate_skipped,
        slow_lane_skipped=slow_lane_skipped,
    )
