from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from functools import lru_cache
from typing import Any, cast

from app.core.config import get_settings
from app.core.log_config import logger
from app.services.smart_contract_audit.domain import (
    ContractAuditReportRecord,
    ProviderInvocationRecord,
    parse_zulu_datetime,
)


TABLE_NAME_PATTERN = re.compile(r"^[A-Za-z_]\w*$")
repository_logger = logger.bind(component="smart_contract_audit_repository")


class SmartContractAuditRepository(ABC):
    @abstractmethod
    def save_report(self, record: ContractAuditReportRecord) -> None:
        raise NotImplementedError

    @abstractmethod
    def append_invocation(self, record: ProviderInvocationRecord) -> None:
        raise NotImplementedError


class PostgresSmartContractAuditRepository(SmartContractAuditRepository):
    def __init__(
        self,
        dsn: str,
        report_table: str = "provider_contract_audit_reports",
        invocation_table: str = "provider_api_invocations",
    ) -> None:
        self.dsn = dsn
        self.report_table = self._validate_table_name(report_table)
        self.invocation_table = self._validate_table_name(invocation_table)

    def save_report(self, record: ContractAuditReportRecord) -> None:
        payload = record.request
        response = record.response
        result_payload = json.dumps(response.model_dump(by_alias=True, mode="json"), ensure_ascii=False)
        observability_json = json.dumps(record.observability_payload, ensure_ascii=False)
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
                            f"INSERT INTO {self.report_table} "
                            "(report_key, contract_address, chain, source_fingerprint, analysis_depth, "
                            "source_provider, source_count, max_source_age_sec, generated_at, source_generated_at, expires_at, result_payload, observability_json) "
                            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb) "
                            "ON CONFLICT (report_key) DO UPDATE SET "
                            "contract_address = EXCLUDED.contract_address, "
                            "chain = EXCLUDED.chain, "
                            "source_fingerprint = EXCLUDED.source_fingerprint, "
                            "analysis_depth = EXCLUDED.analysis_depth, "
                            "source_provider = EXCLUDED.source_provider, "
                            "source_count = EXCLUDED.source_count, "
                            "max_source_age_sec = EXCLUDED.max_source_age_sec, "
                            "generated_at = EXCLUDED.generated_at, "
                            "source_generated_at = EXCLUDED.source_generated_at, "
                            "expires_at = EXCLUDED.expires_at, "
                            "result_payload = EXCLUDED.result_payload, "
                            "observability_json = EXCLUDED.observability_json, "
                            "updated_at = NOW()"
                        ),
                    ),
                    (
                        record.report_key,
                        payload.contract_address,
                        payload.chain,
                        record.source_fingerprint,
                        payload.analysis_depth,
                        record.source_provider,
                        len(response.sources),
                        response.freshness.max_source_age_sec,
                        parse_zulu_datetime(response.freshness.generated_at),
                        source_generated_at,
                        expires_at,
                        result_payload,
                        observability_json,
                    ),
                )
        repository_logger.info(
            "Contract audit report persisted"
            " | backend=postgres"
            f" | report_key={record.report_key}"
            f" | target={response.result.target}"
            f" | table={self.report_table}"
            f" | source_provider={record.source_provider or 'inline'}"
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
        repository_logger.info(
            "Provider invocation persisted"
            " | backend=postgres"
            f" | invocation_id={record.invocation_id}"
            f" | service_id={record.service_id}"
            f" | status={record.response_status}"
            f" | table={self.invocation_table}"
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
def get_smart_contract_audit_repository() -> SmartContractAuditRepository:
    settings = get_settings()
    if not settings.provider_service_postgres_dsn:
        raise ValueError(
            "PROVIDER_SERVICE_POSTGRES_DSN must be configured for smart contract audit repository"
        )
    return PostgresSmartContractAuditRepository(
        dsn=settings.provider_service_postgres_dsn,
    )
