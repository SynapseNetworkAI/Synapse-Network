from __future__ import annotations

import asyncio
import logging

from src.core.config import settings
from src.services.platform.balance_service import BalanceService
from src.storage.base import BaseStorage


logger = logging.getLogger(__name__)


async def run_provider_withdraw_expiry_reaper(
    stop_event: asyncio.Event, storage: BaseStorage
) -> None:
    interval = max(1.0, float(settings.provider_withdraw_expiry_reaper_interval_sec))
    logger.info("Provider withdrawal expiry reaper started: interval=%ss", interval)

    while not stop_event.is_set():
        try:
            expired_count = await BalanceService(storage).expire_stale_provider_withdrawals()
            logger.debug(
                "Provider withdrawal expiry reaper tick: expired=%s",
                expired_count,
            )
        except Exception as exc:
            logger.warning("Provider withdrawal expiry reaper tick failed: %s", exc)

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
        except asyncio.TimeoutError:
            pass

    logger.info("Provider withdrawal expiry reaper stopped")