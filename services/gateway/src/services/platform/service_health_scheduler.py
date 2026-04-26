"""Background scheduler for service health refresh ticks."""
from __future__ import annotations

import asyncio
import logging
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import suppress

from src.core.config import settings
from src.storage.base import BaseStorage
from src.services.platform.service_health_probe import refresh_all_service_health

logger = logging.getLogger(__name__)


async def run_service_health_monitor(
    stop_event: asyncio.Event, storage: BaseStorage
) -> None:
    interval = max(1.0, float(settings.service_health_probe_interval_sec))
    step_timeout = max(0.01, float(settings.service_health_monitor_step_timeout_sec))
    logger.info(
        "Service health monitor started: interval=%ss step_timeout=%ss",
        interval,
        step_timeout,
    )

    def _run_monitor_tick() -> dict[str, int]:
        return asyncio.run(refresh_all_service_health(storage))

    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="service-health")
    loop = asyncio.get_running_loop()
    active_step: Future[dict[str, int]] | None = None
    try:
        while not stop_event.is_set():
            if active_step is not None and active_step.done():
                with suppress(Exception):
                    active_step.result()
                active_step = None

            if active_step is None:
                active_step = executor.submit(_run_monitor_tick)
                wrapped_step = asyncio.wrap_future(active_step, loop=loop)
                try:
                    result = await asyncio.wait_for(
                        wrapped_step,
                        timeout=step_timeout,
                    )
                    logger.debug(
                        "Service health monitor tick: scheduled=%s checked=%s updated=%s jitter_skipped=%s slow_lane_skipped=%s max_concurrency=%s max_candidates=%s",
                        result.get("scheduled"),
                        result.get("checked"),
                        result.get("updated"),
                        result.get("jitterSkipped"),
                        result.get("slowLaneSkipped"),
                        result.get("maxConcurrency"),
                        result.get("maxCandidatesPerTick"),
                    )
                    active_step = None
                except asyncio.TimeoutError:
                    logger.warning(
                        "Service health monitor tick timed out after %ss; abandoning tick so the next interval can prioritize fresh services",
                        step_timeout,
                    )
                    active_step.cancel()
                    executor.shutdown(wait=False, cancel_futures=True)
                    executor = ThreadPoolExecutor(
                        max_workers=1,
                        thread_name_prefix="service-health",
                    )
                    active_step = None
                except Exception as exc:
                    logger.warning("Service health monitor tick failed: %s", exc)
                    active_step = None

            with suppress(asyncio.TimeoutError):
                await asyncio.wait_for(stop_event.wait(), timeout=interval)
    finally:
        if active_step is not None and active_step.done():
            with suppress(Exception):
                active_step.result()
        executor.shutdown(wait=False, cancel_futures=True)

    logger.info("Service health monitor stopped")
