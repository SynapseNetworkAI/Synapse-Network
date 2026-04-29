from __future__ import annotations

import asyncio
from decimal import Decimal
from typing import Any

from src.domain.service_contract import AgentDiscoveryQueryRecord, PublicServiceDiscoveryRecord
from src.services.platform import service_health_service

from .discovery_helpers import (
    service_matches_agent_search,
    service_matches_intent,
    sorted_discovery_services,
)
from .interfaces import RegistryContext
from .payload_helpers import (
    is_deleted_service,
    public_service_discovery_record,
    service_lifecycle_status,
)
from .usage_helpers import (
    service_usage_metrics,
    settled_usage_metrics,
    sorted_console_discovery_services,
    usage_consumer,
)


async def discover_public_services(
    context: RegistryContext,
    intent: str | None = None,
    public_gateway_url: str | None = None,
    sort_by: str = "best_match",
    sort_order: str = "desc",
) -> list[PublicServiceDiscoveryRecord]:
    await asyncio.sleep(0)
    rows = context._load_service_registry_rows()
    available_services = [
        row
        for row in rows
        if not is_deleted_service(row)
        and service_health_service.is_service_discoverable(row)
    ]

    if intent:
        available_services = [
            svc for svc in available_services if service_matches_intent(svc, intent)
        ]

    usage_metrics = service_usage_metrics(
        context.storage.get_data_manager().system.gateway_state.read_invocation_billing_rows()
    )
    available_services = sorted_console_discovery_services(
        available_services,
        usage_metrics,
        intent,
        sort_by,
        sort_order,
    )

    return [
        public_service_discovery_record(svc, public_gateway_url)
        for svc in available_services
    ]


async def discover_services(
    context: RegistryContext,
    intent: str | None = None,
    public_gateway_url: str | None = None,
    sort_by: str = "best_match",
    sort_order: str = "desc",
) -> list[dict[str, Any]]:
    usage_metrics = service_usage_metrics(
        context.storage.get_data_manager().system.gateway_state.read_invocation_billing_rows()
    )
    public_services = await discover_public_services(
        context,
        intent=intent,
        public_gateway_url=public_gateway_url,
        sort_by=sort_by,
        sort_order=sort_order,
    )
    result: list[dict[str, Any]] = []
    for row in public_services:
        payload = row.model_dump(by_alias=True, exclude_none=True)
        metrics = usage_metrics.get(str(row.service_id or ""), {})
        payload["invocationCount"] = int(metrics.get("invocationCount") or 0)
        payload["totalRevenueUsdc"] = str(metrics.get("totalRevenueUsdc") or Decimal("0"))
        result.append(payload)
    return result


async def public_network_stats(context: RegistryContext) -> dict[str, Any]:
    await asyncio.sleep(0)
    rows = context._load_service_registry_rows()
    registered_services = [
        row
        for row in rows
        if not is_deleted_service(row)
        and bool(row.is_active)
        and str(row.status or "active").lower() == "active"
    ]
    discoverable_count = len(
        [
            service
            for service in registered_services
            if service_health_service.is_service_discoverable(service)
        ]
    )
    stale_count = len(
        [
            service
            for service in registered_services
            if service_health_service.effective_runtime_status(service) == "stale"
        ]
    )
    raw_usage_rows = context.storage.get_data_manager().system.gateway_state.read_invocation_billing_rows()
    dedup_by_request_id, status_counts = settled_usage_metrics(raw_usage_rows)
    connected_agents = {
        usage_consumer(row)
        for row in dedup_by_request_id.values()
        if usage_consumer(row)
    }

    return {
        "registeredServices": len(registered_services),
        "discoverableServices": discoverable_count,
        "staleServices": stale_count,
        "runtimeReadyServices": discoverable_count,
        "totalCalls": len(dedup_by_request_id),
        "connectedAgents": len(connected_agents),
        "statusBreakdown": dict(status_counts),
    }


async def search_agent_discovery(
    context: RegistryContext,
    query: AgentDiscoveryQueryRecord,
    public_gateway_url: str | None = None,
) -> list[PublicServiceDiscoveryRecord]:
    await asyncio.sleep(0)
    rows = context._load_service_registry_rows()
    available_services = [
        row for row in rows if service_health_service.is_service_discoverable(row)
    ]

    scoped_services = [
        svc
        for svc in available_services
        if service_matches_agent_search(svc, query.normalized_query, query.normalized_tags)
    ]

    ordered = sorted_discovery_services(scoped_services, query)
    start = (query.effective_page - 1) * query.effective_page_size
    end = start + query.effective_page_size
    limited = ordered[start:end]
    return [
        public_service_discovery_record(svc, public_gateway_url)
        for svc in limited
    ]


async def count_agent_discovery_results(
    context: RegistryContext,
    query: AgentDiscoveryQueryRecord,
) -> int:
    await asyncio.sleep(0)
    rows = context._load_service_registry_rows()
    available_services = [
        row for row in rows if service_health_service.is_service_discoverable(row)
    ]
    scoped_services = [
        svc
        for svc in available_services
        if service_matches_agent_search(svc, query.normalized_query, query.normalized_tags)
    ]
    return len(scoped_services)


async def list_owner_services(context: RegistryContext, owner_wallet: str) -> list[dict[str, Any]]:
    await asyncio.sleep(0)
    rows = context._load_service_registry_rows()
    owner_rows: list[dict[str, Any]] = []
    for svc in rows:
        if svc.owner_address != owner_wallet or is_deleted_service(svc):
            continue
        enriched = svc.model_dump(by_alias=True, mode="json")
        enriched["pricing"] = {
            "amount": str(svc.pricing_amount),
            "currency": svc.pricing_currency,
            "priceModel": svc.price_model or "fixed",
            "inputPricePer1MTokensUsdc": (
                str(svc.metering.input_price_per_1m_tokens_usdc)
                if svc.metering.input_price_per_1m_tokens_usdc is not None
                else None
            ),
            "outputPricePer1MTokensUsdc": (
                str(svc.metering.output_price_per_1m_tokens_usdc)
                if svc.metering.output_price_per_1m_tokens_usdc is not None
                else None
            ),
            "defaultMaxOutputTokens": svc.metering.default_max_output_tokens,
            "holdBufferMultiplier": (
                str(svc.metering.hold_buffer_multiplier)
                if svc.metering.hold_buffer_multiplier is not None
                else None
            ),
            "maxAutoHoldUsdc": (
                str(svc.metering.max_auto_hold_usdc)
                if svc.metering.max_auto_hold_usdc is not None
                else None
            ),
        }
        enriched["status"] = service_lifecycle_status(svc)
        enriched["health"] = service_health_service.public_health_summary(svc)
        enriched["runtimeAvailable"] = service_health_service.is_service_discoverable(svc)
        owner_rows.append(enriched)
    return owner_rows


async def health_status(
    context: RegistryContext,
    intent: str | None = None,
    include_inactive: bool = False,
) -> list[dict[str, Any]]:
    await asyncio.sleep(0)
    rows = context._load_service_registry_rows()
    scoped = []
    for row in rows:
        if not include_inactive and not bool(row.is_active):
            continue
        scoped.append(row)

    if intent:
        scoped = [svc for svc in scoped if service_matches_intent(svc, intent)]

    return [
        {
            "serviceId": svc.service_id,
            "serviceName": svc.service_name,
            "isActive": bool(svc.is_active),
            "status": str(svc.status or "unknown"),
            "health": service_health_service.public_health_summary(svc),
            "runtimeAvailable": service_health_service.is_service_discoverable(svc),
        }
        for svc in scoped
    ]
