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
from src.storage import create_storage


async def _run(args: argparse.Namespace) -> int:
    storage = create_storage(settings)
    if args.command == "analytics-outbox" and args.once:
        result = await drain_analytics_outbox_once(storage)
        logging.getLogger(__name__).info("analytics_outbox.once", extra=result)
        print(result)
        return 0
    if args.command == "analytics-outbox":
        stop_event = asyncio.Event()
        await run_analytics_outbox_worker(
            stop_event,
            storage,
            poll_interval_sec=max(0.1, float(args.poll_interval_sec)),
        )
        return 0
    raise ValueError(f"Unsupported worker command: {args.command}")


def main() -> int:
    setup_logger()
    parser = argparse.ArgumentParser(description="Synapse Gateway worker runtime")
    subparsers = parser.add_subparsers(dest="command", required=True)

    analytics_outbox = subparsers.add_parser(
        "analytics-outbox",
        help="Drain Postgres analytics outbox rows to Kafka.",
    )
    analytics_outbox.add_argument("--once", action="store_true", help="Drain one batch and exit.")
    analytics_outbox.add_argument(
        "--poll-interval-sec",
        type=float,
        default=1.0,
        help="Polling interval for long-running mode.",
    )

    return asyncio.run(_run(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
