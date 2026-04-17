"""Service health probe tier and slow lane scheduling helpers."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from src.core.config import settings
from src.core.scheduling import compute_stable_offset_ms, is_due_with_stable_jitter
from src.domain.service_contract import ServiceDefinitionRecord
from src.services.platform.service_health_utils import (
    _now_ms,
    _runtime_health,
    is_service_probeable,
    service_control_status,
)


def _latest_target_last_checked_at(service: ServiceDefinitionRecord) -> int:
    health = _runtime_health(service)
    values = [int(getattr(health, "last_checked_at", 0) or 0)]
    values.extend(
        int(getattr(target, "last_checked_at", 0) or 0)
        for target in getattr(health, "targets", []) or []
    )
    return max(values or [0])


def latest_service_health_checked_at(service: ServiceDefinitionRecord) -> int:
    return _latest_target_last_checked_at(service)


def _latest_target_last_healthy_at(service: ServiceDefinitionRecord) -> int:
    return max(
        [
            int(getattr(target, "last_healthy_at", 0) or 0)
            for target in getattr(_runtime_health(service), "targets", []) or []
        ]
        or [0]
    )


def _max_target_consecutive_failures(service: ServiceDefinitionRecord) -> int:
    return max(
        [
            int(getattr(target, "consecutive_failures", 0) or 0)
            for target in getattr(_runtime_health(service), "targets", []) or []
        ]
        or [0]
    )


def _raw_runtime_status(service: ServiceDefinitionRecord) -> str:
    return str(_runtime_health(service).overall_status or "unknown").strip().lower()


def _unhealthy_age_ms(
    service: ServiceDefinitionRecord,
    now_ms: Optional[int] = None,
) -> int:
    health = _runtime_health(service)
    if _raw_runtime_status(service) != "unhealthy":
        return 0
    if int(health.healthy_targets or 0) > 0:
        return 0

    last_healthy_at = _latest_target_last_healthy_at(service)
    now = int(now_ms if now_ms is not None else _now_ms())
    if last_healthy_at > 0:
        return max(0, now - last_healthy_at)

    failures = _max_target_consecutive_failures(service)
    if failures <= 0:
        return 0
    interval_ms = max(1, int(settings.service_health_probe_interval_sec)) * 1000
    return failures * interval_ms


def service_probe_tier(
    service: ServiceDefinitionRecord,
    now_ms: Optional[int] = None,
) -> str:
    """Return the automatic probe tier for admin/runtime visibility."""
    lifecycle_status = service_control_status(service)
    if lifecycle_status == "deleted":
        return "disabled"
    if lifecycle_status in {"draft", "inactive"}:
        return "manual_only"
    if lifecycle_status == "suspended":
        return "slow_lane"
    if lifecycle_status == "active" and not bool(service.is_active):
        return "manual_only"

    slow_lane_after_ms = max(
        1,
        int(settings.service_health_slow_lane_after_sec),
    ) * 1000
    if _unhealthy_age_ms(service, now_ms=now_ms) >= slow_lane_after_ms:
        return "slow_lane"
    return "normal"


def _slow_lane_interval_sec(service: ServiceDefinitionRecord) -> int:
    if service_control_status(service) == "suspended":
        return max(1, int(settings.service_health_slow_lane_suspended_interval_sec))
    return max(1, int(settings.service_health_slow_lane_interval_sec))


def service_probe_interval_ms(service: ServiceDefinitionRecord, tier: str) -> int:
    if tier == "slow_lane":
        return _slow_lane_interval_sec(service) * 1000
    return max(1, int(float(settings.service_health_probe_interval_sec) * 1000))


def service_probe_jitter_key(service: ServiceDefinitionRecord, tier: str) -> str:
    targets = sorted(
        str(target.target_url or "").strip()
        for target in getattr(_runtime_health(service), "targets", []) or []
        if str(target.target_url or "").strip()
    )
    if not targets:
        targets = sorted(
            str(target.url or "").strip()
            for target in getattr(service.invoke, "targets", []) or []
            if str(target.url or "").strip()
        )
    return "|".join(
        [
            str(service.service_id or "").strip(),
            str(tier or "normal"),
            *targets,
        ]
    )


def _service_created_at_ms(service: ServiceDefinitionRecord) -> int:
    raw_value = str(getattr(service, "created_at", "") or "").strip()
    if not raw_value:
        return 0
    try:
        normalized = raw_value.replace("Z", "+00:00")
        return int(datetime.fromisoformat(normalized).timestamp() * 1000)
    except ValueError:
        return 0


def _is_startup_probe_due(
    service: ServiceDefinitionRecord,
    *,
    now_ms: int,
    jitter_key: str,
) -> bool:
    created_at_ms = _service_created_at_ms(service)
    if created_at_ms <= 0:
        return True
    startup_window_ms = int(
        max(0.0, float(settings.service_health_startup_jitter_sec)) * 1000
    )
    if startup_window_ms <= 0:
        return True
    offset_ms = compute_stable_offset_ms(jitter_key, startup_window_ms)
    return now_ms - created_at_ms >= offset_ms


def should_probe_service_now(
    service: ServiceDefinitionRecord,
    now_ms: Optional[int] = None,
) -> bool:
    """Return whether the automatic monitor should probe this service this tick."""
    tier = service_probe_tier(service, now_ms=now_ms)
    if tier in {"disabled", "manual_only"}:
        return False
    if tier == "normal":
        return is_service_probeable(service)
    if tier != "slow_lane":
        return False

    if not is_service_probeable(service):
        return False
    last_checked_at = _latest_target_last_checked_at(service)
    now = int(now_ms if now_ms is not None else _now_ms())
    interval_ms = service_probe_interval_ms(service, tier)
    jitter_key = service_probe_jitter_key(service, tier)

    strategy = str(settings.service_health_jitter_strategy or "stable").strip().lower()
    jitter_enabled = bool(settings.service_health_jitter_enabled)
    if last_checked_at <= 0:
        if jitter_enabled and strategy == "stable":
            return _is_startup_probe_due(
                service,
                now_ms=now,
                jitter_key=jitter_key,
            )
        return True
    if not jitter_enabled or strategy != "stable":
        return now - last_checked_at >= interval_ms
    return is_due_with_stable_jitter(
        now_ms=now,
        last_checked_at=last_checked_at,
        interval_ms=interval_ms,
        key=jitter_key,
    )
