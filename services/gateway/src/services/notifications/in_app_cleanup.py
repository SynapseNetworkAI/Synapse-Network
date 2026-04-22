from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

from src.core.config import settings
from src.services.notifications.in_app import cleanup_in_app_notifications_once
from src.storage.base import BaseStorage

logger = logging.getLogger("synapse.notifications.in_app.cleanup")


async def run_in_app_notification_cleanup(
    stop_event: asyncio.Event,
    storage: BaseStorage,
) -> None:
    interval = max(60, int(settings.in_app_notification_cleanup_interval_sec))
    logger.info("In-app notification cleanup started: interval=%ss", interval)

    while not stop_event.is_set():
        try:
            deleted = await cleanup_in_app_notifications_once(
                storage,
                retention_days=settings.in_app_notification_retention_days,
                security_retention_days=settings.in_app_notification_security_retention_days,
                batch_size=settings.in_app_notification_cleanup_batch_size,
            )
            if deleted:
                logger.info("in_app_notification.cleanup", extra={"deleted": deleted})
        except Exception as exc:
            logger.warning("In-app notification cleanup failed: %s", exc)

        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop_event.wait(), timeout=interval)

    logger.info("In-app notification cleanup stopped")
