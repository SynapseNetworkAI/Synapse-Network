"""Public-facing record builders and service lifecycle helpers.

Normalization helpers (validated_invoke_payload, normalized_*, bounded_constraint,
service_definition_payload, normalize_service_payload, etc.) live in
``service_normalization`` and are re-exported here so that existing import
sites (discovery, registration, health_history) continue to work unchanged.
"""
from __future__ import annotations

from typing import Any, List, Optional

from src.core.config import settings
from src.domain.service_contract import (
    PublicHealthSummaryRecord,
    PublicPricingRecord,
    PublicServiceDiscoveryRecord,
    QuoteInputPreviewRecord,
    QuoteRequestDraftRecord,
    RuntimePayloadRecord,
    ServiceDefinitionRecord,
    ServiceInvokeConfigRecord,
    ServiceInvokeTargetRecord,
)
from src.services.platform import service_health_service
from src.services.provider.registry.service_normalization import (  # re-exported
    JSON_CONTENT_TYPE,
    as_int,
    bind_forwarding_service_id,
    bounded_constraint,
    default_forwarding_payload,
    default_metering_payload,
    dict_payload,
    ensure_unique_service_id,
    generate_service_id,
    list_payload,
    normalize_service_payload,
    normalized_auth_payload,
    normalized_constraints,
    normalized_governance,
    normalized_health_check,
    normalized_invoke_config,
    normalized_invoke_targets,
    normalized_payout_account,
    normalized_provider_profile,
    normalized_service_lifecycle_status,
    resolved_auth_type,
    resolved_pricing,
    resolved_service_name,
    resolved_tags,
    require_range,
    service_definition_payload,
    validated_invoke_payload,
)


def build_public_invoke(
    svc: ServiceDefinitionRecord, public_gateway_url: Optional[str]
) -> ServiceInvokeConfigRecord:
    gateway_url = str(public_gateway_url or "").strip()
    if not gateway_url:
        gateway_url = "/api/v1/gateway/generate"

    return ServiceInvokeConfigRecord(
        method=svc.invoke.method,
        targets=[ServiceInvokeTargetRecord(url=gateway_url, weight=100, region=None)],
        timeoutMs=int(svc.invoke.timeout_ms or settings.gateway_default_timeout_ms),
        request=svc.invoke.request.model_copy(deep=True),
        response=svc.invoke.response.model_copy(deep=True),
    )


def public_health_summary_record(
    svc: ServiceDefinitionRecord,
) -> PublicHealthSummaryRecord:
    return PublicHealthSummaryRecord.model_validate(
        service_health_service.public_health_summary(svc)
    )


def quote_preview_sample(service: ServiceDefinitionRecord) -> RuntimePayloadRecord:
    for example in service.invoke.examples:
        if not isinstance(example, dict):
            continue
        input_payload = example.get("input") or example.get("request") or {}
        if isinstance(input_payload, dict):
            return RuntimePayloadRecord(body=dict(input_payload))
    return RuntimePayloadRecord()


def quote_input_preview(service: ServiceDefinitionRecord) -> QuoteInputPreviewRecord:
    return QuoteInputPreviewRecord(
        contentType=str(service.invoke.request.content_type or JSON_CONTENT_TYPE),
        payloadSchema=service.invoke.request.schema_document.model_copy(deep=True),
        sample=quote_preview_sample(service),
    )


def quote_request_draft(service: ServiceDefinitionRecord) -> QuoteRequestDraftRecord:
    return QuoteRequestDraftRecord(
        serviceId=service.service_id,
        inputPreview=quote_input_preview(service),
        responseMode="sync",
    )


def public_service_discovery_record(
    svc: ServiceDefinitionRecord, public_gateway_url: Optional[str]
) -> PublicServiceDiscoveryRecord:
    return PublicServiceDiscoveryRecord(
        serviceId=svc.service_id,
        serviceName=svc.service_name,
        pricing=PublicPricingRecord(
            amount=str(svc.pricing_amount),
            currency=svc.pricing_currency,
        ),
        summary=svc.summary,
        tags=list(svc.tags),
        status=service_health_service.public_discover_status(svc),
        health=public_health_summary_record(svc),
        invoke=build_public_invoke(svc, public_gateway_url),
        quoteTemplate=quote_request_draft(svc),
    )


def find_owned_service(
    rows: List[ServiceDefinitionRecord], service_record_id: str, owner_wallet: str
) -> ServiceDefinitionRecord | None:
    return next(
        (
            row
            for row in rows
            if row.service_id == service_record_id and row.owner_address == owner_wallet
        ),
        None,
    )


def service_lifecycle_status(service: ServiceDefinitionRecord) -> str:
    return normalized_service_lifecycle_status(
        service.status,
        is_active=bool(service.is_active),
    )


def is_deleted_service(service: ServiceDefinitionRecord) -> bool:
    return service_lifecycle_status(service) == "deleted"


def history_window_hours(hours: Optional[int], days: Optional[int]) -> tuple[int, int]:
    retention_hours = max(1, int(settings.service_health_history_retention_hours))
    if hours is not None:
        requested_hours = int(hours)
    elif days is not None:
        requested_hours = int(days) * 24
    else:
        requested_hours = retention_hours
    return retention_hours, max(1, min(requested_hours, retention_hours))


def history_entries_by_target(
    history: List[Any], service_record_id: str, cutoff_ms: int
) -> dict[str, List[dict[str, Any]]]:
    per_target: dict[str, List[dict[str, Any]]] = {}
    for row in history:
        if str(row.service_id or "") != service_record_id:
            continue
        checked_at = int(row.checked_at or 0)
        if checked_at < cutoff_ms:
            continue
        target_url = str(row.target_url or "").strip()
        if not target_url:
            continue
        per_target.setdefault(target_url, []).append(row.model_dump(by_alias=True))
    return per_target


def serialized_history_targets(
    per_target: dict[str, List[dict[str, Any]]], normalized_limit: int
) -> List[dict[str, Any]]:
    targets = []
    for target_url, entries in per_target.items():
        sorted_entries = sorted(
            entries, key=lambda item: int(item.get("checkedAt") or 0), reverse=True
        )
        latest = sorted_entries[0] if sorted_entries else None
        targets.append(
            {
                "targetUrl": target_url,
                "latestStatus": str((latest or {}).get("status") or "unknown"),
                "history": sorted_entries[:normalized_limit],
            }
        )
    targets.sort(key=lambda item: item["targetUrl"])
    return targets
