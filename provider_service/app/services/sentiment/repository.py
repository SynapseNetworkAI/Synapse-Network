from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from functools import lru_cache
from pathlib import Path
from typing import Any

from datetime import datetime

from app.core.config import get_settings, resolve_provider_path
from app.schemas.sentiment import SentimentRequest, SentimentResponse


TABLE_NAME_PATTERN = re.compile(r"^[A-Za-z_]\w*$")


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
        records: list[dict[str, Any]],
    ) -> None:
        raise NotImplementedError


def _parse_zulu_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class FileBackedSentimentRepository(SentimentRepository):
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir
        self.snapshots_dir = self.base_dir / "snapshots"
        self.raw_feeds_dir = self.base_dir / "raw_feeds"
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
        payload = response.model_dump(by_alias=True, mode="json")
        snapshot_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
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
        records: list[dict[str, Any]],
    ) -> None:
        _ = payload
        if not records:
            return
        raw_feed_path = self.raw_feeds_dir / f"{snapshot_key}.jsonl"
        with raw_feed_path.open("a", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record, ensure_ascii=False))
                handle.write("\n")


class PostgresSentimentRepository(SentimentRepository):
    def __init__(
        self,
        dsn: str,
        snapshot_table: str = "provider_sentiment_snapshots",
        raw_feed_table: str = "provider_sentiment_raw_feeds",
    ) -> None:
        self.dsn = dsn
        self.snapshot_table = self._validate_table_name(snapshot_table)
        self.raw_feed_table = self._validate_table_name(raw_feed_table)
        self._ensure_tables()

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

    def load_snapshot(self, snapshot_key: str) -> SentimentResponse | None:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    (
                        f"SELECT response_json FROM {self.snapshot_table} "
                        "WHERE snapshot_key = %s"
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
        records: list[dict[str, Any]],
    ) -> None:
        if not records:
            return
        with self._connect() as connection:
            with connection.cursor() as cursor:
                for record in records:
                    payload_json = json.dumps(record, ensure_ascii=False)
                    fetched_at = record.get("fetchedAt")
                    source_timestamp = record.get("sourceTimestamp")
                    cursor.execute(
                        (
                            f"INSERT INTO {self.raw_feed_table} "
                            "(snapshot_key, symbol, chain, source_name, success, fetched_at, source_timestamp, "
                            "latency_ms, retry_count, timeout_ms, http_status, payload_hash, error_code, error_message, payload_json) "
                            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)"
                        ),
                        (
                            snapshot_key,
                            payload.symbol,
                            payload.chain,
                            record.get("sourceName"),
                            bool(record.get("success")),
                            _parse_zulu_datetime(fetched_at) if fetched_at else None,
                            _parse_zulu_datetime(source_timestamp) if source_timestamp else None,
                            record.get("latencyMs"),
                            record.get("retryCount") or 0,
                            record.get("timeoutMs"),
                            record.get("httpStatus"),
                            record.get("payloadHash"),
                            record.get("errorCode"),
                            record.get("errorMessage"),
                            payload_json,
                        ),
                    )

    def _ensure_tables(self) -> None:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    CREATE TABLE IF NOT EXISTS {self.snapshot_table} (
                        snapshot_key TEXT PRIMARY KEY,
                        symbol TEXT NOT NULL DEFAULT '',
                        chain TEXT NOT NULL DEFAULT 'market-wide',
                        lookback_hours INTEGER NOT NULL DEFAULT 24,
                        include_narrative BOOLEAN NOT NULL DEFAULT TRUE,
                        source_count INTEGER NOT NULL DEFAULT 0,
                        max_source_age_sec INTEGER NOT NULL DEFAULT 0,
                        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        sentiment_score INTEGER NOT NULL DEFAULT 0,
                        sentiment_label TEXT NOT NULL DEFAULT 'neutral',
                        trend_direction TEXT NOT NULL DEFAULT 'sideways',
                        volatility_signal TEXT NOT NULL DEFAULT 'medium',
                        market_temperature TEXT NOT NULL DEFAULT '',
                        response_json JSONB NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
                cursor.execute(
                    f"""
                    CREATE TABLE IF NOT EXISTS {self.raw_feed_table} (
                        id BIGSERIAL PRIMARY KEY,
                        snapshot_key TEXT NOT NULL,
                        symbol TEXT NOT NULL DEFAULT '',
                        chain TEXT NOT NULL DEFAULT 'market-wide',
                        source_name TEXT,
                        success BOOLEAN NOT NULL DEFAULT FALSE,
                        fetched_at TIMESTAMPTZ,
                        source_timestamp TIMESTAMPTZ,
                        latency_ms INTEGER,
                        retry_count INTEGER NOT NULL DEFAULT 0,
                        timeout_ms INTEGER,
                        http_status INTEGER,
                        payload_hash TEXT,
                        error_code TEXT,
                        error_message TEXT,
                        payload_json JSONB NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
                cursor.execute(
                    f"""
                    CREATE INDEX IF NOT EXISTS {self.raw_feed_table}_snapshot_key_idx
                    ON {self.raw_feed_table} (snapshot_key, created_at DESC)
                    """
                )
                cursor.execute(
                    f"""
                    CREATE INDEX IF NOT EXISTS {self.raw_feed_table}_source_name_idx
                    ON {self.raw_feed_table} (source_name, created_at DESC)
                    """
                )
                cursor.execute(
                    f"""
                    CREATE INDEX IF NOT EXISTS {self.snapshot_table}_symbol_chain_idx
                    ON {self.snapshot_table} (symbol, chain, updated_at DESC)
                    """
                )
                for statement in self._snapshot_alter_statements():
                    cursor.execute(statement)
                for statement in self._raw_feed_alter_statements():
                    cursor.execute(statement)

    def _connect(self):
        psycopg = _load_psycopg()
        return psycopg.connect(self.dsn, autocommit=True)

    @staticmethod
    def _validate_table_name(table_name: str) -> str:
        if not TABLE_NAME_PATTERN.fullmatch(table_name):
            raise ValueError(f"Invalid Postgres table name: {table_name}")
        return table_name

    def _snapshot_alter_statements(self) -> list[str]:
        return [
            f"ALTER TABLE {self.snapshot_table} ADD COLUMN IF NOT EXISTS symbol TEXT NOT NULL DEFAULT ''",
            f"ALTER TABLE {self.snapshot_table} ADD COLUMN IF NOT EXISTS chain TEXT NOT NULL DEFAULT 'market-wide'",
            f"ALTER TABLE {self.snapshot_table} ADD COLUMN IF NOT EXISTS lookback_hours INTEGER NOT NULL DEFAULT 24",
            f"ALTER TABLE {self.snapshot_table} ADD COLUMN IF NOT EXISTS include_narrative BOOLEAN NOT NULL DEFAULT TRUE",
            f"ALTER TABLE {self.snapshot_table} ADD COLUMN IF NOT EXISTS source_count INTEGER NOT NULL DEFAULT 0",
            f"ALTER TABLE {self.snapshot_table} ADD COLUMN IF NOT EXISTS max_source_age_sec INTEGER NOT NULL DEFAULT 0",
            f"ALTER TABLE {self.snapshot_table} ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
            f"ALTER TABLE {self.snapshot_table} ADD COLUMN IF NOT EXISTS sentiment_score INTEGER NOT NULL DEFAULT 0",
            f"ALTER TABLE {self.snapshot_table} ADD COLUMN IF NOT EXISTS sentiment_label TEXT NOT NULL DEFAULT 'neutral'",
            f"ALTER TABLE {self.snapshot_table} ADD COLUMN IF NOT EXISTS trend_direction TEXT NOT NULL DEFAULT 'sideways'",
            f"ALTER TABLE {self.snapshot_table} ADD COLUMN IF NOT EXISTS volatility_signal TEXT NOT NULL DEFAULT 'medium'",
            f"ALTER TABLE {self.snapshot_table} ADD COLUMN IF NOT EXISTS market_temperature TEXT NOT NULL DEFAULT ''",
            f"ALTER TABLE {self.snapshot_table} ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
        ]

    def _raw_feed_alter_statements(self) -> list[str]:
        return [
            f"ALTER TABLE {self.raw_feed_table} ADD COLUMN IF NOT EXISTS symbol TEXT NOT NULL DEFAULT ''",
            f"ALTER TABLE {self.raw_feed_table} ADD COLUMN IF NOT EXISTS chain TEXT NOT NULL DEFAULT 'market-wide'",
            f"ALTER TABLE {self.raw_feed_table} ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMPTZ",
            f"ALTER TABLE {self.raw_feed_table} ADD COLUMN IF NOT EXISTS source_timestamp TIMESTAMPTZ",
            f"ALTER TABLE {self.raw_feed_table} ADD COLUMN IF NOT EXISTS latency_ms INTEGER",
            f"ALTER TABLE {self.raw_feed_table} ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0",
            f"ALTER TABLE {self.raw_feed_table} ADD COLUMN IF NOT EXISTS timeout_ms INTEGER",
            f"ALTER TABLE {self.raw_feed_table} ADD COLUMN IF NOT EXISTS http_status INTEGER",
            f"ALTER TABLE {self.raw_feed_table} ADD COLUMN IF NOT EXISTS payload_hash TEXT",
            f"ALTER TABLE {self.raw_feed_table} ADD COLUMN IF NOT EXISTS error_code TEXT",
            f"ALTER TABLE {self.raw_feed_table} ADD COLUMN IF NOT EXISTS error_message TEXT",
        ]


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
        )
    return FileBackedSentimentRepository(
        resolve_provider_path(settings.sentiment_storage_dir)
    )