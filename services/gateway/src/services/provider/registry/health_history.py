from __future__ import annotations

import asyncio
import math
import time
from typing import Any, Dict, Optional

from .interfaces import RegistryContext
from .payload_helpers import (
    find_owned_service,
    history_entries_by_target,
    history_window_hours,
    serialized_history_targets,
)


async def service_health_history(
    context: RegistryContext,
    service_record_id: str,
    owner_wallet: str,
    limit_per_target: int,
    hours: Optional[int] = None,
    days: Optional[int] = None,
) -> Dict[str, Any]:
    await asyncio.sleep(0)
    rows = context._load_service_registry_rows()
    service_row = find_owned_service(rows, service_record_id, owner_wallet)
    if service_row is None:
        raise ValueError("SERVICE_NOT_FOUND_OR_FORBIDDEN")

    history = context._load_service_target_health_history_rows()
    if not isinstance(history, list):
        history = []

    retention_hours, window_hours = history_window_hours(hours, days)
    cutoff_ms = int(time.time() * 1000) - (window_hours * 60 * 60 * 1000)
    normalized_limit = max(1, min(int(limit_per_target), 2000))
    per_target = history_entries_by_target(history, service_record_id, cutoff_ms)
    targets = serialized_history_targets(per_target, normalized_limit)
    return {
        "serviceId": service_record_id,
        "serviceName": service_row.service_name,
        "windowHours": window_hours,
        "retentionHours": retention_hours,
        "windowDays": max(1, int(math.ceil(window_hours / 24))),
        "retentionDays": max(1, int(math.ceil(retention_hours / 24))),
        "limitPerTarget": normalized_limit,
        "targets": targets,
    }