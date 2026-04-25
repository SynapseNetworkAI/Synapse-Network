from __future__ import annotations

import asyncio
import logging
import time
from contextlib import suppress

from src.core.config import settings
from src.services.platform.balance_service import BalanceService
from src.storage.base import BaseStorage
from src.utils.datetime_utils import to_epoch_seconds


logger = logging.getLogger(__name__)


def _emit_provider_withdrawal_timeout_alert(storage: BaseStorage) -> None:
    try:
        rows = storage.get_data_manager().system.gateway_state.read_provider_withdrawal_rows()
    except Exception as exc:
        logger.warning("Provider withdrawal timeout scan failed: %s", exc)
        return
    now = int(time.time())
    threshold = int(getattr(settings, "withdrawal_timeout_alert_after_sec", 900))
    timed_out = []
    for row in rows:
        if str(getattr(row, "status", "") or "").upper() not in {
            "REQUESTED",
            "PENDING_MANUAL_REVIEW",
            "APPROVED_AUTO",
        }:
            continue
        created_at = to_epoch_seconds(getattr(row, "created_at", None), default=0)
        if created_at <= 0:
            continue
        age = now - created_at
        if age >= threshold:
            timed_out.append((row, age))
    if not timed_out:
        return
    oldest_age = max(age for _, age in timed_out)
    logger.error(
        "alert_trigger=WITHDRAWAL_TIMEOUT env=%s withdrawal_kind=provider "
        "count=%s oldest_age_seconds=%s threshold_seconds=%s",
        getattr(settings, "environment", "unknown"),
        len(timed_out),
        oldest_age,
        threshold,
    )


async def run_provider_withdraw_expiry_reaper_once(storage: BaseStorage) -> dict[str, int]:
    _emit_provider_withdrawal_timeout_alert(storage)
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
