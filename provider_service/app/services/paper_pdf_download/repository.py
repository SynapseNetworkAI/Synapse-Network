from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any, cast

from app.core.config import get_settings
from app.core.log_config import logger
from app.schemas.paper_pdf_download import PaperPdfDownloadRequest, PaperPdfDownloadResponse
from app.services.paper_pdf_download.domain import (
    PaperPdfAssetRecord,
    parse_zulu_datetime,
    to_zulu,
)
from app.services.smart_contract_audit.domain import ProviderInvocationRecord


TABLE_NAME_PATTERN = re.compile(r"^[A-Za-z_]\w*$")
repository_logger = logger.bind(component="paper_pdf_download_repository")


class PaperPdfDownloadRepository(ABC):
    @abstractmethod
    def save_asset(self, record: PaperPdfAssetRecord) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_asset(self, asset_key: str) -> PaperPdfAssetRecord | None:
        raise NotImplementedError

    @abstractmethod
    def append_invocation(self, record: ProviderInvocationRecord) -> None:
        raise NotImplementedError


class InMemoryPaperPdfDownloadRepository(PaperPdfDownloadRepository):
    def __init__(self) -> None:
        self.assets: dict[str, PaperPdfAssetRecord] = {}
        self.invocations: list[ProviderInvocationRecord] = []

    def save_asset(self, record: PaperPdfAssetRecord) -> None:
        self.assets[record.asset_key] = record

    def load_asset(self, asset_key: str) -> PaperPdfAssetRecord | None:
        return self.assets.get(asset_key)

    def append_invocation(self, record: ProviderInvocationRecord) -> None:
        self.invocations.append(record)


class PostgresPaperPdfDownloadRepository(PaperPdfDownloadRepository):
    def __init__(self, dsn: str, asset_table: str, invocation_table: str) -> None:
        self.dsn = dsn
        self.asset_table = self._validate_table_name(asset_table)
        self.invocation_table = self._validate_table_name(invocation_table)

    def save_asset(self, record: PaperPdfAssetRecord) -> None:
        payload = record.request
        response = record.response
        result = response.result
        pdf = result.pdf
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
                            "(asset_key, source_name, paper_id, paper_url, title, authors_json, publication_year, doi, "
                            "storage_backend, storage_key, mime_type, size_bytes, sha256, text_extract_job_id, "
                            "download_status, generated_at, expires_at, response_json) "
                            "VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb) "
                            "ON CONFLICT (asset_key) DO UPDATE SET "
                            "source_name=EXCLUDED.source_name, "
                            "paper_id=EXCLUDED.paper_id, "
                            "paper_url=EXCLUDED.paper_url, "
                            "title=EXCLUDED.title, "
                            "authors_json=EXCLUDED.authors_json, "
                            "publication_year=EXCLUDED.publication_year, "
                            "doi=EXCLUDED.doi, "
                            "storage_backend=EXCLUDED.storage_backend, "
                            "storage_key=EXCLUDED.storage_key, "
                            "mime_type=EXCLUDED.mime_type, "
                            "size_bytes=EXCLUDED.size_bytes, "
                            "sha256=EXCLUDED.sha256, "
                            "text_extract_job_id=EXCLUDED.text_extract_job_id, "
                            "download_status=EXCLUDED.download_status, "
                            "generated_at=EXCLUDED.generated_at, "
                            "expires_at=EXCLUDED.expires_at, "
                            "response_json=EXCLUDED.response_json, "
                            "updated_at=NOW()"
                        ),
                    ),
                    (
                        record.asset_key,
                        payload.source,
                        result.paper_id,
                        payload.paper_url,
                        metadata.title,
                        json.dumps(metadata.authors, ensure_ascii=False),
                        metadata.year,
                        metadata.doi,
                        pdf.storage_backend,
                        pdf.storage_key,
                        pdf.mime_type,
                        pdf.size_bytes,
                        pdf.sha256,
                        result.text_extract_job_id,
                        result.status,
                        parse_zulu_datetime(response.freshness.generated_at),
                        expires_at,
                        response_json,
                    ),
                )

    def load_asset(self, asset_key: str) -> PaperPdfAssetRecord | None:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    cast(
                        Any,
                        (
                            f"SELECT source_name, paper_id, paper_url, response_json, expires_at "
                            f"FROM {self.asset_table} WHERE asset_key = %s"
                        ),
                    ),
                    (asset_key,),
                )
                row = cursor.fetchone()
        if row is None:
            return None
        payload = row[3]
        if isinstance(payload, str):
            payload = json.loads(payload)
        response = PaperPdfDownloadResponse.model_validate(payload, by_alias=True, by_name=True)
        request = PaperPdfDownloadRequest.model_validate(
            {
                "source": row[0],
                "paperId": row[1],
                "paperUrl": row[2],
            },
            by_alias=True,
            by_name=True,
        )
        return PaperPdfAssetRecord(
            asset_key=asset_key,
            request=request,
            response=response,
            expires_at=None if row[4] is None else to_zulu(row[4]),
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
def get_paper_pdf_download_repository() -> PaperPdfDownloadRepository:
    settings = get_settings()
    if not settings.provider_service_postgres_dsn:
        repository_logger.warning(
            "Paper pdf download repository running in-memory because PROVIDER_SERVICE_POSTGRES_DSN is not configured"
        )
        return InMemoryPaperPdfDownloadRepository()
    return PostgresPaperPdfDownloadRepository(
        dsn=settings.provider_service_postgres_dsn,
        asset_table=settings.paper_pdf_postgres_asset_table,
        invocation_table=settings.provider_api_invocation_table,
    )


def asset_expiry(ttl_s: int) -> str:
    return to_zulu(datetime.now(UTC) + timedelta(seconds=max(0, ttl_s)))
