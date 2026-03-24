from __future__ import annotations

import asyncio
import os
import socket
from time import perf_counter
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from app.core.config import get_settings, parse_json_config
from app.core.log_config import logger
from app.schemas.sentiment import SentimentRequest
from app.services.sentiment.repository import get_sentiment_repository
from app.services import sentiment_service


DEFAULT_SCHEDULER_TARGETS = [
    {
        "symbol": "BTC",
        "chain": "market-wide",
        "lookback_hours": 24,
        "include_narrative": True,
    },
    {
        "symbol": "ETH",
        "chain": "market-wide",
        "lookback_hours": 24,
        "include_narrative": True,
    },
    {
        "symbol": "SOL",
        "chain": "market-wide",
        "lookback_hours": 24,
        "include_narrative": True,
    },
    {
        "symbol": "ETH",
        "chain": "ethereum",
        "lookback_hours": 24,
        "include_narrative": True,
    },
    {
        "symbol": "SOL",
        "chain": "solana",
        "lookback_hours": 24,
        "include_narrative": True,
    },
]


def scheduler_targets() -> list[SentimentRequest]:
    settings = get_settings()
    raw_targets = parse_json_config(settings.sentiment_scheduler_targets_json)
    if not raw_targets:
        raw_targets = DEFAULT_SCHEDULER_TARGETS
    if not isinstance(raw_targets, list):
        raise ValueError("SENTIMENT_SCHEDULER_TARGETS_JSON must decode to a list")
    return [SentimentRequest.model_validate(item) for item in raw_targets]


@dataclass(slots=True)
class SentimentScheduler:
    interval_s: int
    max_concurrent_snapshots: int
    lease_ttl_s: int
    _task: asyncio.Task | None = field(init=False, default=None, repr=False)
    _stop_event: asyncio.Event = field(init=False, repr=False)
    _in_flight_snapshot_keys: set[str] = field(init=False, repr=False)
    _semaphore: asyncio.Semaphore = field(init=False, repr=False)
    _job_owner: str = field(init=False, repr=False)
    _logger: Any = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._stop_event = asyncio.Event()
        self._in_flight_snapshot_keys = set()
        self._semaphore = asyncio.Semaphore(max(1, self.max_concurrent_snapshots))
        self._job_owner = (
            f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"
        )
        self._logger = logger.bind(component="sentiment_scheduler")

    @property
    def task(self) -> asyncio.Task | None:
        return self._task

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self.run_forever(), name="sentiment-scheduler")
        await asyncio.sleep(0)
        self._logger.info("Sentiment scheduler started")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._stop_event.set()
        self._task.cancel()
        results = await asyncio.gather(self._task, return_exceptions=True)
        task_error = results[0] if results else None
        if task_error is not None and not isinstance(task_error, asyncio.CancelledError):
            self._logger.error(f"Sentiment scheduler stopped with task error | error={task_error}")
        self._logger.info("Sentiment scheduler stopped")
        self._task = None

    async def run_forever(self) -> None:
        while not self._stop_event.is_set():
            await self.run_once()
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.interval_s)
            except asyncio.TimeoutError:
                continue

    async def run_once(self) -> None:
        targets = scheduler_targets()
        self._logger.info(f"Sentiment scheduler tick started | targets={len(targets)}")
        await asyncio.gather(*(self._refresh_target(target) for target in targets))
        self._logger.info(f"Sentiment scheduler tick finished | targets={len(targets)}")

    async def _refresh_target(self, payload: SentimentRequest) -> None:
        snapshot_key = sentiment_service._snapshot_key(payload)
        if snapshot_key in self._in_flight_snapshot_keys:
            self._logger.debug(f"Skip duplicate in-flight scheduler refresh | snapshot_key={snapshot_key}")
            return
        async with self._semaphore:
            self._in_flight_snapshot_keys.add(snapshot_key)
            acquired_job = None
            job_started_at = perf_counter()
            try:
                repository = get_sentiment_repository()
                started_at_dt = sentiment_service._now_utc()
                started_at = sentiment_service._to_zulu(started_at_dt)
                lease_expires_at = sentiment_service._to_zulu(
                    started_at_dt + timedelta(seconds=max(1, self.lease_ttl_s))
                )
                acquired_job = repository.try_acquire_scheduler_job(
                    snapshot_key,
                    payload,
                    job_owner=self._job_owner,
                    lease_expires_at=lease_expires_at,
                    started_at=started_at,
                    refresh_reason=sentiment_service.REFRESH_REASON_SCHEDULER,
                )
                if acquired_job is None:
                    self._logger.debug(
                        "Skip scheduler refresh because lease or cooldown blocks it"
                        f" | snapshot_key={snapshot_key}"
                    )
                    return
                self._logger.info(
                    "Scheduler refresh started"
                    f" | snapshot_key={snapshot_key}"
                    f" | job_owner={self._job_owner}"
                    f" | lease_expires_at={lease_expires_at}"
                    f" | symbol={payload.symbol}"
                    f" | chain={payload.chain}"
                )
                response = await sentiment_service.refresh_sentiment_snapshot(
                    payload,
                    reason=sentiment_service.REFRESH_REASON_SCHEDULER,
                )
                finished_at_dt = sentiment_service._now_utc()
                finished_at = sentiment_service._to_zulu(finished_at_dt)
                if _response_used_persisted_fallback(response):
                    cooldown_seconds = _failure_cooldown_seconds(
                        acquired_job.consecutive_failures + 1
                    )
                    repository.mark_scheduler_job_failed(
                        snapshot_key,
                        job_owner=self._job_owner,
                        finished_at=finished_at,
                        next_run_at=sentiment_service._to_zulu(
                            finished_at_dt + timedelta(seconds=cooldown_seconds)
                        ),
                        refresh_reason=sentiment_service.REFRESH_REASON_SCHEDULER,
                        error_code="SENTIMENT_SNAPSHOT_FALLBACK_USED",
                        error_message=(
                            "Scheduler refresh fell back to the persisted snapshot because all live sources failed."
                        ),
                    )
                    self._logger.warning(
                        "Scheduler refresh entered cooldown after fallback"
                        f" | snapshot_key={snapshot_key}"
                        f" | cooldown_s={cooldown_seconds}"
                        f" | duration_ms={int((perf_counter() - job_started_at) * 1000)}"
                    )
                    return
                repository.mark_scheduler_job_succeeded(
                    snapshot_key,
                    job_owner=self._job_owner,
                    finished_at=finished_at,
                    next_run_at=sentiment_service._to_zulu(
                        finished_at_dt + timedelta(seconds=max(1, self.interval_s))
                    ),
                    refresh_reason=sentiment_service.REFRESH_REASON_SCHEDULER,
                )
                self._logger.info(
                    "Scheduler refresh succeeded"
                    f" | snapshot_key={snapshot_key}"
                    f" | score={response.result.sentiment_score}"
                    f" | sentiment_label={response.result.sentiment_label}"
                    f" | source_count={len(response.sources)}"
                    f" | duration_ms={int((perf_counter() - job_started_at) * 1000)}"
                )
            except Exception as exc:  # noqa: BLE001
                finished_at_dt = sentiment_service._now_utc()
                finished_at = sentiment_service._to_zulu(finished_at_dt)
                repository = get_sentiment_repository()
                cooldown_seconds = _failure_cooldown_seconds(
                    1 if acquired_job is None else acquired_job.consecutive_failures + 1
                )
                repository.mark_scheduler_job_failed(
                    snapshot_key,
                    job_owner=self._job_owner,
                    finished_at=finished_at,
                    next_run_at=sentiment_service._to_zulu(
                        finished_at_dt + timedelta(seconds=cooldown_seconds)
                    ),
                    refresh_reason=sentiment_service.REFRESH_REASON_SCHEDULER,
                    error_code="SCHEDULER_REFRESH_FAILED",
                    error_message=str(exc),
                )
                self._logger.error(
                    "Scheduler refresh failed"
                    f" | snapshot_key={snapshot_key}"
                    f" | error={exc}"
                    f" | cooldown_s={cooldown_seconds}"
                    f" | duration_ms={int((perf_counter() - job_started_at) * 1000)}"
                )
            finally:
                self._in_flight_snapshot_keys.discard(snapshot_key)


def _failure_cooldown_seconds(consecutive_failures: int) -> int:
    if consecutive_failures <= 1:
        return 60
    if consecutive_failures == 2:
        return 180
    return 600


def _response_used_persisted_fallback(response) -> bool:
    return "SENTIMENT_SNAPSHOT_FALLBACK_USED" in sentiment_service._response_error_codes(
        response
    )


def scheduler_from_settings() -> SentimentScheduler | None:
    settings = get_settings()
    if not settings.sentiment_scheduler_enabled:
        return None
    return SentimentScheduler(
        interval_s=max(1, settings.sentiment_scheduler_interval_s),
        max_concurrent_snapshots=max(
            1, settings.sentiment_scheduler_max_concurrent_snapshots
        ),
        lease_ttl_s=max(1, settings.sentiment_scheduler_lease_ttl_s),
    )