"""Service registry repository — core helpers and upsert mixin."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from collections import defaultdict
from typing import Any, List

from src.domain.service_contract import (
    ServiceAuthRecord,
    ServiceConstraintRecord,
    ServiceDefinitionRecord,
    ServiceEndpointRecord,
    ServiceForwardingRecord,
    ServiceHealthCheckRecord,
    ServiceInvokeConfigRecord,
    ServiceInvokeTargetRecord,
    ServiceMeteringRecord,
    ServiceRequestSpecRecord,
    ServiceResponseSpecRecord,
    ServiceSearchIndexRecord,
)
from src.domain.registry import ServiceTargetHealth, ServiceTargetHealthHistory
from src.utils.datetime_utils import now_dt_str, to_dt_str

from ..database_manager import DatabaseManager



class ServiceRegistryCoreMixin:
    """Static helpers, ensure-owner, upsert methods through upsert_service_endpoints."""

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
    def _epoch_ms(value: Any) -> int | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            normalized = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
            return int(normalized.astimezone(timezone.utc).timestamp() * 1000)
        if isinstance(value, (int, float)):
            epoch = float(value)
            if epoch <= 0:
                return None
            if epoch < 1_000_000_000_000:
                epoch *= 1000
            return int(epoch)

        normalized = to_dt_str(value)
        if not normalized:
            return None
        try:
            parsed = datetime.strptime(normalized, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        except ValueError:
            return None
        return int(parsed.timestamp() * 1000)

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
    def _provider_id(wallet: str) -> str:
        return f"provider:{str(wallet or '').lower()}"

    @staticmethod
    def _endpoint_id(service_id: str, endpoint_url: str, index: int) -> str:
        suffix = hashlib.sha1(endpoint_url.encode("utf-8")).hexdigest()[:10]
        return f"{service_id}:ep:{index}:{suffix}"

    @staticmethod
    def _payout_account_id(provider_id: str, payout_address: str, chain_id: int) -> str:
        suffix = hashlib.sha1(
            f"{provider_id}:{payout_address.lower()}:{chain_id}".encode("utf-8")
        ).hexdigest()[:10]
        return f"{provider_id}:payout:{chain_id}:{suffix}"

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

    def _ensure_owner_and_provider(self, cur: Any, owner_wallet: str, display_name: str | None) -> tuple[str, str]:
        wallet = str(owner_wallet or "").lower()
        owner_id = self._owner_id(wallet)
        provider_id = self._provider_id(wallet)
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
            INSERT INTO synapse_provider_profiles (
                provider_id, owner_id, display_name, status, created_at, updated_at
            ) VALUES (%s, %s, %s, 'active', %s, %s)
            ON CONFLICT (provider_id)
            DO UPDATE SET
                owner_id = EXCLUDED.owner_id,
                display_name = EXCLUDED.display_name,
                updated_at = EXCLUDED.updated_at
            """,
            (
                provider_id,
                owner_id,
                (display_name or wallet).strip() or wallet,
                now_dt_str(),
                now_dt_str(),
            ),
        )
        return owner_id, provider_id

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

    @staticmethod
    def _serialize_request_spec(row: ServiceRequestSpecRecord) -> dict[str, Any]:
        return {
            "contentType": row.content_type,
            "schema": dict(row.schema_document.body),
        }

    @classmethod
    def _serialize_invoke(cls, row: ServiceInvokeConfigRecord) -> dict[str, Any]:
        return {
            "method": row.method,
            "targets": [target.model_dump(by_alias=True, mode="json") for target in row.targets],
            "timeoutMs": row.timeout_ms,
            "request": cls._serialize_request_spec(row.request),
            "response": {
                "contentType": row.response.content_type,
                "schema": dict(row.response.schema_document.body),
            },
            "headersTemplate": dict(row.headers_template),
            "examples": list(row.examples),
        }

    @staticmethod
    def _invoke_from_payload(
        payload: dict[str, Any],
        default_timeout_ms: int,
        fallback_endpoint: str | None,
    ) -> ServiceInvokeConfigRecord:
        targets_payload = payload.get("targets") if isinstance(payload.get("targets"), list) else []
        targets = [
            ServiceInvokeTargetRecord.model_validate(target)
            for target in targets_payload
            if isinstance(target, dict) and str(target.get("url") or "").strip()
        ]
        if not targets and fallback_endpoint:
            targets = [ServiceInvokeTargetRecord(url=fallback_endpoint, weight=100, region=None)]
        request_payload = payload.get("request") if isinstance(payload.get("request"), dict) else {}
        response_payload = payload.get("response") if isinstance(payload.get("response"), dict) else {}
        return ServiceInvokeConfigRecord(
            method=str(payload.get("method") or "POST").upper(),
            targets=targets,
            timeoutMs=int(payload.get("timeoutMs") or default_timeout_ms),
            request=ServiceRequestSpecRecord(
                contentType=str(request_payload.get("contentType") or "application/json"),
                schema={"body": dict(request_payload.get("schema") or {})},
            ),
            response=ServiceResponseSpecRecord(
                contentType=str(response_payload.get("contentType") or "application/json"),
                schema={"body": dict(response_payload.get("schema") or {})},
            ),
            headersTemplate=dict(payload.get("headersTemplate") or {}),
            examples=list(payload.get("examples") or []),
        )

    @classmethod
    def _service_meta_payload(
        cls,
        row: ServiceDefinitionRecord,
        created_at: str,
        updated_at: str,
    ) -> dict[str, Any]:
        return {
            "id": row.id,
            "schemaVersion": row.schema_version,
            "role": row.role,
            "address": row.address,
            "auth": row.auth.model_dump(by_alias=True, mode="json", exclude_none=True),
            "providerProfile": row.provider_profile.model_dump(
                by_alias=True, mode="json", exclude_none=True
            )
            if row.provider_profile is not None
            else None,
            "payoutAccount": row.payout_account.model_dump(
                by_alias=True, mode="json", exclude_none=True
            )
            if row.payout_account is not None
            else None,
            "governance": row.governance.model_dump(
                by_alias=True, mode="json", exclude_none=True
            )
            if row.governance is not None
            else None,
            "healthCheck": row.health_check.model_dump(by_alias=True, mode="json", exclude_none=True),
            "forwarding": row.forwarding.model_dump(by_alias=True, mode="json", exclude_none=True),
            "metering": row.metering.model_dump(by_alias=True, mode="json", exclude_none=True),
            "invoke": cls._serialize_invoke(row.invoke),
            "maxQps": row.constraints.max_qps,
            "maxRequestBytes": row.constraints.max_request_bytes,
            "maxResponseBytes": row.constraints.max_response_bytes,
            "createdAt": created_at,
            "updatedAt": updated_at,
        }

    @staticmethod
    def _created_updated_text(
        metadata: dict[str, Any], created_at: object, updated_at: object
    ) -> tuple[str, str]:
        return (
            to_dt_str(metadata.get("createdAt") or created_at, "") or "",
            to_dt_str(metadata.get("updatedAt") or updated_at, "") or "",
        )

    def _primary_endpoint_record(
        self,
        service_id: object,
        endpoint: object,
        endpoint_id: object,
        auth_mode: object,
        timeout_ms: object,
        max_payload_bytes: object,
        endpoint_status: object,
        created_at_text: str,
        updated_at_text: str,
    ) -> ServiceEndpointRecord | None:
        endpoint_url = str(endpoint or "").strip()
        if not endpoint_url:
            return None
        return ServiceEndpointRecord(
            endpointId=str(endpoint_id or self._endpoint_id(str(service_id), endpoint_url, 0)),
            serviceId=str(service_id),
            endpointUrl=endpoint_url,
            authMode=str(auth_mode or "gateway_forward"),
            timeoutMs=int(timeout_ms or 15000),
            maxPayloadBytes=int(max_payload_bytes or 4194304),
            isPrimary=True,
            status=str(endpoint_status or "active"),
            createdAt=created_at_text,
            updatedAt=updated_at_text,
        )

    @staticmethod
    def _constraints_from_row(
        metadata: dict[str, Any], timeout_ms: object, max_payload_bytes: object
    ) -> ServiceConstraintRecord:
        return ServiceConstraintRecord(
            timeoutMs=int(timeout_ms or 15000),
            maxQps=int(metadata.get("maxQps") or 100),
            maxRequestBytes=int(metadata.get("maxRequestBytes") or max_payload_bytes or 4194304),
            maxResponseBytes=int(metadata.get("maxResponseBytes") or max_payload_bytes or 4194304),
        )

    def _search_index_record(
        self,
        service_id: object,
        service_name: object,
        summary: object,
        tags_json: object,
        updated_at_text: str,
    ) -> ServiceSearchIndexRecord:
        tags = self._normalize_json_list(tags_json)
        return ServiceSearchIndexRecord(
            serviceId=str(service_id),
            tags=tags,
            searchText=" ".join(
                value
                for value in [
                    str(service_name or ""),
                    str(summary or ""),
                    " ".join(tags),
                ]
                if value
            ).strip(),
            updatedAt=updated_at_text,
        )

    @staticmethod
    def _manifest_timestamps(row: ServiceDefinitionRecord) -> tuple[str, str]:
        return (to_dt_str(row.created_at, now_dt_str()), to_dt_str(row.updated_at, now_dt_str()))

    def _upsert_service_manifest(
        self,
        cur: Any,
        row: ServiceDefinitionRecord,
        owner_id: str,
        provider_id: str,
        created_at: str,
        updated_at: str,
    ) -> None:
        cur.execute(
            """
            INSERT INTO synapse_service_manifests (
                service_id, owner_id, provider_id, service_name, manifest_version, status,
                description_for_model, task_category, capabilities_json,
                input_schema, output_schema, examples_json, limitations_json,
                price_model, base_price_usdc, quote_required,
                settlement_currency, created_at, updated_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s::jsonb,
                '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb,
                'fixed', %s, TRUE,
                %s, %s, %s
            )
            ON CONFLICT (service_id)
            DO UPDATE SET
                owner_id = EXCLUDED.owner_id,
                provider_id = EXCLUDED.provider_id,
                service_name = EXCLUDED.service_name,
                manifest_version = EXCLUDED.manifest_version,
                status = EXCLUDED.status,
                description_for_model = EXCLUDED.description_for_model,
                task_category = EXCLUDED.task_category,
                capabilities_json = EXCLUDED.capabilities_json,
                price_model = EXCLUDED.price_model,
                base_price_usdc = EXCLUDED.base_price_usdc,
                quote_required = EXCLUDED.quote_required,
                settlement_currency = EXCLUDED.settlement_currency,
                updated_at = EXCLUDED.updated_at
            """,
            (
                row.service_id,
                owner_id,
                provider_id,
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

    @staticmethod
    def _endpoint_targets(row: ServiceDefinitionRecord) -> list[ServiceInvokeTargetRecord]:
        endpoint_targets = list(row.invoke.targets)
        if not endpoint_targets and row.endpoint:
            return [ServiceInvokeTargetRecord(url=row.endpoint, weight=100, region=None)]
        return endpoint_targets

    def _deactivate_service_endpoints(
        self, cur: Any, service_id: str, updated_at: str
    ) -> None:
        cur.execute(
            """
            UPDATE synapse_service_endpoints
            SET is_primary = FALSE,
                status = 'paused',
                updated_at = %s
            WHERE service_id = %s
            """,
            (updated_at, service_id),
        )

    def _upsert_service_endpoints(
        self, cur: Any, row: ServiceDefinitionRecord, created_at: str, updated_at: str
    ) -> None:
        self._deactivate_service_endpoints(cur, str(row.service_id), updated_at)
        auth_mode = str(row.auth.auth_type or "gateway_forward").strip() or "gateway_forward"
        for index, target in enumerate(self._endpoint_targets(row)):
            endpoint_url = str(target.url or "").strip()
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
                    %s, %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s
                )
                ON CONFLICT (endpoint_id)
                DO UPDATE SET
                    service_id = EXCLUDED.service_id,
                    endpoint_url = EXCLUDED.endpoint_url,
                    auth_mode = EXCLUDED.auth_mode,
                    timeout_ms = EXCLUDED.timeout_ms,
                    max_payload_bytes = EXCLUDED.max_payload_bytes,
                    streaming_supported = EXCLUDED.streaming_supported,
                    async_supported = EXCLUDED.async_supported,
                    callback_supported = EXCLUDED.callback_supported,
                    region = EXCLUDED.region,
                    weight = EXCLUDED.weight,
                    is_primary = EXCLUDED.is_primary,
                    status = EXCLUDED.status,
                    updated_at = EXCLUDED.updated_at
                """,
                (
                    self._endpoint_id(row.service_id, endpoint_url, index),
                    row.service_id,
                    endpoint_url,
                    auth_mode,
                    int(row.constraints.timeout_ms or 15000),
                    int(row.constraints.max_request_bytes or 4194304),
                    False,
                    False,
                    False,
                    target.region,
                    int(target.weight or 100),
                    index == 0,
                    "active" if row.is_active else "paused",
                    created_at,
                    updated_at,
                ),
            )

