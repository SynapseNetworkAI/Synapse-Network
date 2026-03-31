from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any, cast

from app.core.config import get_settings
from app.core.log_config import logger
from app.schemas.tiktok_video_download import TikTokVideoDownloadResponse
from app.services.postgres_schema_compat import (
    add_column_if_missing,
    fetch_table_columns,
    rename_column_if_needed,
)
from app.services.smart_contract_audit.domain import ProviderInvocationRecord
from app.services.tiktok_video_download.domain import (
    TikTokVideoAssetRecord,
    parse_zulu_datetime,
    to_zulu,
)


TABLE_NAME_PATTERN = re.compile(r"^[A-Za-z_]\w*$")
repository_logger = logger.bind(component="tiktok_video_download_repository")


class TikTokVideoDownloadRepository(ABC):
    @abstractmethod
    def save_asset(self, record: TikTokVideoAssetRecord) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_asset(self, asset_key: str) -> TikTokVideoAssetRecord | None:
        raise NotImplementedError

    @abstractmethod
    def append_invocation(self, record: ProviderInvocationRecord) -> None:
        raise NotImplementedError


class InMemoryTikTokVideoDownloadRepository(TikTokVideoDownloadRepository):
    def __init__(self) -> None:
        self.assets: dict[str, TikTokVideoAssetRecord] = {}
        self.invocations: list[ProviderInvocationRecord] = []

    def save_asset(self, record: TikTokVideoAssetRecord) -> None:
        self.assets[record.asset_key] = record

    def load_asset(self, asset_key: str) -> TikTokVideoAssetRecord | None:
        return self.assets.get(asset_key)

    def append_invocation(self, record: ProviderInvocationRecord) -> None:
        self.invocations.append(record)


class PostgresTikTokVideoDownloadRepository(TikTokVideoDownloadRepository):
    def __init__(self, dsn: str, asset_table: str, invocation_table: str) -> None:
        self.dsn = dsn
        self.asset_table = self._validate_table_name(asset_table)
        self.invocation_table = self._validate_table_name(invocation_table)
        self._asset_schema_checked = False

    def save_asset(self, record: TikTokVideoAssetRecord) -> None:
        payload = record.request
        response = record.response
        result = response.result
        video = result.video
        response_json = json.dumps(response.model_dump(by_alias=True, mode="json"), ensure_ascii=False)
        expires_at = parse_zulu_datetime(record.expires_at) if record.expires_at else None

        with self._connect() as connection:
            with connection.cursor() as cursor:
                self._ensure_asset_table_schema(cursor)
                cursor.execute(
                    cast(
                        Any,
                        (
                            f"INSERT INTO {self.asset_table} "
                            "(asset_key, video_id, video_url, preferred_quality, max_duration_sec, with_subtitle, "
                            "storage_backend, storage_key, mime_type, size_bytes, duration_sec, width, height, sha256, "
                            "download_status, generated_at, expires_at, response_json) "
                            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb) "
                            "ON CONFLICT (asset_key) DO UPDATE SET "
                            "video_id=EXCLUDED.video_id, "
                            "video_url=EXCLUDED.video_url, "
                            "preferred_quality=EXCLUDED.preferred_quality, "
                            "max_duration_sec=EXCLUDED.max_duration_sec, "
                            "with_subtitle=EXCLUDED.with_subtitle, "
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
                        result.video_id,
                        payload.video_url,
                        payload.preferred_quality,
                        payload.max_duration_sec,
                        payload.with_subtitle,
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

    def load_asset(self, asset_key: str) -> TikTokVideoAssetRecord | None:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                self._ensure_asset_table_schema(cursor)
                cursor.execute(
                    cast(
                        Any,
                        (
                            f"SELECT video_url, preferred_quality, max_duration_sec, with_subtitle, response_json, expires_at "
                            f"FROM {self.asset_table} WHERE asset_key = %s"
                        ),
                    ),
                    (asset_key,),
                )
                row = cursor.fetchone()
        if row is None:
            return None
        payload = row[4]
        if isinstance(payload, str):
            payload = json.loads(payload)
        response = TikTokVideoDownloadResponse.model_validate(payload, by_alias=True, by_name=True)
        return TikTokVideoAssetRecord(
            asset_key=asset_key,
            request={
                "videoUrl": row[0],
                "preferredQuality": row[1],
                "maxDurationSec": row[2],
                "withSubtitle": row[3],
            },
            response=response,
            expires_at=None if row[5] is None else to_zulu(row[5]),
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

    def _ensure_asset_table_schema(self, cursor) -> None:
        if self._asset_schema_checked:
            return

        columns = fetch_table_columns(cursor, table_name=self.asset_table)
        if not columns:
            self._asset_schema_checked = True
            return

        legacy_layout_detected = "video_url" not in columns and "post_url" in columns
        if legacy_layout_detected:
            repository_logger.warning(
                "Repairing legacy TikTok asset table schema before use",
                asset_table=self.asset_table,
            )

        columns = rename_column_if_needed(
            cursor,
            table_name=self.asset_table,
            columns=columns,
            old_name="post_id",
            new_name="video_id",
        )
        columns = rename_column_if_needed(
            cursor,
            table_name=self.asset_table,
            columns=columns,
            old_name="post_url",
            new_name="video_url",
        )
        columns = add_column_if_missing(
            cursor,
            table_name=self.asset_table,
            columns=columns,
            column_name="preferred_quality",
            definition_sql="TEXT NOT NULL DEFAULT 'best'",
        )
        columns = add_column_if_missing(
            cursor,
            table_name=self.asset_table,
            columns=columns,
            column_name="max_duration_sec",
            definition_sql="INTEGER NOT NULL DEFAULT 300 CHECK (max_duration_sec >= 0)",
        )
        add_column_if_missing(
            cursor,
            table_name=self.asset_table,
            columns=columns,
            column_name="with_subtitle",
            definition_sql="BOOLEAN NOT NULL DEFAULT FALSE",
        )
        self._asset_schema_checked = True

    @staticmethod
    def _validate_table_name(table_name: str) -> str:
        if not TABLE_NAME_PATTERN.fullmatch(table_name):
            raise ValueError(f"Invalid Postgres table name: {table_name}")
        return table_name


@lru_cache
def get_tiktok_video_download_repository() -> TikTokVideoDownloadRepository:
    settings = get_settings()
    if not settings.provider_service_postgres_dsn:
        repository_logger.warning(
            "TikTok video download repository running in-memory because PROVIDER_SERVICE_POSTGRES_DSN is not configured"
        )
        return InMemoryTikTokVideoDownloadRepository()
    return PostgresTikTokVideoDownloadRepository(
        dsn=settings.provider_service_postgres_dsn,
        asset_table=settings.tiktok_video_postgres_asset_table,
        invocation_table=settings.provider_api_invocation_table,
    )


def asset_expiry(ttl_s: int) -> str:
    return to_zulu(datetime.now(UTC) + timedelta(seconds=max(0, ttl_s)))
