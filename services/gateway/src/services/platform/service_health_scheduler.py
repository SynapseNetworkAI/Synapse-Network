"""Background scheduler for service health refresh ticks."""
# ruff: noqa: PLC0415
from __future__ import annotations

import asyncio
import logging
import time
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import suppress

from src.core.config import settings
from src.storage.base import BaseStorage

logger = logging.getLogger(__name__)


def _run_monitor_tick(storage: BaseStorage, startup_started_at_ms: int):
    # Import lazily so tests can monkeypatch the probe module and to avoid
    # coupling scheduler import order to probe internals.
    from src.services.platform import service_health_probe

    return asyncio.run(
        service_health_probe.refresh_all_service_health(
            storage,
            startup_started_at_ms=startup_started_at_ms,
        )
    )


def _log_tick_result(result, *, duration: float, timed_out: bool) -> None:
    logger.debug(
        "Service health monitor tick completed: scheduled=%s checked=%s updated=%s jitter_skipped=%s rehydrate_skipped=%s slow_lane_skipped=%s max_concurrency=%s max_candidates=%s duration=%.3fs timed_out=%s",
        result.scheduled,
        result.checked,
        result.updated,
        result.jitter_skipped,
        result.rehydrate_skipped,
        result.slow_lane_skipped,
        result.max_concurrency,
        result.max_candidates_per_tick,
        duration,
        timed_out,
    )


def _finalize_completed_tick(
    active_step: Future | None,
    *,
    active_step_started_at: float,
    active_step_timed_out: bool,
) -> tuple[Future | None, float, bool]:
    if active_step is None or not active_step.done():
        return active_step, active_step_started_at, active_step_timed_out
    duration = max(0.0, time.monotonic() - active_step_started_at)
    try:
        _log_tick_result(
            active_step.result(),
            duration=duration,
            timed_out=active_step_timed_out,
        )
    except Exception as exc:
        logger.warning("Service health monitor tick failed: %s", exc)
    return None, 0.0, False


async def _await_tick_or_timeout(
    active_step: Future,
    *,
    loop: asyncio.AbstractEventLoop,
    step_timeout: float,
    active_step_started_at: float,
) -> tuple[Future | None, float, bool]:
    wrapped_step = asyncio.wrap_future(active_step, loop=loop)
    try:
        result = await asyncio.wait_for(
            asyncio.shield(wrapped_step),
            timeout=step_timeout,
        )
    except asyncio.TimeoutError:
        logger.warning(
            "Service health monitor tick timed out after %ss; keeping the active tick as the only in-flight DB writer",
            step_timeout,
        )
        return active_step, active_step_started_at, True
    except Exception as exc:
        logger.warning("Service health monitor tick failed: %s", exc)
        return None, 0.0, False
    else:
        _log_tick_result(
            result,
            duration=max(0.0, time.monotonic() - active_step_started_at),
            timed_out=False,
        )
        return None, 0.0, False


async def run_service_health_monitor(
    stop_event: asyncio.Event, storage: BaseStorage
) -> None:
    interval = max(1.0, float(settings.service_health_probe_interval_sec))
    step_timeout = max(0.01, float(settings.service_health_monitor_step_timeout_sec))
    startup_started_at_ms = int(time.time() * 1000)
    logger.info(
        "Service health monitor started: interval=%ss step_timeout=%ss",
        interval,
        step_timeout,
    )

    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="service-health")
    loop = asyncio.get_running_loop()
    active_step: Future | None = None
    active_step_started_at = 0.0
    active_step_timed_out = False
    try:
        while not stop_event.is_set():
            active_step, active_step_started_at, active_step_timed_out = (
                _finalize_completed_tick(
                    active_step,
                    active_step_started_at=active_step_started_at,
                    active_step_timed_out=active_step_timed_out,
                )
            )

            if active_step is None:
                active_step_started_at = time.monotonic()
                active_step_timed_out = False
                active_step = executor.submit(
                    _run_monitor_tick, storage, startup_started_at_ms
                )
                active_step, active_step_started_at, active_step_timed_out = (
                    await _await_tick_or_timeout(
                        active_step,
                        loop=loop,
                        step_timeout=step_timeout,
                        active_step_started_at=active_step_started_at,
                    )
                )
            else:
                logger.warning(
                    "Service health monitor tick skipped because previous tick is still running; active_duration=%.3fs",
                    max(0.0, time.monotonic() - active_step_started_at),
                )

            with suppress(asyncio.TimeoutError):
                await asyncio.wait_for(stop_event.wait(), timeout=interval)
    finally:
        if active_step is not None and active_step.done():
            with suppress(Exception):
                active_step.result()
        executor.shutdown(wait=False, cancel_futures=True)

    logger.info("Service health monitor stopped")
