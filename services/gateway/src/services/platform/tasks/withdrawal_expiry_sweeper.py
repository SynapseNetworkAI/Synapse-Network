from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from contextlib import suppress

from src.core.config import settings
from src.services.platform.balance_service import BalanceService
from src.services.platform.tasks.consumer_withdraw_manual_review_expiry import (
    collect_expired_manual_review_consumer_withdrawals,
    expire_manual_review_consumer_withdrawal,
)
from src.services.platform.tasks.consumer_withdraw_processor import (
    _collect_consumer_withdrawal_timeout_rows,
    _collect_requested_consumer_withdrawals,
    _emit_consumer_withdrawal_timeout_alert,
    _expire_requested_consumer_withdrawal_if_due,
)
from src.services.platform.tasks.provider_withdraw_expiry_reaper import (
    _emit_provider_withdrawal_timeout_alert,
)
from src.storage.base import BaseStorage

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WithdrawalExpirySweeperTick:
    consumerManualReviewExpired: int
    consumerTicketExpired: int
    providerExpired: int
    failed: int


async def run_withdrawal_expiry_sweeper_once(storage: BaseStorage) -> WithdrawalExpirySweeperTick:
    consumer_manual_review_expired = 0
    consumer_ticket_expired = 0
    provider_expired = 0
    failed = 0

    manual_review_expired = await asyncio.to_thread(
        collect_expired_manual_review_consumer_withdrawals,
        storage,
    )
    timeout_rows = await asyncio.to_thread(_collect_consumer_withdrawal_timeout_rows, storage)
    _emit_consumer_withdrawal_timeout_alert(timeout_rows)
    _emit_provider_withdrawal_timeout_alert(storage)

    for row in manual_review_expired:
        try:
            changed = await asyncio.to_thread(
                expire_manual_review_consumer_withdrawal,
                storage,
                row,
            )
            if changed:
                consumer_manual_review_expired += 1
        except Exception as exc:
            failed += 1
            logger.warning(
                "withdrawal_expiry_sweeper: error expiring consumer manual review %s: %s",
                getattr(row, "id", "?"),
                exc,
            )

    requested_rows = await asyncio.to_thread(_collect_requested_consumer_withdrawals, storage)
    for row in requested_rows:
        if str(getattr(row, "status", "") or "").upper() != "REQUESTED":
            continue
        try:
            changed = await asyncio.to_thread(
                _expire_requested_consumer_withdrawal_if_due,
                storage,
                row,
            )
            if changed:
                consumer_ticket_expired += 1
        except Exception as exc:
            failed += 1
            logger.warning(
                "withdrawal_expiry_sweeper: error expiring consumer requested withdrawal %s: %s",
                getattr(row, "id", "?"),
                exc,
            )

    try:
        provider_expired = int(
            await BalanceService(storage).expire_stale_provider_withdrawals() or 0
        )
    except Exception as exc:
        failed += 1
        logger.warning("withdrawal_expiry_sweeper: provider expiry failed: %s", exc)

    return WithdrawalExpirySweeperTick(
        consumerManualReviewExpired=consumer_manual_review_expired,
        consumerTicketExpired=consumer_ticket_expired,
        providerExpired=provider_expired,
        failed=failed,
    )


async def run_withdrawal_expiry_sweeper(
    stop_event: asyncio.Event, storage: BaseStorage
) -> None:
    interval = max(1.0, float(settings.withdrawal_expiry_sweeper_interval_sec))
    logger.info("Withdrawal expiry sweeper started: interval=%ss", interval)

    while not stop_event.is_set():
        try:
            result = await run_withdrawal_expiry_sweeper_once(storage)
            logger.debug("withdrawal_expiry_sweeper: tick=%s", result)
        except Exception as exc:
            logger.warning("withdrawal_expiry_sweeper: tick failed: %s", exc)

        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop_event.wait(), timeout=interval)

    logger.info("Withdrawal expiry sweeper stopped")
