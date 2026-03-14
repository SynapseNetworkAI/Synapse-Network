from typing import Any, Dict, Tuple
import json
import random

import httpx
from fastapi import HTTPException

from src.services.forwarding_validation import effective_service_constraints, validate_invoke_request_contract

_MAX_TARGET_WEIGHT = 10000


def normalized_weighted_targets(invoke: Dict[str, Any]) -> Tuple[list[Dict[str, Any]], list[int]]:
    """Normalize upstream targets and validate routing weights for weighted random selection."""
    targets = invoke.get("targets") if isinstance(invoke.get("targets"), list) else []
    normalized_targets: list[Dict[str, Any]] = []
    normalized_weights: list[int] = []

    for item in targets:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        try:
            weight = int(item.get("weight") if item.get("weight") is not None else 100)
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
        normalized_targets.append(item)
        normalized_weights.append(weight)

    if not normalized_targets:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "INVALID_INVOKE_CONFIG",
                "message": "invoke.targets must contain at least one valid target URL",
            },
        )
    return normalized_targets, normalized_weights


def select_weighted_target_url(invoke: Dict[str, Any]) -> str:
    """Pick one upstream URL with weighted-random routing from normalized target list."""
    targets, weights = normalized_weighted_targets(invoke)
    selected = random.choices(targets, weights=weights, k=1)[0]
    return str(selected.get("url") or "").strip()


async def call_upstream(service: Dict[str, Any], prompt: str, request_id: str) -> Any:
    """Forward validated payload to seller upstream and enforce request/response size guards."""
    constraints = effective_service_constraints(service)
    request_payload = {"text": prompt}
    validate_invoke_request_contract(service, request_payload)
    request_bytes = len(json.dumps(request_payload, ensure_ascii=False).encode("utf-8"))
    if request_bytes > constraints["maxRequestBytes"]:
        raise HTTPException(
            status_code=413,
            detail={
                "code": "REQUEST_PAYLOAD_TOO_LARGE",
                "message": "Request payload exceeds service maxRequestBytes",
                "maxRequestBytes": constraints["maxRequestBytes"],
                "actualRequestBytes": request_bytes,
            },
        )

    invoke = service.get("invoke") if isinstance(service.get("invoke"), dict) else {}
    upstream_url = select_weighted_target_url(invoke)

    timeout_sec = float(constraints["timeoutMs"]) / 1000.0
    async with httpx.AsyncClient(timeout=timeout_sec) as client:
        headers = {"X-Request-Id": request_id}
        response = await client.post(upstream_url, json=request_payload, headers=headers)

        response_size = len(response.content or b"")
        if response_size > constraints["maxResponseBytes"]:
            raise HTTPException(
                status_code=413,
                detail={
                    "code": "RESPONSE_PAYLOAD_TOO_LARGE",
                    "message": "Response payload exceeds service maxResponseBytes",
                    "maxResponseBytes": constraints["maxResponseBytes"],
                    "actualResponseBytes": response_size,
                },
            )

        response.raise_for_status()
        data = response.json()
        if isinstance(data, dict) and "quote" in data:
            return data.get("quote")
        return data