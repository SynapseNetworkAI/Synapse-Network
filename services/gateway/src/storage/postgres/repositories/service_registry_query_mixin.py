"""Service registry repository — provider payout, persist, and query mixin."""
# ruff: noqa: S608  # reason: dynamic registry filters use controlled fragments with parameterized values
from __future__ import annotations

import json
from typing import Any, List

from src.domain.service_contract import (
    ServiceAuthRecord,
    ServiceDefinitionRecord,
    ServiceForwardingRecord,
    ServiceHealthCheckRecord,
    ServiceMeteringRecord,
)

SERVICE_DEFINITION_ROW_COLUMNS = 19


class ServiceRegistryQueryMixin:
    """Provider payout, search index, and service definition row operations."""

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

    def _build_service_definition(
        self, row: tuple[object, ...]
    ) -> ServiceDefinitionRecord | None:
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
        created_at_text, updated_at_text = self._created_updated_text(
            metadata, created_at, updated_at
        )
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
            providerProfile=self._normalize_json_object(
                metadata.get("providerProfile")
            )
            or None,
            payoutAccount=self._normalize_json_object(metadata.get("payoutAccount"))
            or None,
            governance=self._normalize_json_object(metadata.get("governance")) or None,
            healthCheck=ServiceHealthCheckRecord.model_validate(
                self._normalize_json_object(metadata.get("healthCheck"))
            ),
            forwarding=ServiceForwardingRecord.model_validate(
                self._normalize_json_object(metadata.get("forwarding"))
            ),
            metering=ServiceMeteringRecord.model_validate(
                self._normalize_json_object(metadata.get("metering"))
            ),
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
