from typing import Any, Dict, Tuple
import json
import random

import httpx
from fastapi import HTTPException

from src.core.config import settings
from src.domain.service_contract import ServiceDefinitionRecord, ServiceInvokeConfigRecord
from src.services.platform import service_health_service
from src.services.buyer.forwarding_validation import (
    effective_service_constraints,
    validate_invoke_request_contract,
)

_MAX_TARGET_WEIGHT = 10000


def _parse_target_weight(raw_weight: Any) -> int:
    try:
        weight = int(raw_weight if raw_weight is not None else 100)
    except Exception:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "INVALID_INVOKE_CONFIG",
                "message": "invoke.targets[].weight must be an integer",
            },
        )
    if weight <= 0 or weight > _MAX_TARGET_WEIGHT:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "INVALID_INVOKE_CONFIG",
                "message": f"invoke.targets[].weight must be in [1, {_MAX_TARGET_WEIGHT}]",
            },
        )
    return weight


def normalized_weighted_targets(
    invoke: ServiceInvokeConfigRecord,
    allowed_target_urls: set[str] | None = None,
) -> Tuple[list[Dict[str, Any]], list[int]]:
    """Normalize upstream targets and validate routing weights for weighted random selection."""
    normalized_targets: list[Dict[str, Any]] = []
    normalized_weights: list[int] = []

    for item in invoke.targets:
        url = str(item.url or "").strip()
        if not url:
            continue
        if allowed_target_urls is not None and url not in allowed_target_urls:
            continue
        weight = _parse_target_weight(item.weight)
        normalized_targets.append(item.model_dump(by_alias=True, mode="json"))
        normalized_weights.append(weight)

    if not normalized_targets:
        if allowed_target_urls is not None:
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "SERVICE_UNAVAILABLE",
                    "message": "Service unavailable: no healthy upstream targets",
                },
            )
        raise HTTPException(
            status_code=500,
            detail={
                "code": "INVALID_INVOKE_CONFIG",
                "message": "invoke.targets must contain at least one valid target URL",
            },
        )
    return normalized_targets, normalized_weights


def select_weighted_target_url(
    invoke: ServiceInvokeConfigRecord, allowed_target_urls: set[str] | None = None
) -> str:
    """Pick one upstream URL with weighted-random routing from normalized target list."""
    targets, weights = normalized_weighted_targets(
        invoke, allowed_target_urls=allowed_target_urls
    )
    selected = random.choices(targets, weights=weights, k=1)[0]
    return str(selected.get("url") or "").strip()


async def call_upstream(service: ServiceDefinitionRecord, prompt: str, request_id: str) -> Any:
    """Forward validated payload to seller upstream and enforce request/response size guards."""
    constraints = effective_service_constraints(service)
    request_payload = {"text": prompt}
    validate_invoke_request_contract(service, request_payload)
    request_bytes = len(json.dumps(request_payload, ensure_ascii=False).encode("utf-8"))
    if request_bytes > constraints.max_request_bytes:
        raise HTTPException(
            status_code=413,
            detail={
                "code": "REQUEST_PAYLOAD_TOO_LARGE",
                "message": "Request payload exceeds service maxRequestBytes",
                "maxRequestBytes": constraints.max_request_bytes,
                "actualRequestBytes": request_bytes,
            },
        )

    healthy_target_urls = service_health_service.get_healthy_target_urls(service)
    allowed_urls = None
    if settings.forwarding_require_healthy_targets or healthy_target_urls:
        allowed_urls = set(healthy_target_urls)
    upstream_url = select_weighted_target_url(service.invoke, allowed_target_urls=allowed_urls)

    timeout_sec = float(constraints.timeout_ms) / 1000.0
    async with httpx.AsyncClient(timeout=timeout_sec) as client:
        headers = {"X-Request-Id": request_id}
        response = await client.post(
            upstream_url, json=request_payload, headers=headers
        )

        response_size = len(response.content or b"")
        if response_size > constraints.max_response_bytes:
            raise HTTPException(
                status_code=413,
                detail={
                    "code": "RESPONSE_PAYLOAD_TOO_LARGE",
                    "message": "Response payload exceeds service maxResponseBytes",
                    "maxResponseBytes": constraints.max_response_bytes,
                    "actualResponseBytes": response_size,
                },
            )

        response.raise_for_status()
        data = response.json()
        if isinstance(data, dict) and "quote" in data:
            return data.get("quote")
        return data
