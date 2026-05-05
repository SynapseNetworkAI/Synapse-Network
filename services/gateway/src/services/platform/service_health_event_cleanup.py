from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

from src.core.config import settings
from src.services.platform.service_health_history import cleanup_service_health_events_once
from src.storage.base import BaseStorage

logger = logging.getLogger(__name__)


async def run_service_health_event_cleanup_once(storage: BaseStorage) -> dict[str, int]:
    stats = cleanup_service_health_events_once(storage)
    return {
        "removed": int(stats.removed or 0),
        "retentionDays": int(settings.service_health_event_retention_days),
    }


async def run_service_health_event_cleanup(
    stop_event: asyncio.Event, storage: BaseStorage
) -> None:
    interval = max(3600, int(settings.service_health_event_cleanup_interval_sec))
    logger.info("Service health event cleanup started: interval=%ss", interval)
    while not stop_event.is_set():
        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
        if stop_event.is_set():
            break
        try:
            result = await run_service_health_event_cleanup_once(storage)
            if result["removed"] > 0:
                logger.info("service_health_events.cleanup", extra=result)
        except Exception as exc:
            logger.warning("Service health event cleanup failed: %s", exc)
    logger.info("Service health event cleanup stopped")
