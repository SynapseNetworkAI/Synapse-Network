from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from functools import lru_cache
from pathlib import Path
from typing import Any, cast

from app.core.config import get_settings, resolve_provider_path
from app.core.log_config import logger
from app.schemas.protocol_fundamental_brief import (
    ProtocolFundamentalBriefRequest,
    ProtocolFundamentalBriefResponse,
)
from app.services.protocol_fundamental_brief.domain import (
    ProtocolBriefRawFeedRecord,
    ProtocolBriefSnapshotRecord,
    parse_zulu_datetime,
    to_zulu,
)


TABLE_NAME_PATTERN = re.compile(r"^[A-Za-z_]\w*$")
repository_logger = logger.bind(component="protocol_brief_repository")


class ProtocolBriefRepository(ABC):
    @abstractmethod
    def save_snapshot(self, record: ProtocolBriefSnapshotRecord) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_snapshot(self, brief_key: str) -> ProtocolBriefSnapshotRecord | None:
        raise NotImplementedError

    @abstractmethod
    def append_raw_feed_records(self, records: list[ProtocolBriefRawFeedRecord]) -> None:
        raise NotImplementedError


class FileBackedProtocolBriefRepository(ProtocolBriefRepository):
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir
        self.snapshots_dir = self.base_dir / "snapshots"
        self.raw_feeds_dir = self.base_dir / "raw_feeds"
        self.snapshots_dir.mkdir(parents=True, exist_ok=True)
        self.raw_feeds_dir.mkdir(parents=True, exist_ok=True)

    def save_snapshot(self, record: ProtocolBriefSnapshotRecord) -> None:
        snapshot_path = self.snapshots_dir / f"{record.brief_key}.json"
        snapshot_path.write_text(
            json.dumps(
                record.model_dump(mode="json", by_alias=True),
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        repository_logger.info(
            "Protocol brief snapshot persisted"
            " | backend=file"
            f" | brief_key={record.brief_key}"
            f" | protocol={record.request.protocol}"
            f" | chain={record.request.chain or 'all'}"
            f" | source_count={len(record.response.sources)}"
        )

    def load_snapshot(self, brief_key: str) -> ProtocolBriefSnapshotRecord | None:
        snapshot_path = self.snapshots_dir / f"{brief_key}.json"
        if not snapshot_path.exists():
            return None
        payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
        return ProtocolBriefSnapshotRecord.model_validate(payload)

    def append_raw_feed_records(self, records: list[ProtocolBriefRawFeedRecord]) -> None:
        if not records:
            return
        raw_feed_path = self.raw_feeds_dir / f"{records[0].brief_key}.jsonl"
        with raw_feed_path.open("a", encoding="utf-8") as handle:
            for record in records:
                handle.write(
                    json.dumps(
                        record.model_dump(mode="json", by_alias=True),
                        ensure_ascii=False,
                    )
                )
                handle.write("\n")
        repository_logger.info(
            "Protocol brief raw feeds persisted"
            " | backend=file"
            f" | brief_key={records[0].brief_key}"
            f" | protocol={records[0].protocol}"
            f" | record_count={len(records)}"
        )


class PostgresProtocolBriefRepository(ProtocolBriefRepository):
    def __init__(
        self,
        dsn: str,
        snapshot_table: str = "provider_protocol_briefs",
        raw_feed_table: str = "provider_protocol_brief_raw_feeds",
    ) -> None:
        self.dsn = dsn
        self.snapshot_table = self._validate_table_name(snapshot_table)
        self.raw_feed_table = self._validate_table_name(raw_feed_table)

    def save_snapshot(self, record: ProtocolBriefSnapshotRecord) -> None:
        request = record.request
        response = record.response
        response_json = json.dumps(response.model_dump(by_alias=True, mode="json"), ensure_ascii=False)
        peer_set_json = json.dumps(request.peer_set, ensure_ascii=False)
        generated_at = parse_zulu_datetime(response.freshness.generated_at)
        source_generated_at = (
            parse_zulu_datetime(record.source_generated_at)
            if record.source_generated_at is not None
            else None
        )
        expires_at = (
            parse_zulu_datetime(record.expires_at)
            if record.expires_at is not None
            else None
        )
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    cast(
                        Any,
                        (
                            f"INSERT INTO {self.snapshot_table} "
                            "(brief_key, protocol, chain, lookback_days, peer_set_json, source_count, "
                            "max_source_age_sec, generated_at, source_generated_at, expires_at, response_json) "
                            "VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s::jsonb) "
                            "ON CONFLICT (brief_key) DO UPDATE SET "
                            "protocol = EXCLUDED.protocol, "
                            "chain = EXCLUDED.chain, "
                            "lookback_days = EXCLUDED.lookback_days, "
                            "peer_set_json = EXCLUDED.peer_set_json, "
                            "source_count = EXCLUDED.source_count, "
                            "max_source_age_sec = EXCLUDED.max_source_age_sec, "
                            "generated_at = EXCLUDED.generated_at, "
                            "source_generated_at = EXCLUDED.source_generated_at, "
                            "expires_at = EXCLUDED.expires_at, "
                            "response_json = EXCLUDED.response_json, "
                            "updated_at = NOW()"
                        ),
                    ),
                    (
                        record.brief_key,
                        request.protocol,
                        request.chain or "",
                        request.lookback_days,
                        peer_set_json,
                        len(response.sources),
                        response.freshness.max_source_age_sec,
                        generated_at,
                        source_generated_at,
                        expires_at,
                        response_json,
                    ),
                )
        repository_logger.info(
            "Protocol brief snapshot persisted"
            " | backend=postgres"
            f" | brief_key={record.brief_key}"
            f" | protocol={request.protocol}"
            f" | chain={request.chain or 'all'}"
            f" | table={self.snapshot_table}"
            f" | source_count={len(response.sources)}"
        )

    def load_snapshot(self, brief_key: str) -> ProtocolBriefSnapshotRecord | None:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    cast(
                        Any,
                        (
                            f"SELECT protocol, chain, lookback_days, peer_set_json, generated_at, "
                            f"source_generated_at, expires_at, response_json FROM {self.snapshot_table} "
                            "WHERE brief_key = %s"
                        ),
                    ),
                    (brief_key,),
                )
                row = cursor.fetchone()
        if row is None:
            return None
        peer_set_payload = row[3]
        response_payload = row[7]
        if isinstance(peer_set_payload, str):
            peer_set_payload = json.loads(peer_set_payload)
        if isinstance(response_payload, str):
            response_payload = json.loads(response_payload)
        request = ProtocolFundamentalBriefRequest.model_validate(
            {
                "protocol": str(row[0]),
                "chain": str(row[1]) or None,
                "lookback_days": cast(int, row[2]),
                "peer_set": peer_set_payload,
            }
        )
        response = ProtocolFundamentalBriefResponse.model_validate(response_payload)
        return ProtocolBriefSnapshotRecord(
            brief_key=brief_key,
            request=request,
            response=response,
            source_generated_at=None if row[5] is None else to_zulu(row[5]),
            expires_at=None if row[6] is None else to_zulu(row[6]),
        )

    def append_raw_feed_records(self, records: list[ProtocolBriefRawFeedRecord]) -> None:
        if not records:
            return
        with self._connect() as connection:
            with connection.cursor() as cursor:
                for record in records:
                    payload_json = json.dumps(record.model_dump(mode="json"), ensure_ascii=False)
                    cursor.execute(
                        cast(
                            Any,
                            (
                                f"INSERT INTO {self.raw_feed_table} "
                                "(brief_key, protocol, chain, source_name, success, fetched_at, source_timestamp, "
                                "latency_ms, retry_count, timeout_ms, http_status, payload_hash, error_code, error_message, payload_json) "
                                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)"
                            ),
                        ),
                        (
                            record.brief_key,
                            record.protocol,
                            record.chain or "",
                            record.source_name,
                            record.success,
                            parse_zulu_datetime(record.fetched_at),
                            parse_zulu_datetime(record.source_timestamp)
                            if record.source_timestamp is not None
                            else None,
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
            "Protocol brief raw feeds persisted"
            " | backend=postgres"
            f" | brief_key={records[0].brief_key}"
            f" | protocol={records[0].protocol}"
            f" | table={self.raw_feed_table}"
            f" | record_count={len(records)}"
        )

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
def get_protocol_brief_repository() -> ProtocolBriefRepository:
    settings = get_settings()
    if settings.protocol_brief_repository_backend == "postgres":
        if not settings.protocol_brief_postgres_dsn:
            raise ValueError(
                "PROTOCOL_BRIEF_POSTGRES_DSN must be configured when "
                "PROTOCOL_BRIEF_REPOSITORY_BACKEND=postgres"
            )
        return PostgresProtocolBriefRepository(
            dsn=settings.protocol_brief_postgres_dsn,
            snapshot_table=settings.protocol_brief_postgres_snapshot_table,
            raw_feed_table=settings.protocol_brief_postgres_raw_feed_table,
        )
    return FileBackedProtocolBriefRepository(
        resolve_provider_path(settings.protocol_brief_storage_dir)
    )