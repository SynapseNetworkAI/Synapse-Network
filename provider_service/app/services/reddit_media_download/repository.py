from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any, cast

from app.core.config import get_settings
from app.core.log_config import logger
from app.schemas.reddit_media_download import RedditMediaDownloadResponse
from app.services.reddit_media_download.domain import (
    RedditMediaAssetRecord,
    parse_zulu_datetime,
    to_zulu,
)
from app.services.smart_contract_audit.domain import ProviderInvocationRecord


TABLE_NAME_PATTERN = re.compile(r"^[A-Za-z_]\w*$")
repository_logger = logger.bind(component="reddit_media_download_repository")


class RedditMediaDownloadRepository(ABC):
    @abstractmethod
    def save_asset(self, record: RedditMediaAssetRecord) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_asset(self, asset_key: str) -> RedditMediaAssetRecord | None:
        raise NotImplementedError

    @abstractmethod
    def append_invocation(self, record: ProviderInvocationRecord) -> None:
        raise NotImplementedError


class InMemoryRedditMediaDownloadRepository(RedditMediaDownloadRepository):
    def __init__(self) -> None:
        self.assets: dict[str, RedditMediaAssetRecord] = {}
        self.invocations: list[ProviderInvocationRecord] = []

    def save_asset(self, record: RedditMediaAssetRecord) -> None:
        self.assets[record.asset_key] = record

    def load_asset(self, asset_key: str) -> RedditMediaAssetRecord | None:
        return self.assets.get(asset_key)

    def append_invocation(self, record: ProviderInvocationRecord) -> None:
        self.invocations.append(record)


class PostgresRedditMediaDownloadRepository(RedditMediaDownloadRepository):
    def __init__(self, dsn: str, asset_table: str, invocation_table: str) -> None:
        self.dsn = dsn
        self.asset_table = self._validate_table_name(asset_table)
        self.invocation_table = self._validate_table_name(invocation_table)

    def save_asset(self, record: RedditMediaAssetRecord) -> None:
        payload = record.request
        response = record.response
        result = response.result
        media = result.media
        response_json = json.dumps(response.model_dump(by_alias=True, mode="json"), ensure_ascii=False)
        expires_at = parse_zulu_datetime(record.expires_at) if record.expires_at else None

        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    cast(
                        Any,
                        (
                            f"INSERT INTO {self.asset_table} "
                            "(asset_key, post_id, post_url, subreddit, author, created_utc, media_type, storage_backend, storage_key, mime_type, "
                            "size_bytes, sha256, download_status, generated_at, expires_at, response_json) "
                            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb) "
                            "ON CONFLICT (asset_key) DO UPDATE SET "
                            "post_id=EXCLUDED.post_id, "
                            "post_url=EXCLUDED.post_url, "
                            "subreddit=EXCLUDED.subreddit, "
                            "author=EXCLUDED.author, "
                            "created_utc=EXCLUDED.created_utc, "
                            "media_type=EXCLUDED.media_type, "
                            "storage_backend=EXCLUDED.storage_backend, "
                            "storage_key=EXCLUDED.storage_key, "
                            "mime_type=EXCLUDED.mime_type, "
                            "size_bytes=EXCLUDED.size_bytes, "
                            "sha256=EXCLUDED.sha256, "
                            "download_status=EXCLUDED.download_status, "
                            "generated_at=EXCLUDED.generated_at, "
                            "expires_at=EXCLUDED.expires_at, "
                            "response_json=EXCLUDED.response_json, "
                            "updated_at=NOW()"
                        ),
                    ),
                    (
                        record.asset_key,
                        result.post_meta.post_id,
                        payload.post_url,
                        payload.max_file_size_mb,
                        result.post_meta.subreddit,
                        result.post_meta.author,
                        result.post_meta.created_utc,
                        result.media_type,
                        media.storage_backend,
                        media.storage_key,
                        media.mime_type,
                        media.size_bytes,
                        media.sha256,
                        result.status,
                        parse_zulu_datetime(response.freshness.generated_at),
                        expires_at,
                        response_json,
                    ),
                )

    def load_asset(self, asset_key: str) -> RedditMediaAssetRecord | None:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    cast(
                        Any,
                        (
                            f"SELECT post_url, max_file_size_mb, response_json, expires_at "
                            f"FROM {self.asset_table} WHERE asset_key = %s"
                        ),
                    ),
                    (asset_key,),
                )
                row = cursor.fetchone()
        if row is None:
            return None
        payload = row[2]
        if isinstance(payload, str):
            payload = json.loads(payload)
        response = RedditMediaDownloadResponse.model_validate(payload, by_alias=True, by_name=True)
        return RedditMediaAssetRecord(
            asset_key=asset_key,
            request={
                "postUrl": row[0],
                "maxFileSizeMb": row[1],
            },
            response=response,
            expires_at=None if row[3] is None else to_zulu(row[3]),
        )

    def append_invocation(self, record: ProviderInvocationRecord) -> None:
        input_payload = json.dumps(record.input_payload, ensure_ascii=False)
        observability_json = json.dumps(record.observability_payload, ensure_ascii=False)
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    cast(
                        Any,
                        (
                            f"INSERT INTO {self.invocation_table} "
                            "(invocation_id, service_id, request_id, gateway_request_id, caller_type, "
                            "input_payload, response_status, error_code, upstream_status, latency_ms, cache_hit, observability_json) "
                            "VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s::jsonb)"
                        ),
                    ),
                    (
                        record.invocation_id,
                        record.service_id,
                        record.request_id,
                        record.gateway_request_id,
                        record.caller_type,
                        input_payload,
                        record.response_status,
                        record.error_code,
                        record.upstream_status,
                        record.latency_ms,
                        record.cache_hit,
                        observability_json,
                    ),
                )

    def _connect(self):
        import psycopg

        return psycopg.connect(self.dsn, autocommit=True)

    @staticmethod
    def _validate_table_name(table_name: str) -> str:
        if not TABLE_NAME_PATTERN.fullmatch(table_name):
            raise ValueError(f"Invalid Postgres table name: {table_name}")
        return table_name


@lru_cache
def get_reddit_media_download_repository() -> RedditMediaDownloadRepository:
    settings = get_settings()
    if not settings.provider_service_postgres_dsn:
        repository_logger.warning(
            "Reddit media download repository running in-memory because PROVIDER_SERVICE_POSTGRES_DSN is not configured"
        )
        return InMemoryRedditMediaDownloadRepository()
    return PostgresRedditMediaDownloadRepository(
        dsn=settings.provider_service_postgres_dsn,
        asset_table=settings.reddit_media_postgres_asset_table,
        invocation_table=settings.provider_api_invocation_table,
    )


def asset_expiry(ttl_s: int) -> str:
    return to_zulu(datetime.now(UTC) + timedelta(seconds=max(0, ttl_s)))
