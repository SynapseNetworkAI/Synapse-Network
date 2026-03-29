from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any, cast

from app.core.config import get_settings
from app.core.log_config import logger
from app.schemas.oss_security_healthcheck import OSSSecurityHealthcheckResponse
from app.services.oss_security_healthcheck.domain import (
    OSSSecurityReportRecord,
    parse_zulu_datetime,
    to_zulu,
)
from app.services.smart_contract_audit.domain import ProviderInvocationRecord


TABLE_NAME_PATTERN = re.compile(r"^[A-Za-z_]\w*$")
repository_logger = logger.bind(component="oss_security_healthcheck_repository")


class OSSSecurityHealthcheckRepository(ABC):
    @abstractmethod
    def save_report(self, record: OSSSecurityReportRecord) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_report(self, report_key: str) -> OSSSecurityReportRecord | None:
        raise NotImplementedError

    @abstractmethod
    def append_invocation(self, record: ProviderInvocationRecord) -> None:
        raise NotImplementedError


class InMemoryOSSSecurityHealthcheckRepository(OSSSecurityHealthcheckRepository):
    def __init__(self) -> None:
        self.reports: dict[str, OSSSecurityReportRecord] = {}
        self.invocations: list[ProviderInvocationRecord] = []

    def save_report(self, record: OSSSecurityReportRecord) -> None:
        self.reports[record.report_key] = record

    def load_report(self, report_key: str) -> OSSSecurityReportRecord | None:
        return self.reports.get(report_key)

    def append_invocation(self, record: ProviderInvocationRecord) -> None:
        self.invocations.append(record)


class PostgresOSSSecurityHealthcheckRepository(OSSSecurityHealthcheckRepository):
    def __init__(
        self,
        dsn: str,
        report_table: str,
        invocation_table: str,
    ) -> None:
        self.dsn = dsn
        self.report_table = self._validate_table_name(report_table)
        self.invocation_table = self._validate_table_name(invocation_table)

    def save_report(self, record: OSSSecurityReportRecord) -> None:
        payload = record.request
        response = record.response
        response_json = json.dumps(response.model_dump(by_alias=True, mode="json"), ensure_ascii=False)
        repo_hash = _digest(payload.repo_url or "") if payload.repo_url else None
        package_fingerprint = _digest(",".join(payload.package_list)) if payload.package_list else None
        expires_at = parse_zulu_datetime(record.expires_at) if record.expires_at else None
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    cast(
                        Any,
                        (
                            f"INSERT INTO {self.report_table} "
                            "(report_key, repo_url_hash, package_fingerprint, ecosystem, dependency_count, "
                            "vulnerability_count, repo_health_score, generated_at, expires_at, response_json) "
                            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb) "
                            "ON CONFLICT (report_key) DO UPDATE SET "
                            "repo_url_hash=EXCLUDED.repo_url_hash, "
                            "package_fingerprint=EXCLUDED.package_fingerprint, "
                            "ecosystem=EXCLUDED.ecosystem, "
                            "dependency_count=EXCLUDED.dependency_count, "
                            "vulnerability_count=EXCLUDED.vulnerability_count, "
                            "repo_health_score=EXCLUDED.repo_health_score, "
                            "generated_at=EXCLUDED.generated_at, "
                            "expires_at=EXCLUDED.expires_at, "
                            "response_json=EXCLUDED.response_json, "
                            "updated_at=NOW()"
                        ),
                    ),
                    (
                        record.report_key,
                        repo_hash,
                        package_fingerprint,
                        payload.ecosystem,
                        len(payload.package_list),
                        len(response.result.vulnerability_matches),
                        response.result.repo_health_score,
                        parse_zulu_datetime(response.freshness.generated_at),
                        expires_at,
                        response_json,
                    ),
                )

    def load_report(self, report_key: str) -> OSSSecurityReportRecord | None:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    cast(
                        Any,
                        (
                            f"SELECT ecosystem, response_json, expires_at FROM {self.report_table} "
                            "WHERE report_key = %s"
                        ),
                    ),
                    (report_key,),
                )
                row = cursor.fetchone()
        if row is None:
            return None
        response_payload = row[1]
        if isinstance(response_payload, str):
            response_payload = json.loads(response_payload)
        response = OSSSecurityHealthcheckResponse.model_validate(
            response_payload,
            by_alias=True,
            by_name=True,
        )
        return OSSSecurityReportRecord(
            report_key=report_key,
            request={
                "repoUrl": None,
                "packageList": [],
                "ecosystem": row[0],
            },
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


def _digest(raw: str) -> str:
    import hashlib

    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _build_in_memory_repository() -> InMemoryOSSSecurityHealthcheckRepository:
    return InMemoryOSSSecurityHealthcheckRepository()


@lru_cache
def get_oss_security_healthcheck_repository() -> OSSSecurityHealthcheckRepository:
    settings = get_settings()
    if not settings.provider_service_postgres_dsn:
        repository_logger.warning(
            "OSS security healthcheck repository running in-memory because PROVIDER_SERVICE_POSTGRES_DSN is not configured"
        )
        return _build_in_memory_repository()
    return PostgresOSSSecurityHealthcheckRepository(
        dsn=settings.provider_service_postgres_dsn,
        report_table=settings.oss_security_postgres_report_table,
        invocation_table=settings.provider_api_invocation_table,
    )


def report_expiry(ttl_s: int) -> str:
    return to_zulu(datetime.now(UTC) + timedelta(seconds=max(0, ttl_s)))
