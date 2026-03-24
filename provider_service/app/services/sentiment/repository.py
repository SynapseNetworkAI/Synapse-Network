from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, cast

from app.core.config import get_settings, resolve_provider_path
from app.core.log_config import logger
from app.schemas.sentiment import (
    RawFeedRecord,
    SchedulerJobRecord,
    SchedulerJobStatus,
    SentimentRequest,
    SentimentResponse,
)


TABLE_NAME_PATTERN = re.compile(r"^[A-Za-z_]\w*$")
repository_logger = logger.bind(component="sentiment_repository")


class SentimentRepository(ABC):
    @abstractmethod
    def save_snapshot(
        self,
        snapshot_key: str,
        payload: SentimentRequest,
        response: SentimentResponse,
    ) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_snapshot(self, snapshot_key: str) -> SentimentResponse | None:
        raise NotImplementedError

    @abstractmethod
    def append_raw_feed_records(
        self,
        snapshot_key: str,
        payload: SentimentRequest,
        records: list[RawFeedRecord],
    ) -> None:
        raise NotImplementedError

    @abstractmethod
    def try_acquire_scheduler_job(
        self,
        snapshot_key: str,
        payload: SentimentRequest,
        *,
        job_owner: str,
        lease_expires_at: str,
        started_at: str,
        refresh_reason: str,
    ) -> SchedulerJobRecord | None:
        raise NotImplementedError

    @abstractmethod
    def mark_scheduler_job_succeeded(
        self,
        snapshot_key: str,
        *,
        job_owner: str,
        finished_at: str,
        next_run_at: str,
        refresh_reason: str,
    ) -> SchedulerJobRecord | None:
        raise NotImplementedError

    @abstractmethod
    def mark_scheduler_job_failed(
        self,
        snapshot_key: str,
        *,
        job_owner: str,
        finished_at: str,
        next_run_at: str,
        refresh_reason: str,
        error_code: str,
        error_message: str,
    ) -> SchedulerJobRecord | None:
        raise NotImplementedError


def _parse_zulu_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _to_zulu(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _build_scheduler_job_record(
    snapshot_key: str,
    payload: SentimentRequest,
) -> SchedulerJobRecord:
    return SchedulerJobRecord(
        snapshotKey=snapshot_key,
        symbol=payload.symbol,
        chain=payload.chain,
        lookbackHours=payload.lookback_hours,
        includeNarrative=payload.include_narrative,
    )


def _scheduler_job_is_claimable(
    record: SchedulerJobRecord,
    *,
    now: datetime,
    job_owner: str,
) -> bool:
    if record.next_run_at is not None and _parse_zulu_datetime(record.next_run_at) > now:
        return False
    if (
        record.lease_expires_at is not None
        and _parse_zulu_datetime(record.lease_expires_at) > now
        and record.job_owner not in {None, job_owner}
    ):
        return False
    return True


def _scheduler_job_row_to_model(row: tuple[object, ...]) -> SchedulerJobRecord:
    return SchedulerJobRecord(
        snapshotKey=str(row[0]),
        symbol=str(row[1]),
        chain=str(row[2]),
        lookbackHours=cast(int, row[3]),
        includeNarrative=bool(row[4]),
        jobOwner=None if row[5] is None else str(row[5]),
        jobStatus=cast(SchedulerJobStatus, row[6]),
        leaseExpiresAt=None if row[7] is None else _to_zulu(cast(datetime, row[7])),
        lastStartedAt=None if row[8] is None else _to_zulu(cast(datetime, row[8])),
        lastFinishedAt=None if row[9] is None else _to_zulu(cast(datetime, row[9])),
        lastSuccessAt=None if row[10] is None else _to_zulu(cast(datetime, row[10])),
        lastFailureAt=None if row[11] is None else _to_zulu(cast(datetime, row[11])),
        lastErrorCode=None if row[12] is None else str(row[12]),
        lastErrorMessage=None if row[13] is None else str(row[13]),
        consecutiveFailures=cast(int, row[14]),
        nextRunAt=None if row[15] is None else _to_zulu(cast(datetime, row[15])),
        lastRefreshReason=None if row[16] is None else str(row[16]),
        updatedAt=None if row[17] is None else _to_zulu(cast(datetime, row[17])),
    )


class FileBackedSentimentRepository(SentimentRepository):
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir
        self.snapshots_dir = self.base_dir / "snapshots"
        self.raw_feeds_dir = self.base_dir / "raw_feeds"
        self.scheduler_jobs_path = self.base_dir / "scheduler_jobs.json"
        self.snapshots_dir.mkdir(parents=True, exist_ok=True)
        self.raw_feeds_dir.mkdir(parents=True, exist_ok=True)

    def save_snapshot(
        self,
        snapshot_key: str,
        payload: SentimentRequest,
        response: SentimentResponse,
    ) -> None:
        _ = payload
        snapshot_path = self.snapshots_dir / f"{snapshot_key}.json"
        payload_json = response.model_dump(by_alias=True, mode="json")
        snapshot_path.write_text(
            json.dumps(payload_json, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        repository_logger.info(
            "Sentiment snapshot persisted"
            " | backend=file"
            f" | snapshot_key={snapshot_key}"
            f" | symbol={payload.symbol}"
            f" | chain={payload.chain}"
            f" | source_count={len(response.sources)}"
            f" | sentiment_score={response.result.sentiment_score}"
        )

    def load_snapshot(self, snapshot_key: str) -> SentimentResponse | None:
        snapshot_path = self.snapshots_dir / f"{snapshot_key}.json"
        if not snapshot_path.exists():
            return None
        payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
        return SentimentResponse.model_validate(payload)

    def append_raw_feed_records(
        self,
        snapshot_key: str,
        payload: SentimentRequest,
        records: list[RawFeedRecord],
    ) -> None:
        _ = payload
        if not records:
            return
        raw_feed_path = self.raw_feeds_dir / f"{snapshot_key}.jsonl"
        with raw_feed_path.open("a", encoding="utf-8") as handle:
            for record in records:
                handle.write(
                    json.dumps(
                        record.model_dump(by_alias=True, mode="json"),
                        ensure_ascii=False,
                    )
                )
                handle.write("\n")
        repository_logger.info(
            "Sentiment raw feeds persisted"
            " | backend=file"
            f" | snapshot_key={snapshot_key}"
            f" | symbol={payload.symbol}"
            f" | chain={payload.chain}"
            f" | record_count={len(records)}"
        )

    def try_acquire_scheduler_job(
        self,
        snapshot_key: str,
        payload: SentimentRequest,
        *,
        job_owner: str,
        lease_expires_at: str,
        started_at: str,
        refresh_reason: str,
    ) -> SchedulerJobRecord | None:
        jobs = self._read_scheduler_jobs()
        existing = jobs.get(snapshot_key, _build_scheduler_job_record(snapshot_key, payload))
        if not _scheduler_job_is_claimable(
            existing,
            now=_parse_zulu_datetime(started_at),
            job_owner=job_owner,
        ):
            return None
        updated = existing.model_copy(
            update={
                "symbol": payload.symbol,
                "chain": payload.chain,
                "lookback_hours": payload.lookback_hours,
                "include_narrative": payload.include_narrative,
                "job_owner": job_owner,
                "job_status": "running",
                "lease_expires_at": lease_expires_at,
                "last_started_at": started_at,
                "last_refresh_reason": refresh_reason,
                "updated_at": started_at,
            }
        )
        jobs[snapshot_key] = updated
        self._write_scheduler_jobs(jobs)
        repository_logger.info(
            "Sentiment scheduler state updated"
            " | backend=file"
            f" | snapshot_key={snapshot_key}"
            " | transition=acquired"
            f" | job_status={updated.job_status}"
            f" | job_owner={updated.job_owner}"
            f" | next_run_at={updated.next_run_at}"
        )
        return updated

    def mark_scheduler_job_succeeded(
        self,
        snapshot_key: str,
        *,
        job_owner: str,
        finished_at: str,
        next_run_at: str,
        refresh_reason: str,
    ) -> SchedulerJobRecord | None:
        jobs = self._read_scheduler_jobs()
        existing = jobs.get(snapshot_key)
        if existing is None or existing.job_owner != job_owner:
            return None
        updated = existing.model_copy(
            update={
                "job_owner": None,
                "job_status": "idle",
                "lease_expires_at": None,
                "last_finished_at": finished_at,
                "last_success_at": finished_at,
                "last_error_code": None,
                "last_error_message": None,
                "consecutive_failures": 0,
                "next_run_at": next_run_at,
                "last_refresh_reason": refresh_reason,
                "updated_at": finished_at,
            }
        )
        jobs[snapshot_key] = updated
        self._write_scheduler_jobs(jobs)
        repository_logger.info(
            "Sentiment scheduler state updated"
            " | backend=file"
            f" | snapshot_key={snapshot_key}"
            " | transition=succeeded"
            f" | job_status={updated.job_status}"
            f" | next_run_at={updated.next_run_at}"
        )
        return updated

    def mark_scheduler_job_failed(
        self,
        snapshot_key: str,
        *,
        job_owner: str,
        finished_at: str,
        next_run_at: str,
        refresh_reason: str,
        error_code: str,
        error_message: str,
    ) -> SchedulerJobRecord | None:
        jobs = self._read_scheduler_jobs()
        existing = jobs.get(snapshot_key)
        if existing is None or existing.job_owner != job_owner:
            return None
        updated = existing.model_copy(
            update={
                "job_owner": None,
                "job_status": "cooldown",
                "lease_expires_at": None,
                "last_finished_at": finished_at,
                "last_failure_at": finished_at,
                "last_error_code": error_code,
                "last_error_message": error_message,
                "consecutive_failures": existing.consecutive_failures + 1,
                "next_run_at": next_run_at,
                "last_refresh_reason": refresh_reason,
                "updated_at": finished_at,
            }
        )
        jobs[snapshot_key] = updated
        self._write_scheduler_jobs(jobs)
        repository_logger.warning(
            "Sentiment scheduler state updated"
            " | backend=file"
            f" | snapshot_key={snapshot_key}"
            " | transition=failed"
            f" | job_status={updated.job_status}"
            f" | consecutive_failures={updated.consecutive_failures}"
            f" | next_run_at={updated.next_run_at}"
            f" | error_code={error_code}"
        )
        return updated

    def _read_scheduler_jobs(self) -> dict[str, SchedulerJobRecord]:
        if not self.scheduler_jobs_path.exists():
            return {}
        payload = json.loads(self.scheduler_jobs_path.read_text(encoding="utf-8"))
        return {
            str(snapshot_key): SchedulerJobRecord.model_validate(job_payload)
            for snapshot_key, job_payload in payload.items()
        }

    def _write_scheduler_jobs(self, jobs: dict[str, SchedulerJobRecord]) -> None:
        payload = {
            snapshot_key: job.model_dump(by_alias=True, mode="json")
            for snapshot_key, job in jobs.items()
        }
        self.scheduler_jobs_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


class PostgresSentimentRepository(SentimentRepository):
    def __init__(
        self,
        dsn: str,
        snapshot_table: str = "provider_sentiment_snapshots",
        raw_feed_table: str = "provider_sentiment_raw_feeds",
        scheduler_job_table: str = "provider_sentiment_scheduler_jobs",
    ) -> None:
        self.dsn = dsn
        self.snapshot_table = self._validate_table_name(snapshot_table)
        self.raw_feed_table = self._validate_table_name(raw_feed_table)
        self.scheduler_job_table = self._validate_table_name(scheduler_job_table)

    def save_snapshot(
        self,
        snapshot_key: str,
        payload: SentimentRequest,
        response: SentimentResponse,
    ) -> None:
        payload_json = json.dumps(
            response.model_dump(by_alias=True, mode="json"),
            ensure_ascii=False,
        )
        generated_at = _parse_zulu_datetime(response.freshness.generated_at)
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    cast(
                        Any,
                        (
                        f"INSERT INTO {self.snapshot_table} "
                        "(snapshot_key, symbol, chain, lookback_hours, include_narrative, "
                        "source_count, max_source_age_sec, generated_at, sentiment_score, "
                        "sentiment_label, trend_direction, volatility_signal, market_temperature, response_json) "
                        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb) "
                        "ON CONFLICT (snapshot_key) DO UPDATE SET "
                        "symbol = EXCLUDED.symbol, "
                        "chain = EXCLUDED.chain, "
                        "lookback_hours = EXCLUDED.lookback_hours, "
                        "include_narrative = EXCLUDED.include_narrative, "
                        "source_count = EXCLUDED.source_count, "
                        "max_source_age_sec = EXCLUDED.max_source_age_sec, "
                        "generated_at = EXCLUDED.generated_at, "
                        "sentiment_score = EXCLUDED.sentiment_score, "
                        "sentiment_label = EXCLUDED.sentiment_label, "
                        "trend_direction = EXCLUDED.trend_direction, "
                        "volatility_signal = EXCLUDED.volatility_signal, "
                        "market_temperature = EXCLUDED.market_temperature, "
                        "response_json = EXCLUDED.response_json, "
                        "updated_at = NOW()"
                        ),
                    ),
                    (
                        snapshot_key,
                        payload.symbol,
                        payload.chain,
                        payload.lookback_hours,
                        payload.include_narrative,
                        len(response.sources),
                        response.freshness.max_source_age_sec,
                        generated_at,
                        response.result.sentiment_score,
                        response.result.sentiment_label,
                        response.result.trend_direction,
                        response.result.volatility_signal,
                        response.result.market_temperature,
                        payload_json,
                    ),
                )
        repository_logger.info(
            "Sentiment snapshot persisted"
            " | backend=postgres"
            f" | snapshot_key={snapshot_key}"
            f" | symbol={payload.symbol}"
            f" | chain={payload.chain}"
            f" | table={self.snapshot_table}"
            f" | source_count={len(response.sources)}"
            f" | sentiment_score={response.result.sentiment_score}"
        )

    def load_snapshot(self, snapshot_key: str) -> SentimentResponse | None:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    cast(
                        Any,
                        (
                        f"SELECT response_json FROM {self.snapshot_table} "
                        "WHERE snapshot_key = %s"
                        ),
                    ),
                    (snapshot_key,),
                )
                row = cursor.fetchone()
        if row is None:
            return None
        payload = row[0]
        if isinstance(payload, str):
            payload = json.loads(payload)
        return SentimentResponse.model_validate(payload)

    def append_raw_feed_records(
        self,
        snapshot_key: str,
        payload: SentimentRequest,
        records: list[RawFeedRecord],
    ) -> None:
        if not records:
            return
        with self._connect() as connection:
            with connection.cursor() as cursor:
                for record in records:
                    payload_json = json.dumps(
                        record.model_dump(by_alias=True, mode="json"),
                        ensure_ascii=False,
                    )
                    fetched_at = record.fetched_at
                    source_timestamp = record.source_timestamp
                    cursor.execute(
                        cast(
                            Any,
                            (
                            f"INSERT INTO {self.raw_feed_table} "
                            "(snapshot_key, symbol, chain, source_name, success, fetched_at, source_timestamp, "
                            "latency_ms, retry_count, timeout_ms, http_status, payload_hash, error_code, error_message, payload_json) "
                            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)"
                            ),
                        ),
                        (
                            snapshot_key,
                            payload.symbol,
                            payload.chain,
                            record.source_name,
                            record.success,
                            _parse_zulu_datetime(fetched_at) if fetched_at else None,
                            _parse_zulu_datetime(source_timestamp) if source_timestamp else None,
                            record.latency_ms,
                            record.retry_count,
                            record.timeout_ms,
                            record.http_status,
                            record.payload_hash,
                            record.error_code,
                            record.error_message,
                            payload_json,
                        ),
                    )
        repository_logger.info(
            "Sentiment raw feeds persisted"
            " | backend=postgres"
            f" | snapshot_key={snapshot_key}"
            f" | symbol={payload.symbol}"
            f" | chain={payload.chain}"
            f" | table={self.raw_feed_table}"
            f" | record_count={len(records)}"
        )

    def try_acquire_scheduler_job(
        self,
        snapshot_key: str,
        payload: SentimentRequest,
        *,
        job_owner: str,
        lease_expires_at: str,
        started_at: str,
        refresh_reason: str,
    ) -> SchedulerJobRecord | None:
        started_at_dt = _parse_zulu_datetime(started_at)
        lease_expires_at_dt = _parse_zulu_datetime(lease_expires_at)
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    cast(
                        Any,
                        (
                            f"INSERT INTO {self.scheduler_job_table} "
                            "(snapshot_key, symbol, chain, lookback_hours, include_narrative, job_owner, "
                            "job_status, lease_expires_at, last_started_at, last_refresh_reason, updated_at) "
                            "VALUES (%s, %s, %s, %s, %s, %s, 'running', %s, %s, %s, %s) "
                            "ON CONFLICT (snapshot_key) DO UPDATE SET "
                            "symbol = EXCLUDED.symbol, "
                            "chain = EXCLUDED.chain, "
                            "lookback_hours = EXCLUDED.lookback_hours, "
                            "include_narrative = EXCLUDED.include_narrative, "
                            "job_owner = EXCLUDED.job_owner, "
                            "job_status = EXCLUDED.job_status, "
                            "lease_expires_at = EXCLUDED.lease_expires_at, "
                            "last_started_at = EXCLUDED.last_started_at, "
                            "last_refresh_reason = EXCLUDED.last_refresh_reason, "
                            "updated_at = EXCLUDED.updated_at "
                            f"WHERE ({self.scheduler_job_table}.lease_expires_at IS NULL "
                            f"OR {self.scheduler_job_table}.lease_expires_at <= %s "
                            f"OR {self.scheduler_job_table}.job_owner = %s) "
                            f"AND ({self.scheduler_job_table}.next_run_at IS NULL "
                            f"OR {self.scheduler_job_table}.next_run_at <= %s) "
                            "RETURNING snapshot_key, symbol, chain, lookback_hours, include_narrative, "
                            "job_owner, job_status, lease_expires_at, last_started_at, last_finished_at, "
                            "last_success_at, last_failure_at, last_error_code, last_error_message, "
                            "consecutive_failures, next_run_at, last_refresh_reason, updated_at"
                        ),
                    ),
                    (
                        snapshot_key,
                        payload.symbol,
                        payload.chain,
                        payload.lookback_hours,
                        payload.include_narrative,
                        job_owner,
                        lease_expires_at_dt,
                        started_at_dt,
                        refresh_reason,
                        started_at_dt,
                        started_at_dt,
                        job_owner,
                        started_at_dt,
                    ),
                )
                row = cursor.fetchone()
        if row is None:
            repository_logger.debug(
                "Sentiment scheduler state update skipped"
                " | backend=postgres"
                f" | snapshot_key={snapshot_key}"
                " | transition=acquire_blocked"
                f" | table={self.scheduler_job_table}"
                f" | job_owner={job_owner}"
            )
            return None
        record = _scheduler_job_row_to_model(cast(tuple[object, ...], row))
        repository_logger.info(
            "Sentiment scheduler state updated"
            " | backend=postgres"
            f" | snapshot_key={snapshot_key}"
            " | transition=acquired"
            f" | table={self.scheduler_job_table}"
            f" | job_status={record.job_status}"
            f" | job_owner={record.job_owner}"
            f" | next_run_at={record.next_run_at}"
        )
        return record

    def mark_scheduler_job_succeeded(
        self,
        snapshot_key: str,
        *,
        job_owner: str,
        finished_at: str,
        next_run_at: str,
        refresh_reason: str,
    ) -> SchedulerJobRecord | None:
        finished_at_dt = _parse_zulu_datetime(finished_at)
        next_run_at_dt = _parse_zulu_datetime(next_run_at)
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    cast(
                        Any,
                        (
                            f"UPDATE {self.scheduler_job_table} SET "
                            "job_owner = NULL, "
                            "job_status = 'idle', "
                            "lease_expires_at = NULL, "
                            "last_finished_at = %s, "
                            "last_success_at = %s, "
                            "last_error_code = NULL, "
                            "last_error_message = NULL, "
                            "consecutive_failures = 0, "
                            "next_run_at = %s, "
                            "last_refresh_reason = %s, "
                            "updated_at = %s "
                            "WHERE snapshot_key = %s AND job_owner = %s "
                            "RETURNING snapshot_key, symbol, chain, lookback_hours, include_narrative, "
                            "job_owner, job_status, lease_expires_at, last_started_at, last_finished_at, "
                            "last_success_at, last_failure_at, last_error_code, last_error_message, "
                            "consecutive_failures, next_run_at, last_refresh_reason, updated_at"
                        ),
                    ),
                    (
                        finished_at_dt,
                        finished_at_dt,
                        next_run_at_dt,
                        refresh_reason,
                        finished_at_dt,
                        snapshot_key,
                        job_owner,
                    ),
                )
                row = cursor.fetchone()
        if row is None:
            repository_logger.debug(
                "Sentiment scheduler state update skipped"
                " | backend=postgres"
                f" | snapshot_key={snapshot_key}"
                " | transition=succeed_miss"
                f" | table={self.scheduler_job_table}"
                f" | job_owner={job_owner}"
            )
            return None
        record = _scheduler_job_row_to_model(cast(tuple[object, ...], row))
        repository_logger.info(
            "Sentiment scheduler state updated"
            " | backend=postgres"
            f" | snapshot_key={snapshot_key}"
            " | transition=succeeded"
            f" | table={self.scheduler_job_table}"
            f" | job_status={record.job_status}"
            f" | next_run_at={record.next_run_at}"
        )
        return record

    def mark_scheduler_job_failed(
        self,
        snapshot_key: str,
        *,
        job_owner: str,
        finished_at: str,
        next_run_at: str,
        refresh_reason: str,
        error_code: str,
        error_message: str,
    ) -> SchedulerJobRecord | None:
        finished_at_dt = _parse_zulu_datetime(finished_at)
        next_run_at_dt = _parse_zulu_datetime(next_run_at)
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    cast(
                        Any,
                        (
                            f"UPDATE {self.scheduler_job_table} SET "
                            "job_owner = NULL, "
                            "job_status = 'cooldown', "
                            "lease_expires_at = NULL, "
                            "last_finished_at = %s, "
                            "last_failure_at = %s, "
                            "last_error_code = %s, "
                            "last_error_message = %s, "
                            "consecutive_failures = consecutive_failures + 1, "
                            "next_run_at = %s, "
                            "last_refresh_reason = %s, "
                            "updated_at = %s "
                            "WHERE snapshot_key = %s AND job_owner = %s "
                            "RETURNING snapshot_key, symbol, chain, lookback_hours, include_narrative, "
                            "job_owner, job_status, lease_expires_at, last_started_at, last_finished_at, "
                            "last_success_at, last_failure_at, last_error_code, last_error_message, "
                            "consecutive_failures, next_run_at, last_refresh_reason, updated_at"
                        ),
                    ),
                    (
                        finished_at_dt,
                        finished_at_dt,
                        error_code,
                        error_message,
                        next_run_at_dt,
                        refresh_reason,
                        finished_at_dt,
                        snapshot_key,
                        job_owner,
                    ),
                )
                row = cursor.fetchone()
        if row is None:
            repository_logger.debug(
                "Sentiment scheduler state update skipped"
                " | backend=postgres"
                f" | snapshot_key={snapshot_key}"
                " | transition=fail_miss"
                f" | table={self.scheduler_job_table}"
                f" | job_owner={job_owner}"
            )
            return None
        record = _scheduler_job_row_to_model(cast(tuple[object, ...], row))
        repository_logger.warning(
            "Sentiment scheduler state updated"
            " | backend=postgres"
            f" | snapshot_key={snapshot_key}"
            " | transition=failed"
            f" | table={self.scheduler_job_table}"
            f" | job_status={record.job_status}"
            f" | consecutive_failures={record.consecutive_failures}"
            f" | next_run_at={record.next_run_at}"
            f" | error_code={error_code}"
        )
        return record

    def _connect(self):
        psycopg = _load_psycopg()
        return psycopg.connect(self.dsn, autocommit=True)

    @staticmethod
    def _validate_table_name(table_name: str) -> str:
        if not TABLE_NAME_PATTERN.fullmatch(table_name):
            raise ValueError(f"Invalid Postgres table name: {table_name}")
        return table_name


def _load_psycopg():
    import psycopg

    return psycopg


@lru_cache
def get_sentiment_repository() -> SentimentRepository:
    settings = get_settings()
    if settings.sentiment_repository_backend == "postgres":
        if not settings.sentiment_postgres_dsn:
            raise ValueError(
                "SENTIMENT_POSTGRES_DSN must be configured when "
                "SENTIMENT_REPOSITORY_BACKEND=postgres"
            )
        return PostgresSentimentRepository(
            dsn=settings.sentiment_postgres_dsn,
            snapshot_table=settings.sentiment_postgres_snapshot_table,
            raw_feed_table=settings.sentiment_postgres_raw_feed_table,
            scheduler_job_table=settings.sentiment_postgres_scheduler_job_table,
        )
    return FileBackedSentimentRepository(
        resolve_provider_path(settings.sentiment_storage_dir)
    )