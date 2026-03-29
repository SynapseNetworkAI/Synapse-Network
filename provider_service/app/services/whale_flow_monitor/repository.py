from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any, cast

from app.core.config import get_settings
from app.core.log_config import logger
from app.schemas.whale_flow_monitor import WhaleFlowMonitorResponse
from app.services.smart_contract_audit.domain import ProviderInvocationRecord
from app.services.whale_flow_monitor.domain import (
    WhaleFlowSnapshotRecord,
    parse_zulu_datetime,
    to_zulu,
)


TABLE_NAME_PATTERN = re.compile(r"^[A-Za-z_]\w*$")
repository_logger = logger.bind(component="whale_flow_repository")


class WhaleFlowRepository(ABC):
    @abstractmethod
    def save_snapshot(self, record: WhaleFlowSnapshotRecord) -> None:
        raise NotImplementedError

    @abstractmethod
    def load_snapshot(self, snapshot_key: str) -> WhaleFlowSnapshotRecord | None:
        raise NotImplementedError

    @abstractmethod
    def append_invocation(self, record: ProviderInvocationRecord) -> None:
        raise NotImplementedError


class InMemoryWhaleFlowRepository(WhaleFlowRepository):
    def __init__(self) -> None:
        self.snapshots: dict[str, WhaleFlowSnapshotRecord] = {}
        self.invocations: list[ProviderInvocationRecord] = []

    def save_snapshot(self, record: WhaleFlowSnapshotRecord) -> None:
        self.snapshots[record.snapshot_key] = record

    def load_snapshot(self, snapshot_key: str) -> WhaleFlowSnapshotRecord | None:
        return self.snapshots.get(snapshot_key)

    def append_invocation(self, record: ProviderInvocationRecord) -> None:
        self.invocations.append(record)


class PostgresWhaleFlowRepository(WhaleFlowRepository):
    def __init__(
        self,
        dsn: str,
        snapshot_table: str,
        invocation_table: str,
    ) -> None:
        self.dsn = dsn
        self.snapshot_table = self._validate_table_name(snapshot_table)
        self.invocation_table = self._validate_table_name(invocation_table)

    def save_snapshot(self, record: WhaleFlowSnapshotRecord) -> None:
        payload = record.request
        response = record.response
        response_json = json.dumps(response.model_dump(by_alias=True, mode="json"), ensure_ascii=False)
        expires_at = parse_zulu_datetime(record.expires_at) if record.expires_at else None
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    cast(
                        Any,
                        (
                            f"INSERT INTO {self.snapshot_table} "
                            "(snapshot_key, token, chain, window_minutes, min_usd_value, source_count, max_source_age_sec, generated_at, expires_at, response_json) "
                            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb) "
                            "ON CONFLICT (snapshot_key) DO UPDATE SET "
                            "token=EXCLUDED.token, "
                            "chain=EXCLUDED.chain, "
                            "window_minutes=EXCLUDED.window_minutes, "
                            "min_usd_value=EXCLUDED.min_usd_value, "
                            "source_count=EXCLUDED.source_count, "
                            "max_source_age_sec=EXCLUDED.max_source_age_sec, "
                            "generated_at=EXCLUDED.generated_at, "
                            "expires_at=EXCLUDED.expires_at, "
                            "response_json=EXCLUDED.response_json, "
                            "updated_at=NOW()"
                        ),
                    ),
                    (
                        record.snapshot_key,
                        payload.token,
                        payload.chain,
                        payload.window_minutes,
                        payload.min_usd_value,
                        len(response.sources),
                        response.freshness.max_source_age_sec,
                        parse_zulu_datetime(response.freshness.generated_at),
                        expires_at,
                        response_json,
                    ),
                )

    def load_snapshot(self, snapshot_key: str) -> WhaleFlowSnapshotRecord | None:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    cast(
                        Any,
                        (
                            f"SELECT token, chain, window_minutes, min_usd_value, response_json, expires_at "
                            f"FROM {self.snapshot_table} WHERE snapshot_key = %s"
                        ),
                    ),
                    (snapshot_key,),
                )
                row = cursor.fetchone()
        if row is None:
            return None
        response_payload = row[4]
        if isinstance(response_payload, str):
            response_payload = json.loads(response_payload)
        response = WhaleFlowMonitorResponse.model_validate(
            response_payload,
            by_alias=True,
            by_name=True,
        )
        return WhaleFlowSnapshotRecord(
            snapshot_key=snapshot_key,
            request={
                "token": row[0],
                "chain": row[1],
                "window_minutes": row[2],
                "min_usd_value": float(row[3]),
                "limit": 10,
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


def _build_in_memory_repository() -> InMemoryWhaleFlowRepository:
    return InMemoryWhaleFlowRepository()


@lru_cache
def get_whale_flow_repository() -> WhaleFlowRepository:
    settings = get_settings()
    if not settings.provider_service_postgres_dsn:
        repository_logger.warning(
            "Whale flow repository running in-memory because PROVIDER_SERVICE_POSTGRES_DSN is not configured"
        )
        return _build_in_memory_repository()
    return PostgresWhaleFlowRepository(
        dsn=settings.provider_service_postgres_dsn,
        snapshot_table=settings.whale_flow_postgres_snapshot_table,
        invocation_table=settings.provider_api_invocation_table,
    )


def snapshot_expiry(ttl_s: int) -> str:
    return to_zulu(datetime.now(UTC) + timedelta(seconds=max(0, ttl_s)))
