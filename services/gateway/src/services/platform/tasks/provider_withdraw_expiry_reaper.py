from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

from src.core.config import settings
from src.services.platform.balance_service import BalanceService
from src.storage.base import BaseStorage


logger = logging.getLogger(__name__)


async def run_provider_withdraw_expiry_reaper_once(storage: BaseStorage) -> dict[str, int]:
    expired_count = await BalanceService(storage).expire_stale_provider_withdrawals()
    return {"expired": int(expired_count or 0)}


async def run_provider_withdraw_expiry_reaper(
    stop_event: asyncio.Event, storage: BaseStorage
) -> None:
    interval = max(1.0, float(settings.provider_withdraw_expiry_reaper_interval_sec))
    logger.info("Provider withdrawal expiry reaper started: interval=%ss", interval)

    while not stop_event.is_set():
        try:
            result = await run_provider_withdraw_expiry_reaper_once(storage)
            logger.debug(
                "Provider withdrawal expiry reaper tick: expired=%s",
                result["expired"],
            )
        except Exception as exc:
            logger.warning("Provider withdrawal expiry reaper tick failed: %s", exc)

        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop_event.wait(), timeout=interval)

    logger.info("Provider withdrawal expiry reaper stopped")
