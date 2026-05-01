"""Offline quarantine helpers for provider health checks."""
from __future__ import annotations

from dataclasses import dataclass

from src.core.config import settings
from src.domain.service_contract import ServiceDefinitionRecord
from src.storage.base import BaseStorage
from src.services.platform.service_health_utils import (
    _runtime_health,
    service_control_status,
)


@dataclass(frozen=True)
class ServiceOfflineCandidate:
    service: ServiceDefinitionRecord
    probe_started_at_ms: int
    reason: str


def _max_consecutive_failures(service: ServiceDefinitionRecord) -> int:
    return max(
        [
            int(getattr(target, "consecutive_failures", 0) or 0)
            for target in getattr(_runtime_health(service), "targets", []) or []
        ]
        or [0]
    )


def _latest_healthy_at(service: ServiceDefinitionRecord) -> int:
    return max(
        [
            int(getattr(target, "last_healthy_at", 0) or 0)
            for target in getattr(_runtime_health(service), "targets", []) or []
        ]
        or [0]
    )


def _failure_age_ms(
    service: ServiceDefinitionRecord,
    *,
    now_ms: int,
    consecutive_failures: int,
) -> int:
    health = _runtime_health(service)
    last_healthy_at = _latest_healthy_at(service)
    if last_healthy_at > 0:
        return max(0, int(now_ms) - last_healthy_at)

    last_checked_at = int(getattr(health, "last_checked_at", 0) or 0)
    if last_checked_at <= 0:
        return 0

    probe_interval_ms = max(1, int(settings.service_health_probe_interval_sec)) * 1000
    first_failure_at = last_checked_at - max(0, consecutive_failures - 1) * probe_interval_ms
    return max(0, int(now_ms) - first_failure_at)


def should_quarantine_offline(
    service: ServiceDefinitionRecord,
    *,
    now_ms: int,
) -> bool:
    if service_control_status(service) != "active":
        return False
    health = _runtime_health(service)
    if str(health.overall_status or "").strip().lower() != "unhealthy":
        return False
    if int(health.healthy_targets or 0) > 0:
        return False
    consecutive_failures = _max_consecutive_failures(service)
    if consecutive_failures < int(settings.service_health_offline_failures):
        return False

    offline_after_ms = max(1, int(settings.service_health_offline_after_sec)) * 1000
    return (
        _failure_age_ms(
            service,
            now_ms=now_ms,
            consecutive_failures=consecutive_failures,
        )
        >= offline_after_ms
    )


def mark_offline_candidates(
    storage: BaseStorage,
    candidates: list[ServiceOfflineCandidate],
    *,
    now_ms: int,
) -> int:
    if not candidates:
        return 0

    registry = storage.get_data_manager().system.registry
    marker = getattr(registry, "mark_service_offline_if_still_failed", None)
    if not callable(marker):
        return 0

    marked = 0
    offline_after_ms = max(1, int(settings.service_health_offline_after_sec)) * 1000
    probe_interval_ms = max(1, int(settings.service_health_probe_interval_sec)) * 1000
    failure_threshold = max(1, int(settings.service_health_offline_failures))
    last_healthy_cutoff_ms = int(now_ms) - offline_after_ms
    for candidate in candidates:
        service_id = str(candidate.service.service_id or "").strip()
        if not service_id:
            continue
        if marker(
            service_id,
            probe_started_at_ms=int(candidate.probe_started_at_ms),
            failure_threshold=failure_threshold,
            last_healthy_cutoff_ms=last_healthy_cutoff_ms,
            probe_interval_ms=probe_interval_ms,
            reason=candidate.reason,
        ):
            marked += 1
    return marked
