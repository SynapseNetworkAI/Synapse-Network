from __future__ import annotations

import json
from typing import Any, Dict, List, Union

from src.domain.registry import ServiceTargetHealth, ServiceTargetHealthHistory

from ...normalizers import normalize_service_row
from ..database_manager import DatabaseManager


class ServiceRegistryRepository:
    def __init__(self, db: DatabaseManager):
        self._db = db

    def _has_payload_column(self) -> bool:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'synapse_service_registry' AND column_name = 'payload'
                LIMIT 1
                """
            )
            return cur.fetchone() is not None

    @staticmethod
    def _legacy_row_to_payload(row: Any) -> Dict[str, Any]:
        (
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
        ) = row
        invoke_timeout = int(timeout_ms or 15000)
        target_url = str(endpoint or "").strip()
        payload = {
            "serviceId": str(service_id or "").strip(),
            "ownerAddress": str(owner_address or "").lower(),
            "serviceName": str(service_name or "").strip(),
            "summary": str(summary or ""),
            "status": str(status or "active"),
            "isActive": bool(is_active),
            "pricing": {
                "amount": str(pricing_amount or "0"),
                "currency": str(pricing_currency or "USD"),
            },
            "tags": [],
            "constraints": {
                "timeoutMs": invoke_timeout,
                "maxQps": int(max_qps or 100),
                "maxRequestBytes": int(max_request_bytes or 262144),
                "maxResponseBytes": int(max_response_bytes or 262144),
            },
            "invoke": {
                "method": "POST",
                "targets": ([{"url": target_url, "weight": 100}] if target_url else []),
                "timeoutMs": invoke_timeout,
                "request": {},
                "response": {},
                "headersTemplate": {},
                "examples": [],
            },
            "createdAt": int(created_at or 0),
            "updatedAt": int(updated_at or 0),
        }
        return payload

    @staticmethod
    def _extract_primary_target(row: Dict[str, Any]) -> str:
        invoke = row.get("invoke") if isinstance(row, dict) else None
        if isinstance(invoke, dict):
            targets = invoke.get("targets")
            if isinstance(targets, list) and targets:
                first = targets[0]
                if isinstance(first, dict):
                    return str(first.get("url") or "").strip()
        return str(row.get("endpoint") or "").strip()

    @staticmethod
    def _extract_pricing(row: Dict[str, Any]) -> tuple[str, str]:
        pricing = row.get("pricing")
        if isinstance(pricing, dict):
            amount = str(pricing.get("amount") or "0")
            currency = str(pricing.get("currency") or "USD")
            return amount, currency
        if isinstance(pricing, str):
            return pricing, "USD"
        return "0", "USD"

    def read_service_registry_rows(self) -> List[Dict[str, Any]]:
        if self._has_payload_column():
            with self._db.readonly_cursor() as cur:
                cur.execute("SELECT payload FROM synapse_service_registry ORDER BY created_at ASC")
                rows = cur.fetchall()
            return [normalize_service_row(row[0]) for row in rows if isinstance(row[0], dict)]

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
        return [normalize_service_row(self._legacy_row_to_payload(row)) for row in rows]

    def write_service_registry_rows(self, rows: List[Dict[str, Any]]) -> None:
        if not self._has_payload_column():
            with self._db.tx_cursor() as cur:
                cur.execute("DELETE FROM synapse_service_registry")
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    service_id = str(row.get("serviceId") or "").strip()
                    if not service_id:
                        continue
                    amount, currency = self._extract_pricing(row)
                    constraints = row.get("constraints") if isinstance(row.get("constraints"), dict) else {}
                    timeout_ms = int((constraints or {}).get("timeoutMs") or row.get("timeoutMs") or 15000)
                    max_qps = int((constraints or {}).get("maxQps") or row.get("maxQps") or 100)
                    max_request_bytes = int((constraints or {}).get("maxRequestBytes") or row.get("maxRequestBytes") or 262144)
                    max_response_bytes = int((constraints or {}).get("maxResponseBytes") or row.get("maxResponseBytes") or 262144)
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
                            service_id,
                            str(row.get("ownerAddress") or "").lower(),
                            str(row.get("serviceName") or ""),
                            str(row.get("summary") or ""),
                            self._extract_primary_target(row),
                            str(row.get("status") or "active"),
                            bool(row.get("isActive", True)),
                            amount,
                            currency,
                            timeout_ms,
                            max_qps,
                            max_request_bytes,
                            max_response_bytes,
                            int(row.get("createdAt") or 0),
                            int(row.get("updatedAt") or 0),
                        ),
                    )
            return

        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_service_registry")
            for row in rows:
                if not isinstance(row, dict):
                    continue
                service_id = str(row.get("serviceId") or "").strip()
                if not service_id:
                    continue
                cur.execute(
                    """
                    INSERT INTO synapse_service_registry (service_id, owner_address, created_at, updated_at, payload)
                    VALUES (%s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (service_id)
                    DO UPDATE SET owner_address = EXCLUDED.owner_address, created_at = EXCLUDED.created_at,
                                  updated_at = EXCLUDED.updated_at, payload = EXCLUDED.payload
                    """,
                    (
                        service_id,
                        str(row.get("ownerAddress") or "").lower(),
                        int(row.get("createdAt") or 0),
                        int(row.get("updatedAt") or 0),
                        json.dumps(row, ensure_ascii=False),
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
                service_id=service_id,
                owner_address=owner,
                target_url=target_url,
                weight=weight,
                region=region,
                status=status,
                overall_status=overall_status,
                http_status=http_status,
                latency_ms=latency_ms,
                consecutive_successes=int(successes or 0),
                consecutive_failures=int(failures or 0),
                probe_url=probe_url,
                last_checked_at=last_checked_at,
                last_healthy_at=last_healthy_at,
                error=error,
            )
            for service_id, owner, target_url, weight, region, status, overall_status, http_status, latency_ms, successes, failures, probe_url, last_checked_at, last_healthy_at, error in rows
        ]

    def write_service_target_health_rows(self, rows: List[Union[ServiceTargetHealth, Dict[str, Any]]]) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_service_target_health")
            for row in rows:
                if isinstance(row, ServiceTargetHealth):
                    service_id = row.service_id
                    target_url = row.target_url
                elif isinstance(row, dict):
                    service_id = str(row.get("serviceId") or "").strip()
                    target_url = str(row.get("targetUrl") or "").strip()
                else:
                    continue
                if not service_id or not target_url:
                    continue
                if isinstance(row, ServiceTargetHealth):
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
                else:
                    cur.execute(
                        """
                        INSERT INTO synapse_service_target_health (
                            service_id, owner_address, target_url, weight, region, status, overall_status,
                            http_status, latency_ms, consecutive_successes, consecutive_failures,
                            probe_url, last_checked_at, last_healthy_at, error
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            service_id,
                            str(row.get("ownerAddress") or "").lower() or None,
                            target_url,
                            int(row.get("weight") or 100),
                            row.get("region"),
                            row.get("status"),
                            row.get("overallStatus"),
                            row.get("httpStatus"),
                            row.get("latencyMs"),
                            int(row.get("consecutiveSuccesses") or 0),
                            int(row.get("consecutiveFailures") or 0),
                            row.get("probeUrl"),
                            row.get("lastCheckedAt"),
                            row.get("lastHealthyAt"),
                            row.get("error"),
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
                service_id=service_id,
                owner_address=owner,
                target_url=target_url,
                status=status,
                http_status=http_status,
                latency_ms=latency_ms,
                probe_url=probe_url,
                consecutive_successes=int(successes or 0),
                consecutive_failures=int(failures or 0),
                checked_at=int(checked_at or 0),
                last_healthy_at=last_healthy_at,
                error=error,
            )
            for service_id, owner, target_url, status, http_status, latency_ms, probe_url, successes, failures, checked_at, last_healthy_at, error in rows
        ]

    def write_service_target_health_history_rows(self, rows: List[Union[ServiceTargetHealthHistory, Dict[str, Any]]]) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_service_target_health_history")
            for row in rows:
                if isinstance(row, ServiceTargetHealthHistory):
                    service_id = row.service_id
                    target_url = row.target_url
                elif isinstance(row, dict):
                    service_id = str(row.get("serviceId") or "").strip()
                    target_url = str(row.get("targetUrl") or "").strip()
                else:
                    continue
                if not service_id or not target_url:
                    continue
                if isinstance(row, ServiceTargetHealthHistory):
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
                else:
                    cur.execute(
                        """
                        INSERT INTO synapse_service_target_health_history (
                            service_id, owner_address, target_url, status, http_status, latency_ms,
                            probe_url, consecutive_successes, consecutive_failures, checked_at,
                            last_healthy_at, error
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            service_id,
                            str(row.get("ownerAddress") or "").lower() or None,
                            target_url,
                            row.get("status"),
                            row.get("httpStatus"),
                            row.get("latencyMs"),
                            row.get("probeUrl"),
                            int(row.get("consecutiveSuccesses") or 0),
                            int(row.get("consecutiveFailures") or 0),
                            int(row.get("checkedAt") or 0),
                            row.get("lastHealthyAt"),
                            row.get("error"),
                        ),
                    )
