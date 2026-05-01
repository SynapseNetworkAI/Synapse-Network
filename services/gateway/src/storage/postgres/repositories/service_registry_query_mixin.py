"""Service registry repository — provider payout, persist, query, and health mixin."""
# ruff: noqa: S608  # reason: dynamic registry filters use controlled fragments with parameterized values
from __future__ import annotations

import json
from collections import defaultdict
from typing import Any, List

from src.domain.service_contract import (
    ServiceAuthRecord,
    ServiceDefinitionRecord,
    ServiceForwardingRecord,
    ServiceHealthCheckRecord,
    ServiceMeteringRecord,
)
from src.domain.registry import ServiceTargetHealth, ServiceTargetHealthHistory
from src.utils.datetime_utils import now_dt_str, to_dt_str

SERVICE_DEFINITION_ROW_COLUMNS = 19
HEALTHY_SCORE_THRESHOLD = 80


class ServiceRegistryQueryMixin:
    """Provider payout, search index, service definition, and health row operations."""

    def _upsert_provider_payout_account(
        self,
        cur: Any,
        row: ServiceDefinitionRecord,
        provider_id: str,
        created_at: str,
        updated_at: str,
    ) -> None:
        if row.payout_account is None:
            return
        payout_address = str(row.payout_account.payout_address or "").strip()
        chain_id = int(row.payout_account.chain_id or 0)
        if not payout_address or chain_id <= 0:
            return
        cur.execute(
            """
            INSERT INTO synapse_provider_payout_accounts (
                payout_account_id, provider_id, payout_address, chain_id,
                settlement_currency, status, created_at, updated_at
            ) VALUES (
                %s, %s, %s, %s,
                %s, %s, %s, %s
            )
            ON CONFLICT (provider_id, payout_address, chain_id)
            DO UPDATE SET
                settlement_currency = EXCLUDED.settlement_currency,
                status = EXCLUDED.status,
                updated_at = EXCLUDED.updated_at
            """,
            (
                self._payout_account_id(provider_id, payout_address, chain_id),
                provider_id,
                payout_address,
                chain_id,
                row.payout_account.settlement_currency,
                row.payout_account.status,
                created_at,
                updated_at,
            ),
        )

    @staticmethod
    def _search_text(row: ServiceDefinitionRecord) -> str:
        return " ".join(
            value
            for value in [
                str(row.service_id or ""),
                str(row.service_name or ""),
                str(row.summary or ""),
                " ".join(str(tag) for tag in row.tags or []),
            ]
            if value
        ).strip()

    def _upsert_search_index(
        self, cur: Any, row: ServiceDefinitionRecord, updated_at: str
    ) -> None:
        cur.execute(
            """
            INSERT INTO synapse_service_search_index (
                service_id, tags_json, search_text, embedding_ref,
                reliability_tier, health_score, p95_latency_ms, success_rate_24h, updated_at
            ) VALUES (%s, %s::jsonb, %s, NULL, NULL, NULL, NULL, NULL, %s)
            ON CONFLICT (service_id)
            DO UPDATE SET
                tags_json = EXCLUDED.tags_json,
                search_text = EXCLUDED.search_text,
                updated_at = EXCLUDED.updated_at
            """,
            (
                row.service_id,
                json.dumps(row.tags or []),
                self._search_text(row),
                updated_at,
            ),
        )

    def _persist_service_row(self, cur: Any, row: ServiceDefinitionRecord) -> None:
        owner_id, provider_id = self._ensure_owner_and_provider(
            cur,
            row.owner_address,
            row.provider_profile.display_name
            if row.provider_profile is not None
            else row.service_name,
        )
        created_at, updated_at = self._manifest_timestamps(row)
        self._upsert_service_manifest(
            cur, row, owner_id, provider_id, created_at, updated_at
        )
        self._upsert_provider_payout_account(
            cur, row, provider_id, created_at, updated_at
        )
        self._upsert_service_endpoints(cur, row, created_at, updated_at)
        self._upsert_search_index(cur, row, updated_at)
        self._upsert_runtime_state(
            cur,
            self._service_meta_state_key(row.service_id),
            self._service_meta_payload(row, created_at, updated_at),
            updated_at,
        )

    def _build_service_definition(self, row: tuple[object, ...]) -> ServiceDefinitionRecord | None:
        if len(row) != SERVICE_DEFINITION_ROW_COLUMNS:
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
            price_model,
            timeout_ms,
            tags_json,
            created_at,
            updated_at,
            metadata_payload,
            endpoint_status,
            max_payload_bytes,
            endpoint_id,
            endpoint_auth_mode,
        ) = row

        metadata = self._payload_dict(metadata_payload)
        lifecycle_status = self._public_lifecycle_status(
            metadata.get("lifecycleStatus") or metadata.get("status") or status,
            bool(is_active and str(endpoint_status or "active") == "active"),
        )
        auth_payload = self._normalize_json_object(metadata.get("auth"))
        if not auth_payload and str(endpoint_auth_mode or "").strip():
            auth_payload = {"type": str(endpoint_auth_mode).strip()}
        created_at_text, updated_at_text = self._created_updated_text(metadata, created_at, updated_at)
        primary_endpoint = self._primary_endpoint_record(
            service_id,
            endpoint,
            endpoint_id,
            endpoint_auth_mode,
            timeout_ms,
            max_payload_bytes,
            endpoint_status,
            created_at_text,
            updated_at_text,
        )
        constraints = self._constraints_from_row(metadata, timeout_ms, max_payload_bytes)
        endpoint_url = str(endpoint or "").strip()
        invoke = self._invoke_from_payload(
            self._normalize_json_object(metadata.get("invoke")),
            constraints.timeout_ms,
            endpoint_url or None,
        )
        return ServiceDefinitionRecord(
            serviceId=str(service_id),
            ownerAddress=str(owner_address).lower(),
            serviceName=str(service_name or ""),
            summary=str(summary or ""),
            status=lifecycle_status,
            isActive=bool(
                lifecycle_status == "active"
                and is_active
                and str(endpoint_status or "active") == "active"
            ),
            pricingAmount=pricing_amount,
            pricingCurrency=str(pricing_currency or "USDC"),
            priceModel=str(metadata.get("priceModel") or price_model or "fixed"),
            serviceKind=str(metadata.get("serviceKind") or "api"),
            constraints=constraints,
            id=str(metadata.get("id") or endpoint_id or "") or None,
            schemaVersion=metadata.get("schemaVersion"),
            role=str(metadata.get("role") or "") or None,
            address=str(metadata.get("address") or "") or None,
            tags=self._normalize_json_list(tags_json),
            auth=ServiceAuthRecord.model_validate(auth_payload),
            providerProfile=self._normalize_json_object(metadata.get("providerProfile")) or None,
            payoutAccount=self._normalize_json_object(metadata.get("payoutAccount")) or None,
            governance=self._normalize_json_object(metadata.get("governance")) or None,
            healthCheck=ServiceHealthCheckRecord.model_validate(self._normalize_json_object(metadata.get("healthCheck"))),
            forwarding=ServiceForwardingRecord.model_validate(self._normalize_json_object(metadata.get("forwarding"))),
            metering=ServiceMeteringRecord.model_validate(self._normalize_json_object(metadata.get("metering"))),
            invoke=invoke,
            createdAt=created_at_text,
            updatedAt=updated_at_text,
            primaryEndpoint=primary_endpoint,
            searchIndex=self._search_index_record(
                service_id,
                service_name,
                summary,
                tags_json,
                updated_at_text,
            ),
        )

    def read_service_registry_rows(self) -> List[ServiceDefinitionRecord]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT
                    sm.service_id,
                    oa.owner_wallet,
                    sm.service_name,
                    sm.description_for_model,
                    ep.endpoint_url,
                    sm.status,
                    (sm.status = 'active'),
                    sm.base_price_usdc,
                    sm.settlement_currency,
                    sm.price_model,
                    ep.timeout_ms,
                    si.tags_json,
                    sm.created_at,
                    sm.updated_at,
                    rs.payload,
                    ep.status,
                    ep.max_payload_bytes,
                    ep.endpoint_id,
                    ep.auth_mode
                FROM synapse_service_manifests AS sm
                INNER JOIN synapse_owner_accounts AS oa ON oa.owner_id = sm.owner_id
                LEFT JOIN LATERAL (
                    SELECT endpoint_id, endpoint_url, auth_mode, timeout_ms, status, max_payload_bytes
                    FROM synapse_service_endpoints
                    WHERE service_id = sm.service_id
                    ORDER BY (status = 'active') DESC, is_primary DESC, updated_at DESC, created_at DESC
                    LIMIT 1
                ) AS ep ON TRUE
                LEFT JOIN synapse_service_search_index AS si ON si.service_id = sm.service_id
                LEFT JOIN synapse_runtime_state AS rs
                    ON rs.state_key = CONCAT('service_meta::', sm.service_id)
                ORDER BY sm.created_at ASC
                """
            )
            rows = cur.fetchall()

        result: List[ServiceDefinitionRecord] = []
        for row in rows:
            entity = self._build_service_definition(row)
            if entity is not None:
                result.append(entity)
        return result

    def write_service_registry_rows(self, rows: List[ServiceDefinitionRecord]) -> None:
        with self._db.tx_cursor() as cur:
            for row in rows:
                self._persist_service_row(cur, row)

    @staticmethod
    def _composite_not_in_clause(row_count: int) -> str:
        return ", ".join(["(%s, %s)"] * max(1, row_count))

    @staticmethod
    def _scalar_not_in_clause(value_count: int) -> str:
        return ", ".join(["%s"] * max(1, value_count))

    def _delete_obsolete_service_health_snapshots(
        self, cur: Any, rows: List[ServiceTargetHealth]
    ) -> None:
        valid_rows = [
            row
            for row in rows
            if str(row.service_id or "").strip() and str(row.target_url or "").strip()
        ]
        if not valid_rows:
            cur.execute("DELETE FROM synapse_service_health_snapshots")
            return

        params: list[Any] = []
        for row in valid_rows:
            params.extend(
                [
                    str(row.service_id or "").strip(),
                    self._endpoint_id(str(row.service_id or "").strip(), str(row.target_url or "").strip(), 0),
                ]
            )
        placeholders = self._composite_not_in_clause(len(valid_rows))
        cur.execute(
            f"DELETE FROM synapse_service_health_snapshots WHERE (service_id, endpoint_id) NOT IN ({placeholders})",
            tuple(params),
        )

    def _delete_obsolete_service_health_meta(
        self, cur: Any, rows: List[ServiceTargetHealth]
    ) -> None:
        valid_rows = [
            row
            for row in rows
            if str(row.service_id or "").strip() and str(row.target_url or "").strip()
        ]
        if not valid_rows:
            cur.execute("DELETE FROM synapse_runtime_state WHERE state_key LIKE 'service_health_meta::%%'")
            return

        state_keys = [
            self._health_meta_state_key(
                str(row.service_id or "").strip(),
                str(row.target_url or "").strip(),
            )
            for row in valid_rows
        ]
        placeholders = self._scalar_not_in_clause(len(state_keys))
        cur.execute(
            f"DELETE FROM synapse_runtime_state WHERE state_key LIKE 'service_health_meta::%%' AND state_key NOT IN ({placeholders})",
            tuple(state_keys),
        )

    def read_service_target_health_rows(self) -> List[ServiceTargetHealth]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT
                    sh.service_id,
                    oa.owner_wallet,
                    ep.endpoint_url,
                    rs.payload,
                    sh.health_score,
                    sh.p95_latency_ms,
                    sh.success_rate_24h,
                    sh.last_checked_at,
                    sh.error_code
                FROM synapse_service_health_snapshots AS sh
                INNER JOIN synapse_service_manifests AS sm ON sm.service_id = sh.service_id
                INNER JOIN synapse_owner_accounts AS oa ON oa.owner_id = sm.owner_id
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
            normalized_last_checked_at = self._epoch_ms(payload.get("lastCheckedAt")) or self._epoch_ms(last_checked_at)
            normalized_last_healthy_at = self._epoch_ms(payload.get("lastHealthyAt")) or self._epoch_ms(last_checked_at)
            result.append(
                ServiceTargetHealth(
                    serviceId=service_id,
                    ownerAddress=owner,
                    targetUrl=target_url,
                    weight=payload.get("weight"),
                    region=payload.get("region"),
                    status=str(
                        payload.get("status")
                        or (
                            "healthy"
                            if int(health_score or 0) >= HEALTHY_SCORE_THRESHOLD
                            else "unhealthy"
                        )
                    ),
                    overallStatus=payload.get("overallStatus"),
                    httpStatus=payload.get("httpStatus"),
                    latencyMs=latency_ms,
                    consecutiveSuccesses=int(payload.get("consecutiveSuccesses") or 0),
                    consecutiveFailures=int(payload.get("consecutiveFailures") or 0),
                    probeUrl=payload.get("probeUrl"),
                    lastCheckedAt=normalized_last_checked_at,
                    lastHealthyAt=normalized_last_healthy_at,
                    error=payload.get("error") or error_code,
                )
            )
        return result

    def write_service_target_health_rows(self, rows: List[ServiceTargetHealth]) -> None:
        with self._db.tx_cursor() as cur:
            self._delete_obsolete_service_health_snapshots(cur, rows)
            self._delete_obsolete_service_health_meta(cur, rows)
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
                        int(row.timeout_ms or 15000),
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
                    ON CONFLICT (service_id, endpoint_id)
                    DO UPDATE SET
                        health_score = EXCLUDED.health_score,
                        p95_latency_ms = EXCLUDED.p95_latency_ms,
                        success_rate_24h = EXCLUDED.success_rate_24h,
                        last_checked_at = EXCLUDED.last_checked_at,
                        error_code = EXCLUDED.error_code,
                        updated_at = EXCLUDED.updated_at
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
                "SELECT state_key, payload FROM synapse_runtime_state WHERE state_key LIKE 'service_health_history::%%' ORDER BY state_key ASC"
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
            payload = row.model_dump(by_alias=True, mode="json")
            service_id = str(payload.get("serviceId") or "").strip()
            if not service_id:
                continue
            grouped[service_id].append(payload)

        with self._db.tx_cursor() as cur:
            # Health history is maintained by multiple Cloud Run instances/jobs.
            # Serialize rewrites to avoid DELETE/UPSERT deadlocks on runtime_state.
            cur.execute(
                "SELECT pg_advisory_xact_lock(hashtext(%s))",
                ("synapse_runtime_state:service_health_history",),
            )
            if not grouped:
                cur.execute(
                    "DELETE FROM synapse_runtime_state "
                    "WHERE state_key LIKE 'service_health_history::%%'"
                )
                return

            state_keys = [
                self._history_state_key(service_id)
                for service_id in sorted(grouped)
            ]
            placeholders = self._scalar_not_in_clause(len(state_keys))
            cur.execute(
                "DELETE FROM synapse_runtime_state "
                "WHERE state_key LIKE 'service_health_history::%%' "
                f"AND state_key NOT IN ({placeholders})",
                tuple(state_keys),
            )
            for service_id in sorted(grouped):
                payload_rows = grouped[service_id]
                self._upsert_runtime_state(
                    cur,
                    self._history_state_key(service_id),
                    {"rows": payload_rows},
                )
