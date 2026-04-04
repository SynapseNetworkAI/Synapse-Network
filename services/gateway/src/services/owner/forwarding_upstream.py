from __future__ import annotations

from typing import Any
import hashlib
import hmac
import json
import random
import time

import httpx
from fastapi import HTTPException

from src.core.config import settings
from src.domain.execution import InvocationRecord, InvocationResultRecord
from src.domain.service_contract import ServiceDefinitionRecord, ServiceInvokeConfigRecord
from src.services.platform import service_health_service
from src.services.owner.forwarding_validation import (
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
) -> tuple[list[str], list[int]]:
    """Normalize upstream targets and validate routing weights for weighted random selection."""
    normalized_targets: list[str] = []
    normalized_weights: list[int] = []

    for item in invoke.targets:
        url = str(item.url or "").strip()
        if not url:
            continue
        if allowed_target_urls is not None and url not in allowed_target_urls:
            continue
        weight = _parse_target_weight(item.weight)
        normalized_targets.append(url)
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
    return str(random.choices(targets, weights=weights, k=1)[0] or "").strip()


def _response_payload(raw_payload: Any) -> dict[str, Any]:
    if isinstance(raw_payload, dict) and "quote" in raw_payload:
        raw_payload = raw_payload.get("quote")
    if isinstance(raw_payload, dict):
        return dict(raw_payload)
    return {"result": raw_payload}


def _payload_digest(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _resolved_auth_mode(service: ServiceDefinitionRecord) -> str:
    if service.primary_endpoint is not None and str(service.primary_endpoint.auth_mode or "").strip():
        return str(service.primary_endpoint.auth_mode).strip()
    return str(service.auth.auth_type or "").strip() or "gateway_forward"


def _gateway_signature(payload: dict[str, Any], service_id: str, timestamp: int) -> str:
    canonical = f"{service_id}.{timestamp}.{_payload_digest(payload)}"
    secret = settings.gateway_provider_signature_secret.encode("utf-8")
    return hmac.new(secret, canonical.encode("utf-8"), hashlib.sha256).hexdigest()


async def call_upstream(
    service: ServiceDefinitionRecord,
    invocation: InvocationRecord,
    request_payload: dict[str, Any],
) -> InvocationResultRecord:
    """Forward validated payload to provider upstream and enforce request/response size guards."""
    constraints = effective_service_constraints(service)
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
        request_id_header = str(service.forwarding.request_id_header or "X-Request-Id").strip() or "X-Request-Id"
        headers = {request_id_header: invocation.idempotency_key}
        if _resolved_auth_mode(service) == "gateway_signed":
            signed_at = int(time.time())
            headers.update(
                {
                    "X-Synapse-Service-Id": str(service.service_id or "").strip(),
                    "X-Synapse-Signed-At": str(signed_at),
                    "X-Synapse-Signature": _gateway_signature(
                        request_payload,
                        str(service.service_id or "").strip(),
                        signed_at,
                    ),
                }
            )
        for key, value in service.invoke.headers_template.items():
            if isinstance(key, str) and key.strip() and isinstance(value, str):
                headers[key] = value
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
        payload = _response_payload(data)
        return InvocationResultRecord(digest=_payload_digest(payload), payload=payload)
