from __future__ import annotations

import argparse
import asyncio
import logging

from src.core.config import settings
from src.core.log_config import setup_logger
from src.services.analytics.outbox_worker import (
    drain_analytics_outbox_once,
    run_analytics_outbox_worker,
)
from src.services.notifications.outbox_worker import (
    drain_notification_outbox_once,
    run_notification_outbox_worker,
)
from src.services.notifications.in_app_cleanup import run_in_app_notification_cleanup_once
from src.services.platform.job_locks import postgres_advisory_job_lock
from src.services.platform.tasks.consumer_withdraw_processor import (
    run_consumer_withdraw_processor_once,
)
from src.services.platform.tasks.deposit_indexer.runner import run_indexer_blocking_step
from src.services.platform.tasks.provider_withdraw_expiry_reaper import (
    run_provider_withdraw_expiry_reaper_once,
)
from src.storage import create_storage

logger = logging.getLogger(__name__)


async def _run_with_job_lock(storage, job_name: str, callback):
    with postgres_advisory_job_lock(storage, job_name) as acquired:
        if not acquired:
            logger.info(
                "alert_trigger=GATEWAY_JOB_HEARTBEAT env=%s job_name=%s status=skipped_already_running",
                settings.environment,
                job_name,
            )
            return {
                "status": "skipped",
                "reason": "already_running",
                "jobName": job_name,
            }
        result = await callback()
        logger.info(
            "alert_trigger=GATEWAY_JOB_HEARTBEAT env=%s job_name=%s status=ok",
            settings.environment,
            job_name,
        )
        return {"status": "ok", "jobName": job_name, "result": result}


async def _analytics_outbox_once(storage):
    return await drain_analytics_outbox_once(storage)


async def _notification_outbox_once(storage):
    return await _run_with_job_lock(
        storage,
        "notification-outbox-drain",
        lambda: drain_notification_outbox_once(storage),
    )


async def _deposit_indexer_once(storage):
    return await _run_with_job_lock(
        storage,
        "deposit-indexer",
        lambda: asyncio.to_thread(run_indexer_blocking_step, storage, 0),
    )


async def _provider_withdraw_reaper_once(storage):
    return await _run_with_job_lock(
        storage,
        "provider-withdraw-reaper",
        lambda: run_provider_withdraw_expiry_reaper_once(storage),
    )


async def _consumer_withdraw_processor_once(storage):
    return await _run_with_job_lock(
        storage,
        "consumer-withdraw-processor",
        lambda: run_consumer_withdraw_processor_once(storage),
    )


async def _in_app_cleanup_once(storage):
    return await _run_with_job_lock(
        storage,
        "in-app-notification-cleanup",
        lambda: run_in_app_notification_cleanup_once(storage),
    )


_ONCE_COMMANDS = {
    "analytics-outbox": ("analytics_outbox.once", _analytics_outbox_once),
    "notification-outbox": ("notification_outbox.once", _notification_outbox_once),
    "deposit-indexer": ("deposit_indexer.once", _deposit_indexer_once),
    "provider-withdraw-reaper": (
        "provider_withdraw_reaper.once",
        _provider_withdraw_reaper_once,
    ),
    "consumer-withdraw-processor": (
        "consumer_withdraw_processor.once",
        _consumer_withdraw_processor_once,
    ),
    "in-app-cleanup": ("in_app_notification_cleanup.once", _in_app_cleanup_once),
}


async def _run_long_lived_worker(args: argparse.Namespace, storage) -> bool:
    if args.command == "analytics-outbox":
        stop_event = asyncio.Event()
        await run_analytics_outbox_worker(
            stop_event,
            storage,
            poll_interval_sec=max(0.1, float(args.poll_interval_sec)),
        )
        return True
    if args.command == "notification-outbox":
        stop_event = asyncio.Event()
        await run_notification_outbox_worker(
            stop_event,
            storage,
            poll_interval_sec=max(0.1, float(args.poll_interval_sec)),
        )
        return True
    return False


async def _run(args: argparse.Namespace) -> int:
    storage = create_storage(settings)
    if args.once and args.command in _ONCE_COMMANDS:
        log_name, handler = _ONCE_COMMANDS[args.command]
        result = await handler(storage)
        logger.info(log_name, extra=result)
        print(result)
        return 0
    if await _run_long_lived_worker(args, storage):
        return 0
    raise ValueError


def main() -> int:
    setup_logger()
    parser = argparse.ArgumentParser(description="Synapse Gateway worker runtime")
    subparsers = parser.add_subparsers(dest="command", required=True)

    analytics_outbox = subparsers.add_parser(
        "analytics-outbox",
        help="Drain Postgres analytics outbox rows to Kafka.",
    )
    analytics_outbox.add_argument(
        "--once",
        action="store_true",
        help="Drain one batch and exit.",
    )
    analytics_outbox.add_argument(
        "--poll-interval-sec",
        type=float,
        default=1.0,
        help="Polling interval for long-running mode.",
    )

    notification_outbox = subparsers.add_parser(
        "notification-outbox",
        help="Drain Postgres notification outbox rows to Gmail SMTP.",
    )
    notification_outbox.add_argument(
        "--once",
        action="store_true",
        help="Drain one batch and exit.",
    )
    notification_outbox.add_argument(
        "--poll-interval-sec",
        type=float,
        default=1.0,
        help="Polling interval for long-running mode.",
    )

    deposit_indexer = subparsers.add_parser(
        "deposit-indexer",
        help="Run a bounded deposit indexer tick.",
    )
    deposit_indexer.add_argument("--once", action="store_true", required=True)

    provider_withdraw_reaper = subparsers.add_parser(
        "provider-withdraw-reaper",
        help="Expire stale provider withdrawals once.",
    )
    provider_withdraw_reaper.add_argument("--once", action="store_true", required=True)

    consumer_withdraw_processor = subparsers.add_parser(
        "consumer-withdraw-processor",
        help="Process consumer withdrawal chain events and expiries once.",
    )
    consumer_withdraw_processor.add_argument("--once", action="store_true", required=True)

    in_app_cleanup = subparsers.add_parser(
        "in-app-cleanup",
        help="Delete expired in-app notifications once.",
    )
    in_app_cleanup.add_argument("--once", action="store_true", required=True)

    return asyncio.run(_run(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
