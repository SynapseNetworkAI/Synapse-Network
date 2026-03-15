from __future__ import annotations

from typing import List

from src.domain.registry import ServiceTargetHealth, ServiceTargetHealthHistory
from src.domain.storage_entities import ServiceRegistryRow

from ..database_manager import DatabaseManager


class ServiceRegistryRepository:
    def __init__(self, db: DatabaseManager):
        self._db = db

    def read_service_registry_rows(self) -> List[ServiceRegistryRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT service_id, owner_address, service_name, summary, endpoint, status,
                       is_active, pricing_amount, pricing_currency, timeout_ms, max_qps,
                       max_request_bytes, max_response_bytes, created_at, updated_at
                FROM synapse_service_registry
                ORDER BY created_at ASC
                """
            )
            rows = cur.fetchall()
        return [
            ServiceRegistryRow(
                serviceId=str(service_id),
                ownerAddress=str(owner_address).lower(),
                serviceName=str(service_name or ""),
                summary=summary,
                endpoint=endpoint,
                status=str(status or "active"),
                isActive=bool(is_active),
                pricingAmount=pricing_amount,
                pricingCurrency=str(pricing_currency or "USDC"),
                timeoutMs=timeout_ms,
                maxQps=max_qps,
                maxRequestBytes=max_request_bytes,
                maxResponseBytes=max_response_bytes,
                createdAt=int(created_at or 0),
                updatedAt=int(updated_at or 0),
            )
            for (
                service_id,
                owner_address,
                service_name,
                summary,
                endpoint,
                status,
                is_active,
                pricing_amount,
                pricing_currency,
                timeout_ms,
                max_qps,
                max_request_bytes,
                max_response_bytes,
                created_at,
                updated_at,
            ) in rows
        ]

    def write_service_registry_rows(self, rows: List[ServiceRegistryRow]) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_service_registry")
            for row in rows:
                cur.execute(
                    """
                    INSERT INTO synapse_service_registry (
                        service_id, owner_address, service_name, summary, endpoint, status,
                        is_active, pricing_amount, pricing_currency, timeout_ms, max_qps,
                        max_request_bytes, max_response_bytes, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (service_id)
                    DO UPDATE SET
                        owner_address = EXCLUDED.owner_address,
                        service_name = EXCLUDED.service_name,
                        summary = EXCLUDED.summary,
                        endpoint = EXCLUDED.endpoint,
                        status = EXCLUDED.status,
                        is_active = EXCLUDED.is_active,
                        pricing_amount = EXCLUDED.pricing_amount,
                        pricing_currency = EXCLUDED.pricing_currency,
                        timeout_ms = EXCLUDED.timeout_ms,
                        max_qps = EXCLUDED.max_qps,
                        max_request_bytes = EXCLUDED.max_request_bytes,
                        max_response_bytes = EXCLUDED.max_response_bytes,
                        created_at = EXCLUDED.created_at,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        row.service_id,
                        row.owner_address.lower(),
                        row.service_name,
                        row.summary,
                        row.endpoint,
                        row.status,
                        bool(row.is_active),
                        str(row.pricing_amount),
                        row.pricing_currency,
                        row.timeout_ms,
                        row.max_qps,
                        row.max_request_bytes,
                        row.max_response_bytes,
                        int(row.created_at),
                        int(row.updated_at),
                    ),
                )

    def read_service_target_health_rows(self) -> List[ServiceTargetHealth]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT service_id, owner_address, target_url, weight, region, status, overall_status,
                       http_status, latency_ms, consecutive_successes, consecutive_failures,
                       probe_url, last_checked_at, last_healthy_at, error
                FROM synapse_service_target_health
                ORDER BY service_id, target_url
                """
            )
            rows = cur.fetchall()
        return [
            ServiceTargetHealth(
                serviceId=service_id,
                ownerAddress=owner,
                targetUrl=target_url,
                weight=weight,
                region=region,
                status=status,
                overallStatus=overall_status,
                httpStatus=http_status,
                latencyMs=latency_ms,
                consecutiveSuccesses=int(successes or 0),
                consecutiveFailures=int(failures or 0),
                probeUrl=probe_url,
                lastCheckedAt=last_checked_at,
                lastHealthyAt=last_healthy_at,
                error=error,
            )
            for service_id, owner, target_url, weight, region, status, overall_status, http_status, latency_ms, successes, failures, probe_url, last_checked_at, last_healthy_at, error in rows
        ]

    def write_service_target_health_rows(self, rows: List[ServiceTargetHealth]) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_service_target_health")
            for row in rows:
                if not row.service_id or not row.target_url:
                    continue
                cur.execute(
                    """
                    INSERT INTO synapse_service_target_health (
                        service_id, owner_address, target_url, weight, region, status, overall_status,
                        http_status, latency_ms, consecutive_successes, consecutive_failures,
                        probe_url, last_checked_at, last_healthy_at, error
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        row.service_id,
                        (row.owner_address or "").lower() or None,
                        row.target_url,
                        row.weight if row.weight is not None else 100,
                        row.region,
                        row.status,
                        row.overall_status,
                        row.http_status,
                        row.latency_ms,
                        row.consecutive_successes,
                        row.consecutive_failures,
                        row.probe_url,
                        row.last_checked_at,
                        row.last_healthy_at,
                        row.error,
                    ),
                )

    def read_service_target_health_history_rows(self) -> List[ServiceTargetHealthHistory]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT service_id, owner_address, target_url, status, http_status, latency_ms,
                       probe_url, consecutive_successes, consecutive_failures, checked_at,
                       last_healthy_at, error
                FROM synapse_service_target_health_history
                ORDER BY id ASC
                """
            )
            rows = cur.fetchall()
        return [
            ServiceTargetHealthHistory(
                serviceId=service_id,
                ownerAddress=owner,
                targetUrl=target_url,
                status=status,
                httpStatus=http_status,
                latencyMs=latency_ms,
                probeUrl=probe_url,
                consecutiveSuccesses=int(successes or 0),
                consecutiveFailures=int(failures or 0),
                checkedAt=int(checked_at or 0),
                lastHealthyAt=last_healthy_at,
                error=error,
            )
            for service_id, owner, target_url, status, http_status, latency_ms, probe_url, successes, failures, checked_at, last_healthy_at, error in rows
        ]

    def write_service_target_health_history_rows(self, rows: List[ServiceTargetHealthHistory]) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_service_target_health_history")
            for row in rows:
                if not row.service_id or not row.target_url:
                    continue
                cur.execute(
                    """
                    INSERT INTO synapse_service_target_health_history (
                        service_id, owner_address, target_url, status, http_status, latency_ms,
                        probe_url, consecutive_successes, consecutive_failures, checked_at,
                        last_healthy_at, error
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        row.service_id,
                        (row.owner_address or "").lower() or None,
                        row.target_url,
                        row.status,
                        row.http_status,
                        row.latency_ms,
                        row.probe_url,
                        row.consecutive_successes,
                        row.consecutive_failures,
                        row.checked_at,
                        row.last_healthy_at,
                        row.error,
                    ),
                )
