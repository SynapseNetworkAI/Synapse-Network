from __future__ import annotations

from collections import Counter
from decimal import Decimal
from typing import Any, Dict, List, Optional

from src.domain.service_contract import ServiceDefinitionRecord

from .discovery_helpers import query_match_score, service_health_score

SETTLED_USAGE_STATUSES = {"accepted", "succeeded"}


def normalized_usage_row(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if hasattr(raw, "model_dump"):
        try:
            return raw.model_dump(by_alias=True, mode="json")
        except Exception:
            return {}
    return {}


def usage_status(row: Dict[str, Any]) -> str:
    return str(row.get("status") or "").strip().lower()


def usage_business_type(row: Dict[str, Any]) -> str:
    return str(row.get("businessType") or row.get("business_type") or "charge").strip().lower()


def usage_request_id(row: Dict[str, Any]) -> str:
    return str(row.get("requestId") or row.get("request_id") or row.get("id") or "").strip()


def usage_ts(row: Dict[str, Any]) -> int:
    try:
        return int(row.get("ts") or 0)
    except Exception:
        return 0


def usage_consumer(row: Dict[str, Any]) -> str:
    return str(row.get("consumerAddress") or "").strip().lower()


def usage_service_id(row: Dict[str, Any]) -> str:
    return str(row.get("serviceId") or row.get("service_id") or "").strip()


def usage_total_charge(row: Dict[str, Any]) -> Decimal:
    raw = (
        row.get("totalCharge")
        or row.get("total_charge")
        or row.get("chargedUsdc")
        or row.get("charged_usdc")
        or row.get("unitPrice")
        or row.get("unit_price")
        or 0
    )
    try:
        return Decimal(str(raw or 0))
    except Exception:
        return Decimal("0")


def settled_usage_metrics(raw_rows: Any) -> tuple[Dict[str, Dict[str, Any]], Dict[str, int]]:
    dedup_by_request_id: Dict[str, Dict[str, Any]] = {}
    status_counts: Counter[str] = Counter()

    if not isinstance(raw_rows, list):
        return dedup_by_request_id, dict(status_counts)

    for raw in raw_rows:
        row = normalized_usage_row(raw)
        if not row or usage_business_type(row) != "charge":
            continue

        status = usage_status(row)
        status_counts[status or "unknown"] += 1
        if status not in SETTLED_USAGE_STATUSES:
            continue

        request_id = usage_request_id(row)
        if not request_id:
            continue

        current = dedup_by_request_id.get(request_id)
        if current is None or usage_ts(row) >= usage_ts(current):
            dedup_by_request_id[request_id] = row

    return dedup_by_request_id, dict(status_counts)


def service_usage_metrics(raw_rows: Any) -> Dict[str, Dict[str, Any]]:
    dedup_by_request_id, _ = settled_usage_metrics(raw_rows)
    metrics: Dict[str, Dict[str, Any]] = {}

    for row in dedup_by_request_id.values():
        service_id = usage_service_id(row)
        if not service_id:
            continue

        bucket = metrics.setdefault(
            service_id,
            {
                "invocationCount": 0,
                "totalRevenueUsdc": Decimal("0"),
                "lastInvocationAt": 0,
            },
        )
        bucket["invocationCount"] = int(bucket["invocationCount"] or 0) + 1
        bucket["totalRevenueUsdc"] = Decimal(str(bucket["totalRevenueUsdc"] or 0)) + usage_total_charge(row)
        bucket["lastInvocationAt"] = max(
            int(bucket.get("lastInvocationAt") or 0),
            usage_ts(row),
        )

    return metrics


def console_sort_metric_tuple(
    svc: ServiceDefinitionRecord,
    usage_metrics: Dict[str, Dict[str, Any]],
) -> tuple[int, Decimal, float]:
    metrics = usage_metrics.get(str(svc.service_id or ""), {})
    return (
        int(metrics.get("invocationCount") or 0),
        Decimal(str(metrics.get("totalRevenueUsdc") or 0)),
        service_health_score(svc),
    )


def sorted_console_discovery_services(
    services: List[ServiceDefinitionRecord],
    usage_metrics: Dict[str, Dict[str, Any]],
    intent: Optional[str],
    sort_by: str,
    sort_order: str,
) -> List[ServiceDefinitionRecord]:
    normalized_sort_by = str(sort_by or "best_match").strip().lower()
    normalized_sort_order = str(sort_order or "desc").strip().lower()
    reverse = normalized_sort_order != "asc"

    if normalized_sort_by == "price":
        return sorted(
            services,
            key=lambda svc: (
                Decimal(str(svc.pricing_amount)),
                -service_health_score(svc),
                str(svc.service_name or svc.service_id or "").lower(),
            ),
            reverse=reverse,
        )

    if normalized_sort_by == "health":
        return sorted(
            services,
            key=lambda svc: (
                service_health_score(svc),
                -query_match_score(svc, intent),
                str(svc.service_name or svc.service_id or "").lower(),
            ),
            reverse=reverse,
        )

    if normalized_sort_by == "invocation_count":
        return sorted(
            services,
            key=lambda svc: console_sort_metric_tuple(svc, usage_metrics),
            reverse=reverse,
        )

    if normalized_sort_by == "revenue":
        return sorted(
            services,
            key=lambda svc: tuple(reversed(console_sort_metric_tuple(svc, usage_metrics)[:2]))
            + (service_health_score(svc),),
            reverse=reverse,
        )

    if normalized_sort_by == "service_name":
        return sorted(
            services,
            key=lambda svc: str(svc.service_name or svc.service_id or "").lower(),
            reverse=reverse,
        )

    ranked = sorted(
        services,
        key=lambda svc: (
            query_match_score(svc, intent),
            service_health_score(svc),
            *console_sort_metric_tuple(svc, usage_metrics)[:2],
        ),
        reverse=True,
    )
    if reverse:
        return ranked
    return list(reversed(ranked))