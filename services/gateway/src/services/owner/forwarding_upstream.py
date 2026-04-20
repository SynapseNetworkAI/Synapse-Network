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
from src.services.owner.downstream_concurrency import (
    DownstreamPermit,
    acquire_downstream_permit,
)
from src.services.owner.forwarding_validation import (
    effective_service_constraints,
    validate_invoke_request_contract,
)

_MAX_TARGET_WEIGHT = 10000
_shared_upstream_client: httpx.AsyncClient | None = None
_shared_upstream_client_factory: Any = None


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


class UpstreamCallPlan:
    def __init__(self, target_url: str, permit: DownstreamPermit) -> None:
        self.target_url = target_url
        self.permit = permit


def _upstream_timeout(timeout_sec: float) -> httpx.Timeout:
    return httpx.Timeout(
        timeout_sec,
        connect=settings.provider_http_client_connect_timeout_sec,
        read=timeout_sec,
        write=settings.provider_http_client_write_timeout_sec,
        pool=settings.provider_http_client_pool_timeout_sec,
    )


def _create_upstream_http_client(timeout_sec: float) -> httpx.AsyncClient:
    timeout = _upstream_timeout(timeout_sec)
    limits = httpx.Limits(
        max_connections=settings.provider_http_client_max_connections,
        max_keepalive_connections=settings.provider_http_client_max_keepalive_connections,
    )
    try:
        return httpx.AsyncClient(timeout=timeout, limits=limits)
    except TypeError:
        # Unit tests monkeypatch httpx.AsyncClient with small fakes that only
        # accept timeout. Keep those tests focused on routing behavior.
        return httpx.AsyncClient(timeout=timeout_sec)


def _get_upstream_http_client(timeout_sec: float) -> httpx.AsyncClient:
    global _shared_upstream_client, _shared_upstream_client_factory
    if not settings.provider_http_client_pool_enabled:
        return _create_upstream_http_client(timeout_sec)

    factory = httpx.AsyncClient
    if _shared_upstream_client is None or _shared_upstream_client_factory is not factory:
        _shared_upstream_client = _create_upstream_http_client(timeout_sec)
        _shared_upstream_client_factory = factory
    return _shared_upstream_client


async def close_upstream_http_client() -> None:
    global _shared_upstream_client, _shared_upstream_client_factory
    client = _shared_upstream_client
    _shared_upstream_client = None
    _shared_upstream_client_factory = None
    if client is not None and hasattr(client, "aclose"):
        await client.aclose()


async def prepare_upstream_call(
    service: ServiceDefinitionRecord,
    request_payload: dict[str, Any],
) -> UpstreamCallPlan:
    """Validate routing and acquire downstream capacity before billing."""
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
    permit = await acquire_downstream_permit(service, upstream_url)
    return UpstreamCallPlan(upstream_url, permit)


async def call_upstream(
    service: ServiceDefinitionRecord,
    invocation: InvocationRecord,
    request_payload: dict[str, Any],
    call_plan: UpstreamCallPlan | None = None,
) -> InvocationResultRecord:
    """Forward validated payload to provider upstream and enforce request/response size guards."""
    constraints = effective_service_constraints(service)
    validate_invoke_request_contract(service, request_payload)
    if call_plan is None:
        call_plan = await prepare_upstream_call(service, request_payload)

    timeout_sec = float(constraints.timeout_ms) / 1000.0
    started = time.perf_counter()
    status_code: int | None = None
    error_code: str | None = None
    success = False
    try:
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
        if settings.provider_http_client_pool_enabled:
            client = _get_upstream_http_client(timeout_sec)
            response = await client.post(
                call_plan.target_url, json=request_payload, headers=headers
            )
        else:
            async with _create_upstream_http_client(timeout_sec) as client:
                response = await client.post(
                    call_plan.target_url, json=request_payload, headers=headers
                )

        status_code = int(getattr(response, "status_code", 200) or 200)
        response_size = len(response.content or b"")
        if response_size > constraints.max_response_bytes:
            error_code = "RESPONSE_PAYLOAD_TOO_LARGE"
            raise HTTPException(
                status_code=413,
                detail={
                    "code": error_code,
                    "message": "Response payload exceeds service maxResponseBytes",
                    "maxResponseBytes": constraints.max_response_bytes,
                    "actualResponseBytes": response_size,
                },
            )

        if status_code >= 400:
            error_code = "UPSTREAM_RATE_LIMITED" if status_code == 429 else "UPSTREAM_ERROR"
            raise HTTPException(
                status_code=502 if status_code != 429 else 503,
                detail={
                    "code": error_code,
                    "message": f"Upstream provider returned HTTP {status_code}",
                    "upstreamStatus": status_code,
                },
            )

        data = response.json()
        payload = _response_payload(data)
        success = True
        return InvocationResultRecord(digest=_payload_digest(payload), payload=payload)
    except httpx.PoolTimeout:
        error_code = "SERVICE_BUSY"
        raise HTTPException(
            status_code=503,
            detail={
                "code": error_code,
                "message": "Gateway upstream HTTP connection pool is saturated",
            },
        )
    except httpx.TimeoutException:
        error_code = "SERVICE_TIMEOUT"
        raise HTTPException(
            status_code=504,
            detail={
                "code": error_code,
                "message": "Upstream provider timed out",
            },
        )
    except HTTPException as exc:
        if isinstance(exc.detail, dict):
            error_code = str(exc.detail.get("code") or error_code or "UPSTREAM_ERROR")
        raise
    except Exception as exc:
        error_code = "UPSTREAM_ERROR"
        raise HTTPException(
            status_code=502,
            detail={"code": error_code, "message": f"Upstream provider failed: {exc}"},
        )
    finally:
        latency_ms = int((time.perf_counter() - started) * 1000)
        if call_plan is not None:
            await call_plan.permit.release(
                latency_ms=latency_ms,
                status_code=status_code,
                error_code=error_code,
                success=success,
            )
