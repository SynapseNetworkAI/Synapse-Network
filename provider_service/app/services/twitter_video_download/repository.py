from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any, cast

from app.core.config import get_settings
from app.core.log_config import logger
from app.schemas.twitter_video_download import TwitterVideoDownloadResponse
from app.services.smart_contract_audit.domain import ProviderInvocationRecord
from app.services.twitter_video_download.domain import (
    TwitterVideoAssetRecord,
    parse_zulu_datetime,
    to_zulu,
)


TABLE_NAME_PATTERN = re.compile(r"^[A-Za-z_]\w*$")
repository_logger = logger.bind(component="twitter_video_download_repository")


class TwitterVideoDownloadRepository(ABC):
    @abstractmethod
    def save_asset(self, record: TwitterVideoAssetRecord) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_asset(self, asset_key: str) -> TwitterVideoAssetRecord | None:
        raise NotImplementedError

    @abstractmethod
    def append_invocation(self, record: ProviderInvocationRecord) -> None:
        raise NotImplementedError


class InMemoryTwitterVideoDownloadRepository(TwitterVideoDownloadRepository):
    def __init__(self) -> None:
        self.assets: dict[str, TwitterVideoAssetRecord] = {}
        self.invocations: list[ProviderInvocationRecord] = []

    def save_asset(self, record: TwitterVideoAssetRecord) -> None:
        self.assets[record.asset_key] = record

    def load_asset(self, asset_key: str) -> TwitterVideoAssetRecord | None:
        return self.assets.get(asset_key)

    def append_invocation(self, record: ProviderInvocationRecord) -> None:
        self.invocations.append(record)


class PostgresTwitterVideoDownloadRepository(TwitterVideoDownloadRepository):
    def __init__(
        self,
        dsn: str,
        asset_table: str,
        invocation_table: str,
    ) -> None:
        self.dsn = dsn
        self.asset_table = self._validate_table_name(asset_table)
        self.invocation_table = self._validate_table_name(invocation_table)

    def save_asset(self, record: TwitterVideoAssetRecord) -> None:
        payload = record.request
        response = record.response
        response_json = json.dumps(response.model_dump(by_alias=True, mode="json"), ensure_ascii=False)
        result = response.result
        video = result.video
        expires_at = parse_zulu_datetime(record.expires_at) if record.expires_at else None
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    cast(
                        Any,
                        (
                            f"INSERT INTO {self.asset_table} "
                            "(asset_key, tweet_id, post_url, storage_backend, storage_key, mime_type, "
                            "size_bytes, duration_sec, width, height, sha256, download_status, generated_at, expires_at, response_json) "
                            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb) "
                            "ON CONFLICT (asset_key) DO UPDATE SET "
                            "tweet_id=EXCLUDED.tweet_id, "
                            "post_url=EXCLUDED.post_url, "
                            "storage_backend=EXCLUDED.storage_backend, "
                            "storage_key=EXCLUDED.storage_key, "
                            "mime_type=EXCLUDED.mime_type, "
                            "size_bytes=EXCLUDED.size_bytes, "
                            "duration_sec=EXCLUDED.duration_sec, "
                            "width=EXCLUDED.width, "
                            "height=EXCLUDED.height, "
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
                        result.tweet_id,
                        payload.post_url,
                        video.storage_backend,
                        video.storage_key,
                        video.mime_type,
                        video.size_bytes,
                        video.duration_sec,
                        video.width,
                        video.height,
                        video.sha256,
                        result.status,
                        parse_zulu_datetime(response.freshness.generated_at),
                        expires_at,
                        response_json,
                    ),
                )

    def load_asset(self, asset_key: str) -> TwitterVideoAssetRecord | None:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    cast(
                        Any,
                        (
                            f"SELECT post_url, response_json, expires_at FROM {self.asset_table} "
                            "WHERE asset_key = %s"
                        ),
                    ),
                    (asset_key,),
                )
                row = cursor.fetchone()
        if row is None:
            return None
        response_payload = row[1]
        if isinstance(response_payload, str):
            response_payload = json.loads(response_payload)
        response = TwitterVideoDownloadResponse.model_validate(
            response_payload,
            by_alias=True,
            by_name=True,
        )
        return TwitterVideoAssetRecord(
            asset_key=asset_key,
            request={"postUrl": row[0]},
            response=response,
            expires_at=None if row[2] is None else to_zulu(row[2]),
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
                            "(invocation_id, service_id, request_id, gateway_request_id, caller_type, input_payload, "
                            "response_status, error_code, upstream_status, latency_ms, cache_hit, observability_json) "
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


def _build_in_memory_repository() -> InMemoryTwitterVideoDownloadRepository:
    return InMemoryTwitterVideoDownloadRepository()


@lru_cache
def get_twitter_video_download_repository() -> TwitterVideoDownloadRepository:
    settings = get_settings()
    if not settings.provider_service_postgres_dsn:
        repository_logger.warning(
            "Twitter video download repository running in-memory because PROVIDER_SERVICE_POSTGRES_DSN is not configured"
        )
        return _build_in_memory_repository()
    return PostgresTwitterVideoDownloadRepository(
        dsn=settings.provider_service_postgres_dsn,
        asset_table=settings.twitter_video_postgres_asset_table,
        invocation_table=settings.provider_api_invocation_table,
    )


def asset_expiry(ttl_s: int) -> str:
    return to_zulu(datetime.now(UTC) + timedelta(seconds=max(0, ttl_s)))
