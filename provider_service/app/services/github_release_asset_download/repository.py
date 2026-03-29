from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any, cast

from app.core.config import get_settings
from app.core.log_config import logger
from app.schemas.github_release_asset_download import (
    GitHubReleaseAssetDownloadRequest,
    GitHubReleaseAssetDownloadResponse,
)
from app.services.github_release_asset_download.domain import (
    GitHubReleaseAssetRecord,
    parse_zulu_datetime,
    to_zulu,
)
from app.services.smart_contract_audit.domain import ProviderInvocationRecord


TABLE_NAME_PATTERN = re.compile(r"^[A-Za-z_]\w*$")
repository_logger = logger.bind(component="github_release_asset_download_repository")


class GitHubReleaseAssetDownloadRepository(ABC):
    @abstractmethod
    def save_asset(self, record: GitHubReleaseAssetRecord) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_asset(self, asset_key: str) -> GitHubReleaseAssetRecord | None:
        raise NotImplementedError

    @abstractmethod
    def append_invocation(self, record: ProviderInvocationRecord) -> None:
        raise NotImplementedError


class InMemoryGitHubReleaseAssetDownloadRepository(GitHubReleaseAssetDownloadRepository):
    def __init__(self) -> None:
        self.assets: dict[str, GitHubReleaseAssetRecord] = {}
        self.invocations: list[ProviderInvocationRecord] = []

    def save_asset(self, record: GitHubReleaseAssetRecord) -> None:
        self.assets[record.asset_key] = record

    def load_asset(self, asset_key: str) -> GitHubReleaseAssetRecord | None:
        return self.assets.get(asset_key)

    def append_invocation(self, record: ProviderInvocationRecord) -> None:
        self.invocations.append(record)


class PostgresGitHubReleaseAssetDownloadRepository(GitHubReleaseAssetDownloadRepository):
    def __init__(self, dsn: str, asset_table: str, invocation_table: str) -> None:
        self.dsn = dsn
        self.asset_table = self._validate_table_name(asset_table)
        self.invocation_table = self._validate_table_name(invocation_table)

    def save_asset(self, record: GitHubReleaseAssetRecord) -> None:
        payload = record.request
        response = record.response
        result = response.result
        asset = result.asset
        metadata = result.metadata
        response_json = json.dumps(response.model_dump(by_alias=True, mode="json"), ensure_ascii=False)
        expires_at = parse_zulu_datetime(record.expires_at) if record.expires_at else None
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    cast(
                        Any,
                        (
                            f"INSERT INTO {self.asset_table} "
                            "(asset_key, repo, tag_name, latest, asset_pattern, asset_name, "
                            "signature_verified, storage_backend, storage_key, mime_type, size_bytes, sha256, "
                            "download_status, generated_at, expires_at, response_json) "
                            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb) "
                            "ON CONFLICT (asset_key) DO UPDATE SET "
                            "repo=EXCLUDED.repo, "
                            "tag_name=EXCLUDED.tag_name, "
                            "latest=EXCLUDED.latest, "
                            "asset_pattern=EXCLUDED.asset_pattern, "
                            "asset_name=EXCLUDED.asset_name, "
                            "signature_verified=EXCLUDED.signature_verified, "
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
                        payload.repo,
                        payload.tag,
                        payload.latest,
                        payload.asset_pattern,
                        metadata.asset_name,
                        result.signature_verified,
                        asset.storage_backend,
                        asset.storage_key,
                        asset.mime_type,
                        asset.size_bytes,
                        asset.sha256,
                        result.status,
                        parse_zulu_datetime(response.freshness.generated_at),
                        expires_at,
                        response_json,
                    ),
                )

    def load_asset(self, asset_key: str) -> GitHubReleaseAssetRecord | None:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    cast(
                        Any,
                        (
                            f"SELECT repo, tag_name, latest, asset_pattern, response_json, expires_at "
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
        response = GitHubReleaseAssetDownloadResponse.model_validate(payload, by_alias=True, by_name=True)
        request = GitHubReleaseAssetDownloadRequest.model_validate(
            {
                "repo": row[0],
                "tag": row[1],
                "latest": row[2],
                "assetPattern": row[3],
            },
            by_alias=True,
            by_name=True,
        )
        return GitHubReleaseAssetRecord(
            asset_key=asset_key,
            request=request,
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

    @staticmethod
    def _validate_table_name(table_name: str) -> str:
        if not TABLE_NAME_PATTERN.fullmatch(table_name):
            raise ValueError(f"Invalid Postgres table name: {table_name}")
        return table_name


@lru_cache
def get_github_release_asset_download_repository() -> GitHubReleaseAssetDownloadRepository:
    settings = get_settings()
    if not settings.provider_service_postgres_dsn:
        repository_logger.warning(
            "GitHub release asset download repository running in-memory because PROVIDER_SERVICE_POSTGRES_DSN is not configured"
        )
        return InMemoryGitHubReleaseAssetDownloadRepository()
    return PostgresGitHubReleaseAssetDownloadRepository(
        dsn=settings.provider_service_postgres_dsn,
        asset_table=settings.github_release_asset_postgres_asset_table,
        invocation_table=settings.provider_api_invocation_table,
    )


def asset_expiry(ttl_s: int) -> str:
    return to_zulu(datetime.now(UTC) + timedelta(seconds=max(0, ttl_s)))
