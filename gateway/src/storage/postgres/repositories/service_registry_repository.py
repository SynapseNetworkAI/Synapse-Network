from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from typing import Any, List

from src.domain.registry import ServiceRegistryRow
from src.domain.registry import ServiceTargetHealth, ServiceTargetHealthHistory
from src.utils.datetime_utils import now_dt_str, to_dt_str

from ..database_manager import DatabaseManager


class ServiceRegistryRepository:
    def __init__(self, db: DatabaseManager):
        self._db = db

    @staticmethod
    def _normalize_json_object(value: object) -> dict:
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except Exception:
                return {}
            return parsed if isinstance(parsed, dict) else {}
        return {}

    @staticmethod
    def _normalize_json_list(value: object) -> list:
        if isinstance(value, list):
            return value
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except Exception:
                return []
            return parsed if isinstance(parsed, list) else []
        return []

    @staticmethod
    def _payload_dict(value: Any) -> dict[str, Any]:
        if isinstance(value, dict):
            return dict(value)
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except Exception:
                return {}
            return parsed if isinstance(parsed, dict) else {}
        return {}

    @staticmethod
    def _service_meta_state_key(service_id: str) -> str:
        return f"service_meta::{service_id}"

    @staticmethod
    def _health_meta_state_key(service_id: str, endpoint_url: str) -> str:
        return f"service_health_meta::{service_id}::{endpoint_url}"

    @staticmethod
    def _history_state_key(service_id: str) -> str:
        return f"service_health_history::{service_id}"

    @staticmethod
    def _owner_id(wallet: str) -> str:
        return f"owner:{str(wallet or '').lower()}"

    @staticmethod
    def _seller_id(wallet: str) -> str:
        return f"seller:{str(wallet or '').lower()}"

    @staticmethod
    def _endpoint_id(service_id: str, endpoint_url: str, index: int) -> str:
        suffix = hashlib.sha1(endpoint_url.encode("utf-8")).hexdigest()[:10]
        return f"{service_id}:ep:{index}:{suffix}"

    @staticmethod
    def _health_score(status: str) -> int:
        normalized = str(status or "unknown").strip().lower()
        if normalized in {"healthy", "up", "active"}:
            return 100
        if normalized in {"degraded", "warn", "warning"}:
            return 60
        if normalized in {"unknown", "pending"}:
            return 30
        return 0

    @staticmethod
    def _success_rate(successes: int, failures: int) -> float | None:
        total = max(0, int(successes or 0)) + max(0, int(failures or 0))
        if total <= 0:
            return None
        return round(max(0, int(successes or 0)) / total, 6)

    def _ensure_owner_and_seller(self, cur: Any, owner_wallet: str, display_name: str | None) -> str:
        wallet = str(owner_wallet or "").lower()
        owner_id = self._owner_id(wallet)
        seller_id = self._seller_id(wallet)
        cur.execute(
            """
            INSERT INTO synapse_owner_accounts (
                owner_id, owner_wallet, status, default_currency, created_at, updated_at
            ) VALUES (%s, %s, 'active', 'USDC', %s, %s)
            ON CONFLICT (owner_id)
            DO UPDATE SET owner_wallet = EXCLUDED.owner_wallet, updated_at = EXCLUDED.updated_at
            """,
            (owner_id, wallet, now_dt_str(), now_dt_str()),
        )
        cur.execute(
            """
            INSERT INTO synapse_seller_profiles (
                seller_id, owner_wallet, display_name, status, created_at, updated_at
            ) VALUES (%s, %s, %s, 'active', %s, %s)
            ON CONFLICT (seller_id)
            DO UPDATE SET
                owner_wallet = EXCLUDED.owner_wallet,
                display_name = EXCLUDED.display_name,
                updated_at = EXCLUDED.updated_at
            """,
            (
                seller_id,
                wallet,
                (display_name or wallet).strip() or wallet,
                now_dt_str(),
                now_dt_str(),
            ),
        )
        return seller_id

    def _upsert_runtime_state(self, cur: Any, state_key: str, payload: dict[str, Any], updated_at: str | None = None) -> None:
        cur.execute(
            """
            INSERT INTO synapse_runtime_state (state_key, payload, updated_at)
            VALUES (%s, %s::jsonb, %s)
            ON CONFLICT (state_key)
            DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
            """,
            (state_key, json.dumps(payload), to_dt_str(updated_at, now_dt_str())),
        )

    def _build_service_registry_row(self, row: tuple[object, ...]) -> ServiceRegistryRow | None:
        if len(row) != 17:
            return None

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
            tags_json,
            created_at,
            updated_at,
            metadata_payload,
            endpoint_status,
            max_payload_bytes,
            endpoint_id,
        ) = row

        metadata = self._payload_dict(metadata_payload)
        return ServiceRegistryRow(
            serviceId=str(service_id),
            ownerAddress=str(owner_address).lower(),
            serviceName=str(service_name or ""),
            summary=summary,
            endpoint=endpoint,
            status=str(status or "active"),
            isActive=bool(is_active and str(endpoint_status or "active") == "active"),
            pricingAmount=pricing_amount,
            pricingCurrency=str(pricing_currency or "USDC"),
            timeoutMs=timeout_ms,
            maxQps=metadata.get("maxQps"),
            maxRequestBytes=metadata.get("maxRequestBytes") or max_payload_bytes,
            maxResponseBytes=metadata.get("maxResponseBytes") or max_payload_bytes,
            id=str(metadata.get("id") or endpoint_id or "") or None,
            schemaVersion=metadata.get("schemaVersion"),
            role=str(metadata.get("role") or "") or None,
            address=str(metadata.get("address") or "") or None,
            tags=self._normalize_json_list(tags_json),
            auth=self._normalize_json_object(metadata.get("auth")),
            healthCheck=self._normalize_json_object(metadata.get("healthCheck")),
            forwarding=self._normalize_json_object(metadata.get("forwarding")),
            metering=self._normalize_json_object(metadata.get("metering")),
            invoke=self._normalize_json_object(metadata.get("invoke")),
            createdAt=to_dt_str(metadata.get("createdAt") or created_at, "") or "",
            updatedAt=to_dt_str(metadata.get("updatedAt") or updated_at, "") or "",
        )

    def read_service_registry_rows(self) -> List[ServiceRegistryRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT
                    sm.service_id,
                    sp.owner_wallet,
                    sm.service_name,
                    sm.description_for_model,
                    ep.endpoint_url,
                    sm.status,
                    (sm.status = 'active'),
                    sm.base_price_usdc,
                    sm.settlement_currency,
                    ep.timeout_ms,
                    si.tags_json,
                    sm.created_at,
                    sm.updated_at,
                    rs.payload,
                    ep.status,
                    ep.max_payload_bytes,
                    ep.endpoint_id
                FROM synapse_service_manifests AS sm
                INNER JOIN synapse_seller_profiles AS sp ON sp.seller_id = sm.seller_id
                LEFT JOIN LATERAL (
                    SELECT endpoint_id, endpoint_url, timeout_ms, status, max_payload_bytes
                    FROM synapse_service_endpoints
                    WHERE service_id = sm.service_id
                    ORDER BY is_primary DESC, created_at ASC
                    LIMIT 1
                ) AS ep ON TRUE
                LEFT JOIN synapse_service_search_index AS si ON si.service_id = sm.service_id
                LEFT JOIN synapse_runtime_state AS rs
                    ON rs.state_key = CONCAT('service_meta::', sm.service_id)
                ORDER BY sm.created_at ASC
                """
            )
            rows = cur.fetchall()

        result: List[ServiceRegistryRow] = []
        for row in rows:
            entity = self._build_service_registry_row(row)
            if entity is not None:
                result.append(entity)
        return result

    def write_service_registry_rows(self, rows: List[ServiceRegistryRow]) -> None:
        typed_rows: List[ServiceRegistryRow] = []
        for row in rows:
            if isinstance(row, ServiceRegistryRow):
                typed_rows.append(row)
            elif isinstance(row, dict):
                typed_rows.append(ServiceRegistryRow.model_validate(row))

        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_service_health_snapshots")
            cur.execute("DELETE FROM synapse_service_endpoints")
            cur.execute("DELETE FROM synapse_service_search_index")
            cur.execute("DELETE FROM synapse_service_manifests")
            cur.execute(
                "DELETE FROM synapse_runtime_state WHERE state_key LIKE 'service_meta::%' OR state_key LIKE 'service_health_meta::%' OR state_key LIKE 'service_health_history::%'"
            )
            for row in typed_rows:
                seller_id = self._ensure_owner_and_seller(cur, row.owner_address, row.service_name)
                created_at = to_dt_str(row.created_at, now_dt_str())
                updated_at = to_dt_str(row.updated_at, now_dt_str())
                cur.execute(
                    """
                    INSERT INTO synapse_service_manifests (
                        service_id, seller_id, service_name, manifest_version, status,
                        description_for_model, task_category, capabilities_json,
                        input_schema, output_schema, examples_json, limitations_json,
                        price_model, base_price_usdc, quote_required,
                        settlement_currency, created_at, updated_at
                    ) VALUES (
                        %s, %s, %s, %s, %s,
                        %s, %s, %s::jsonb,
                        '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb,
                        'fixed', %s, TRUE,
                        %s, %s, %s
                    )
                    """,
                    (
                        row.service_id,
                        seller_id,
                        row.service_name,
                        str(row.schema_version or 1),
                        row.status or ("active" if row.is_active else "paused"),
                        row.summary or row.service_name,
                        row.role,
                        json.dumps(row.tags or []),
                        str(row.pricing_amount or 0),
                        row.pricing_currency or "USDC",
                        created_at,
                        updated_at,
                    ),
                )

                invoke = dict(row.invoke or {})
                targets = invoke.get("targets") if isinstance(invoke.get("targets"), list) else []
                endpoint_targets = [
                    target
                    for target in targets
                    if isinstance(target, dict) and str(target.get("url") or "").strip()
                ]
                if not endpoint_targets and row.endpoint:
                    endpoint_targets = [{"url": row.endpoint, "weight": 100}]

                for index, target in enumerate(endpoint_targets):
                    endpoint_url = str(target.get("url") or "").strip()
                    if not endpoint_url:
                        continue
                    cur.execute(
                        """
                        INSERT INTO synapse_service_endpoints (
                            endpoint_id, service_id, endpoint_url, auth_mode, timeout_ms,
                            max_payload_bytes, streaming_supported, async_supported,
                            callback_supported, region, weight, is_primary, status,
                            created_at, updated_at
                        ) VALUES (
                            %s, %s, %s, 'gateway_forward', %s,
                            %s, %s, %s,
                            %s, %s, %s, %s, %s,
                            %s, %s
                        )
                        """,
                        (
                            self._endpoint_id(row.service_id, endpoint_url, index),
                            row.service_id,
                            endpoint_url,
                            int(row.timeout_ms or 15000),
                            int(row.max_request_bytes or 4194304),
                            bool(invoke.get("streamingSupported", False)),
                            bool(invoke.get("asyncSupported", False)),
                            bool(invoke.get("callbackSupported", False)),
                            target.get("region"),
                            int(target.get("weight") or 100),
                            index == 0,
                            "active" if row.is_active else "paused",
                            created_at,
                            updated_at,
                        ),
                    )

                cur.execute(
                    """
                    INSERT INTO synapse_service_search_index (
                        service_id, tags_json, search_text, embedding_ref,
                        reliability_tier, health_score, p95_latency_ms, success_rate_24h, updated_at
                    ) VALUES (%s, %s::jsonb, %s, NULL, NULL, NULL, NULL, NULL, %s)
                    """,
                    (
                        row.service_id,
                        json.dumps(row.tags or []),
                        " ".join(
                            value
                            for value in [
                                str(row.service_name or ""),
                                str(row.summary or ""),
                                " ".join(str(tag) for tag in row.tags or []),
                            ]
                            if value
                        ).strip(),
                        updated_at,
                    ),
                )

                self._upsert_runtime_state(
                    cur,
                    self._service_meta_state_key(row.service_id),
                    {
                        "id": row.id,
                        "schemaVersion": row.schema_version,
                        "role": row.role,
                        "address": row.address,
                        "auth": row.auth or {},
                        "healthCheck": row.health_check or {},
                        "forwarding": row.forwarding or {},
                        "metering": row.metering or {},
                        "invoke": row.invoke or {},
                        "maxQps": row.max_qps,
                        "maxRequestBytes": row.max_request_bytes,
                        "maxResponseBytes": row.max_response_bytes,
                        "createdAt": created_at,
                        "updatedAt": updated_at,
                    },
                    updated_at,
                )

    def read_service_target_health_rows(self) -> List[ServiceTargetHealth]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT
                    sh.service_id,
                    sp.owner_wallet,
                    ep.endpoint_url,
                    rs.payload,
                    sh.health_score,
                    sh.p95_latency_ms,
                    sh.success_rate_24h,
                    sh.last_checked_at,
                    sh.error_code
                FROM synapse_service_health_snapshots AS sh
                INNER JOIN synapse_service_manifests AS sm ON sm.service_id = sh.service_id
                INNER JOIN synapse_seller_profiles AS sp ON sp.seller_id = sm.seller_id
                INNER JOIN synapse_service_endpoints AS ep ON ep.endpoint_id = sh.endpoint_id
                LEFT JOIN synapse_runtime_state AS rs
                    ON rs.state_key = CONCAT('service_health_meta::', sh.service_id, '::', ep.endpoint_url)
                ORDER BY sh.service_id, ep.endpoint_url
                """
            )
            rows = cur.fetchall()
        result: List[ServiceTargetHealth] = []
        for service_id, owner, target_url, payload_raw, health_score, latency_ms, _, last_checked_at, error_code in rows:
            payload = self._payload_dict(payload_raw)
            result.append(
                ServiceTargetHealth(
                    serviceId=service_id,
                    ownerAddress=owner,
                    targetUrl=target_url,
                    weight=payload.get("weight"),
                    region=payload.get("region"),
                    status=str(payload.get("status") or ("healthy" if int(health_score or 0) >= 80 else "unhealthy")),
                    overallStatus=payload.get("overallStatus"),
                    httpStatus=payload.get("httpStatus"),
                    latencyMs=latency_ms,
                    consecutiveSuccesses=int(payload.get("consecutiveSuccesses") or 0),
                    consecutiveFailures=int(payload.get("consecutiveFailures") or 0),
                    probeUrl=payload.get("probeUrl"),
                    lastCheckedAt=int(payload.get("lastCheckedAt") or 0) or None,
                    lastHealthyAt=payload.get("lastHealthyAt") or last_checked_at,
                    error=payload.get("error") or error_code,
                )
            )
        return result

    def write_service_target_health_rows(self, rows: List[ServiceTargetHealth]) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_service_health_snapshots")
            cur.execute("DELETE FROM synapse_runtime_state WHERE state_key LIKE 'service_health_meta::%'")
            for row in rows:
                if not row.service_id or not row.target_url:
                    continue
                endpoint_id = self._endpoint_id(row.service_id, row.target_url, 0)
                cur.execute(
                    """
                    INSERT INTO synapse_service_endpoints (
                        endpoint_id, service_id, endpoint_url, auth_mode, timeout_ms,
                        max_payload_bytes, streaming_supported, async_supported,
                        callback_supported, region, weight, is_primary, status,
                        created_at, updated_at
                    ) VALUES (
                        %s, %s, %s, 'gateway_forward', %s,
                        4194304, FALSE, FALSE,
                        FALSE, %s, %s, FALSE, 'active',
                        %s, %s
                    )
                    ON CONFLICT (endpoint_id)
                    DO UPDATE SET
                        endpoint_url = EXCLUDED.endpoint_url,
                        timeout_ms = EXCLUDED.timeout_ms,
                        region = EXCLUDED.region,
                        weight = EXCLUDED.weight,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        endpoint_id,
                        row.service_id,
                        row.target_url,
                        int(row.latency_ms or 15000),
                        row.region,
                        int(row.weight or 100),
                        now_dt_str(),
                        now_dt_str(),
                    ),
                )
                cur.execute(
                    """
                    INSERT INTO synapse_service_health_snapshots (
                        service_id, endpoint_id, health_score, p95_latency_ms,
                        success_rate_24h, last_checked_at, error_code, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        row.service_id,
                        endpoint_id,
                        self._health_score(str(row.status or "unknown")),
                        row.latency_ms,
                        self._success_rate(row.consecutive_successes, row.consecutive_failures),
                        to_dt_str(row.last_checked_at),
                        row.error,
                        now_dt_str(),
                    ),
                )
                self._upsert_runtime_state(
                    cur,
                    self._health_meta_state_key(row.service_id, row.target_url),
                    {
                        "ownerAddress": (row.owner_address or "").lower() or None,
                        "weight": row.weight,
                        "region": row.region,
                        "status": row.status,
                        "overallStatus": row.overall_status,
                        "httpStatus": row.http_status,
                        "consecutiveSuccesses": row.consecutive_successes,
                        "consecutiveFailures": row.consecutive_failures,
                        "probeUrl": row.probe_url,
                        "lastCheckedAt": row.last_checked_at,
                        "lastHealthyAt": row.last_healthy_at,
                        "error": row.error,
                    },
                )

    def read_service_target_health_history_rows(self) -> List[ServiceTargetHealthHistory]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                "SELECT state_key, payload FROM synapse_runtime_state WHERE state_key LIKE 'service_health_history::%' ORDER BY state_key ASC"
            )
            rows = cur.fetchall()
        result: List[ServiceTargetHealthHistory] = []
        for _, payload_raw in rows:
            payload = self._payload_dict(payload_raw)
            history_rows = payload.get("rows") if isinstance(payload.get("rows"), list) else []
            for row in history_rows:
                if not isinstance(row, dict):
                    continue
                result.append(ServiceTargetHealthHistory.model_validate(row))
        return result

    def write_service_target_health_history_rows(self, rows: List[ServiceTargetHealthHistory]) -> None:
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            payload = row.model_dump(by_alias=True, mode="json") if isinstance(row, ServiceTargetHealthHistory) else row
            if not isinstance(payload, dict):
                continue
            service_id = str(payload.get("serviceId") or "").strip()
            if not service_id:
                continue
            grouped[service_id].append(payload)

        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_runtime_state WHERE state_key LIKE 'service_health_history::%'")
            for service_id, payload_rows in grouped.items():
                self._upsert_runtime_state(
                    cur,
                    self._history_state_key(service_id),
                    {"rows": payload_rows},
                )
