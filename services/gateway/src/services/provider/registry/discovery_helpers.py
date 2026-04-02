from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, Optional

from src.core.config import settings
from src.domain.registry import ServiceTargetHealth
from src.domain.service_contract import (
    AgentDiscoveryQueryRecord,
    ServiceDefinitionRecord,
    ServiceHealthTargetRecord,
    ServiceInvokeTargetRecord,
    ServiceRuntimeHealthRecord,
)

from .payload_helpers import public_health_summary_record


def target_health_record(
    payload: Dict[str, Any], target_url: str
) -> ServiceHealthTargetRecord:
    row_last_checked = int(payload.get("lastCheckedAt") or 0)
    return ServiceHealthTargetRecord(
        targetUrl=target_url,
        status=str(payload.get("status") or "unknown"),
        weight=int(payload.get("weight") or 100),
        region=payload.get("region"),
        httpStatus=payload.get("httpStatus"),
        latencyMs=payload.get("latencyMs"),
        consecutiveSuccesses=int(payload.get("consecutiveSuccesses") or 0),
        consecutiveFailures=int(payload.get("consecutiveFailures") or 0),
        probeUrl=payload.get("probeUrl"),
        lastCheckedAt=row_last_checked or None,
        lastHealthyAt=payload.get("lastHealthyAt"),
        error=payload.get("error"),
    )


def merge_health_row(
    index: Dict[str, ServiceRuntimeHealthRecord], payload: Dict[str, Any]
) -> None:
    service_id = str(payload.get("serviceId") or "").strip()
    target_url = str(payload.get("targetUrl") or "").strip()
    if not service_id or not target_url:
        return

    bucket = index.setdefault(service_id, ServiceRuntimeHealthRecord())
    next_target = target_health_record(payload, target_url)
    bucket.targets = [
        target for target in bucket.targets if target.target_url != target_url
    ] + [next_target]
    if int(next_target.last_checked_at or 0) > int(bucket.last_checked_at or 0):
        bucket.last_checked_at = next_target.last_checked_at
    overall_status = str(payload.get("overallStatus") or "").strip()
    if overall_status:
        bucket.overall_status = overall_status


def finalize_health_bucket(bucket: ServiceRuntimeHealthRecord) -> None:
    healthy_count = len(
        [target for target in bucket.targets if str(target.status or "").lower() == "healthy"]
    )
    total_targets = len(bucket.targets)
    bucket.healthy_targets = healthy_count
    bucket.total_targets = total_targets
    if bucket.overall_status and str(bucket.overall_status).lower() != "unknown":
        return
    if total_targets <= 0:
        bucket.overall_status = "unknown"
    elif healthy_count == total_targets:
        bucket.overall_status = "healthy"
    elif healthy_count > 0:
        bucket.overall_status = "degraded"
    else:
        bucket.overall_status = "unhealthy"


def build_runtime_health_index(raw_rows: Any) -> Dict[str, ServiceRuntimeHealthRecord]:
    if not isinstance(raw_rows, list):
        return {}

    index: Dict[str, ServiceRuntimeHealthRecord] = {}
    for row in raw_rows:
        if not isinstance(row, ServiceTargetHealth):
            continue
        merge_health_row(index, row.model_dump(by_alias=True))

    for bucket in index.values():
        finalize_health_bucket(bucket)
    return index


def apply_runtime_health(
    payload: ServiceDefinitionRecord,
    health_index: Dict[str, ServiceRuntimeHealthRecord],
) -> ServiceDefinitionRecord:
    service_id = str(payload.service_id or "").strip()
    health = health_index.get(service_id) if service_id else None
    if not isinstance(health, ServiceRuntimeHealthRecord):
        return payload

    payload = payload.model_copy(update={"runtime_health": health})
    if payload.invoke.targets:
        return payload

    return payload.model_copy(
        update={
            "invoke": payload.invoke.model_copy(
                update={
                    "targets": [
                        ServiceInvokeTargetRecord(
                            url=target.target_url,
                            weight=target.weight,
                            region=target.region,
                        )
                        for target in health.targets
                    ],
                    "timeout_ms": int(
                        payload.constraints.timeout_ms
                        or settings.gateway_default_timeout_ms
                    ),
                }
            )
        }
    )


def hydrate_service_runtime_health(
    raw_rows: Any, services: Any
) -> List[ServiceDefinitionRecord]:
    hydrated: List[ServiceDefinitionRecord] = []
    if not isinstance(services, list):
        return hydrated

    index = build_runtime_health_index(raw_rows)
    for row in services:
        if not isinstance(row, ServiceDefinitionRecord):
            continue
        hydrated.append(apply_runtime_health(row, index))
    return hydrated


def searchable_service_text(service: ServiceDefinitionRecord) -> str:
    return " ".join(
        [
            str(service.service_id or "").lower(),
            str(service.service_name or "").lower(),
            str(service.summary or "").lower(),
            str(service.search_index.search_text or "").lower()
            if service.search_index is not None
            else "",
            " ".join(str(tag).lower() for tag in service.tags),
        ]
    )


def service_matches_intent(service: ServiceDefinitionRecord, intent: str) -> bool:
    return intent.lower() in searchable_service_text(service)


def service_matches_tags(service: ServiceDefinitionRecord, tags: List[str]) -> bool:
    if not tags:
        return True
    service_tags = {str(tag).lower() for tag in service.tags}
    return any(str(tag).lower() in service_tags for tag in tags)


def service_matches_agent_search(
    service: ServiceDefinitionRecord,
    query: Optional[str],
    tags: List[str],
) -> bool:
    has_query = bool(str(query or "").strip())
    has_tags = bool(tags)
    query_match = service_matches_intent(service, str(query)) if has_query else False
    tag_match = service_matches_tags(service, tags) if has_tags else False

    if not has_query and not has_tags:
        return True
    if has_query and has_tags:
        return query_match or tag_match
    if has_query:
        return query_match
    return tag_match


def query_match_score(service: ServiceDefinitionRecord, query: Optional[str]) -> int:
    normalized_query = str(query or "").strip().lower()
    if not normalized_query:
        return 0
    haystack = searchable_service_text(service)
    tokens = [token for token in normalized_query.split() if token]
    if not tokens:
        return 0
    return sum(1 for token in tokens if token in haystack)


def service_health_score(service: ServiceDefinitionRecord) -> int:
    if service.search_index is not None and service.search_index.health_score is not None:
        return int(service.search_index.health_score)
    summary = public_health_summary_record(service)
    total_targets = max(1, int(summary.total_targets or 0))
    return int((int(summary.healthy_targets or 0) / total_targets) * 100)


def service_latency_ms(service: ServiceDefinitionRecord) -> int:
    if service.search_index is not None and service.search_index.p95_latency_ms is not None:
        return int(service.search_index.p95_latency_ms)
    return int(service.invoke.timeout_ms or settings.gateway_default_timeout_ms)


def service_success_rate(service: ServiceDefinitionRecord) -> Decimal:
    if service.search_index is not None and service.search_index.success_rate_24h is not None:
        return Decimal(str(service.search_index.success_rate_24h))
    score = service_health_score(service)
    return Decimal(score) / Decimal(100)


def sorted_discovery_services(
    services: List[ServiceDefinitionRecord],
    query: AgentDiscoveryQueryRecord,
) -> List[ServiceDefinitionRecord]:
    sort_key = str(query.sort or "best_match")
    if sort_key == "lowest_price":
        return sorted(
            services,
            key=lambda svc: (
                Decimal(str(svc.pricing_amount)),
                -service_health_score(svc),
                service_latency_ms(svc),
            ),
        )
    if sort_key == "fastest":
        return sorted(
            services,
            key=lambda svc: (
                service_latency_ms(svc),
                -service_health_score(svc),
                Decimal(str(svc.pricing_amount)),
            ),
        )
    if sort_key == "highest_reliability":
        return sorted(
            services,
            key=lambda svc: (
                -service_success_rate(svc),
                -service_health_score(svc),
                service_latency_ms(svc),
            ),
        )
    return sorted(
        services,
        key=lambda svc: (
            -query_match_score(svc, query.query),
            -service_health_score(svc),
            Decimal(str(svc.pricing_amount)),
            service_latency_ms(svc),
        ),
    )