"""Service payload normalization helpers.

Extracted from payload_helpers to keep each module under 500 lines.
These functions validate, normalize, and assemble service registration payloads.
They are imported by payload_helpers, which re-exports what external modules need.
"""
from __future__ import annotations

import random
import string
import time
from typing import Any, List, Literal, Optional, cast

from src.core.config import settings
from src.domain.service_contract import (
    ServiceConstraintRecord,
    ServiceDefinitionRecord,
    ServiceForwardingRecord,
    ServiceHealthCheckRecord,
    ServiceInvokeConfigRecord,
    ServiceInvokeTargetRecord,
    ServiceMeteringRecord,
    ServiceRequestSpecRecord,
    ServiceResponseSpecRecord,
    ServiceRetryPolicyRecord,
)
from src.services.provider.runtime_auth import auth_mode_for_endpoint_url
from src.utils.datetime_utils import to_dt_str

JSON_CONTENT_TYPE = "application/json"
HttpMethod = Literal["POST", "GET", "PUT", "PATCH", "DELETE"]
SERVICE_LIFECYCLE_STATUSES = {"draft", "active", "inactive", "suspended", "deleted"}
LEGACY_SERVICE_LIFECYCLE_STATUS = {
    "paused": "inactive",
    "archived": "deleted",
}


def _normalized_http_method(value: Any) -> HttpMethod:
    method = str(value or "POST").upper()
    if method not in {"POST", "GET", "PUT", "PATCH", "DELETE"}:
        raise ValueError("invoke.method is invalid")
    return cast(HttpMethod, method)


def as_int(raw: Any, fallback: int) -> int:
    try:
        return int(raw)
    except Exception:
        return int(fallback)


def require_range(name: str, value: int, lower: int, upper: int) -> int:
    if value < lower or value > upper:
        raise ValueError(f"{name} must be in [{lower}, {upper}]")
    return value


def dict_payload(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def list_payload(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def normalized_service_lifecycle_status(raw_status: Any, is_active: bool = True) -> str:
    status = str(raw_status or "").strip().lower()
    status = LEGACY_SERVICE_LIFECYCLE_STATUS.get(status, status)
    if not status:
        status = "active" if is_active else "inactive"
    if status not in SERVICE_LIFECYCLE_STATUSES:
        raise ValueError(
            "service status must be one of draft, active, inactive, suspended, deleted"
        )
    if status == "active" and not is_active:
        return "inactive"
    return status


def validated_invoke_payload(req_data: dict[str, Any]) -> dict[str, Any]:
    invoke = dict_payload(req_data.get("invoke"))
    if not invoke:
        raise ValueError("invoke is required")
    invoke_method = _normalized_http_method(invoke.get("method"))
    if invoke_method != "POST":
        raise ValueError("invoke.method must be POST")
    request_spec = dict_payload(invoke.get("request"))
    request_content_type = str(
        request_spec.get("contentType") or JSON_CONTENT_TYPE
    ).strip().lower()
    if request_content_type != JSON_CONTENT_TYPE:
        raise ValueError("invoke.request.contentType must be application/json")
    return invoke


def normalized_invoke_targets(
    invoke: dict[str, Any],
) -> List[ServiceInvokeTargetRecord]:
    targets = list_payload(invoke.get("targets"))
    if not targets:
        raise ValueError("invoke.targets must contain at least one target")

    normalized_targets = [
        ServiceInvokeTargetRecord(
            url=str(row.get("url") or "").strip(),
            weight=int(row.get("weight") or 100),
            region=row.get("region"),
        )
        for row in targets
        if isinstance(row, dict) and str(row.get("url") or "").strip()
    ]
    if not normalized_targets:
        raise ValueError("invoke.targets must contain valid URLs")
    return normalized_targets


def resolved_auth_type(
    targets: List[ServiceInvokeTargetRecord],
) -> str:
    auth_modes = {
        auth_mode_for_endpoint_url(target.url)
        for target in targets
        if str(target.url or "").strip()
    }
    if not auth_modes:
        return "gateway_forward"
    if len(auth_modes) > 1:
        raise ValueError("invoke.targets must use a consistent auth mode")
    return next(iter(auth_modes))


def normalized_health_check(req_data: dict[str, Any]) -> dict[str, Any]:
    health_check = dict_payload(req_data.get("healthCheck"))
    if not health_check:
        raise ValueError("healthCheck is required")
    health_path = str(health_check.get("path") or "").strip()
    if not health_path:
        raise ValueError("healthCheck.path is required")
    is_active = bool(req_data.get("isActive", True))
    lifecycle_status = normalized_service_lifecycle_status(
        req_data.get("status"), is_active=is_active
    )
    return {
        **health_check,
        "path": health_path if health_path.startswith("/") else f"/{health_path}",
    }


def normalized_provider_profile(req_data: dict[str, Any]) -> dict[str, Any] | None:
    provider_profile = dict_payload(req_data.get("providerProfile"))
    if not provider_profile:
        return None
    display_name = str(provider_profile.get("displayName") or "").strip()
    if not display_name:
        raise ValueError("providerProfile.displayName is required")
    return {"displayName": display_name}


def normalized_payout_account(req_data: dict[str, Any]) -> dict[str, Any] | None:
    payout_account = dict_payload(req_data.get("payoutAccount"))
    if not payout_account:
        return None
    payout_address = str(payout_account.get("payoutAddress") or "").strip()
    if not payout_address:
        raise ValueError("payoutAccount.payoutAddress is required")
    chain_id = as_int(payout_account.get("chainId"), 0)
    if chain_id <= 0:
        raise ValueError("payoutAccount.chainId must be greater than 0")
    settlement_currency = (
        str(payout_account.get("settlementCurrency") or "USDC").strip().upper() or "USDC"
    )
    status = str(payout_account.get("status") or "active").strip().lower() or "active"
    if status not in {"active", "paused", "archived"}:
        raise ValueError("payoutAccount.status must be one of active, paused, archived")
    return {
        "payoutAddress": payout_address,
        "chainId": chain_id,
        "settlementCurrency": settlement_currency,
        "status": status,
    }


def normalized_governance(req_data: dict[str, Any]) -> dict[str, Any] | None:
    governance = dict_payload(req_data.get("governance"))
    if not governance:
        return None
    note = str(governance.get("note") or "").strip() or None
    return {
        "termsAccepted": bool(governance.get("termsAccepted", False)),
        "riskAcknowledged": bool(governance.get("riskAcknowledged", False)),
        "note": note,
    }


def normalized_auth_payload(
    req_data: dict[str, Any],
    targets: List[ServiceInvokeTargetRecord],
) -> dict[str, Any]:
    auth_payload = dict_payload(req_data.get("auth"))
    inferred_type = resolved_auth_type(targets)
    auth_type = str(auth_payload.get("type") or "").strip()
    if inferred_type == "gateway_signed" and auth_type and auth_type != inferred_type:
        raise ValueError("auth.type must be gateway_signed for /provider-services targets")
    if not auth_type:
        return {
            **auth_payload,
            "type": inferred_type,
        }
    return {
        **auth_payload,
        "type": auth_type,
    }


def bounded_constraint(
    constraints: dict[str, Any],
    key: str,
    snake_key: str,
    fallback: int,
    lower: int,
    upper: int,
) -> int:
    return require_range(
        f"constraints.{key}",
        as_int(constraints.get(key) or constraints.get(snake_key) or fallback, fallback),
        lower,
        upper,
    )


def normalized_constraints(req_data: dict[str, Any]) -> ServiceConstraintRecord:
    constraints = dict_payload(req_data.get("constraints"))
    return ServiceConstraintRecord(
        timeoutMs=bounded_constraint(
            constraints,
            "timeoutMs",
            "timeout_ms",
            settings.gateway_default_timeout_ms,
            settings.gateway_min_timeout_ms,
            settings.gateway_max_timeout_ms,
        ),
        maxRequestBytes=bounded_constraint(
            constraints,
            "maxRequestBytes",
            "max_request_bytes",
            settings.gateway_default_request_bytes,
            settings.gateway_min_request_bytes,
            settings.gateway_max_request_bytes,
        ),
        maxResponseBytes=bounded_constraint(
            constraints,
            "maxResponseBytes",
            "max_response_bytes",
            settings.gateway_default_response_bytes,
            settings.gateway_min_response_bytes,
            settings.gateway_max_response_bytes,
        ),
        maxQps=bounded_constraint(
            constraints,
            "maxQps",
            "max_qps",
            settings.gateway_default_service_qps,
            settings.gateway_min_service_qps,
            settings.gateway_max_service_qps,
        ),
    )


def resolved_pricing(req_data: dict[str, Any]) -> tuple[str, str]:
    pricing_value = req_data.get("pricing")
    pricing_amount = req_data.get("pricingAmount") or "0"
    pricing_currency = str(req_data.get("pricingCurrency") or "USDC")
    if isinstance(pricing_value, dict):
        return (
            str(pricing_value.get("amount") or "0"),
            str(pricing_value.get("currency") or "USDC"),
        )
    if pricing_value is not None:
        return str(pricing_value), pricing_currency
    return str(pricing_amount), pricing_currency


def resolved_service_name(req_data: dict[str, Any]) -> str:
    return str(req_data.get("serviceName") or req_data.get("service_name") or "").strip()


def resolved_tags(req_data: dict[str, Any]) -> List[str]:
    tags_value = req_data.get("tags")
    if isinstance(tags_value, list):
        source = tags_value
    else:
        intent_value = req_data.get("intent")
        source = intent_value if isinstance(intent_value, list) else []
    return [str(tag) for tag in source if isinstance(tag, (str, int, float))]


def default_forwarding_payload(req_data: dict[str, Any]) -> dict[str, Any]:
    return {
        "requestIdHeader": "X-Synapse-Request-Id",
        "passThroughHeaders": ["X-Trace-Id", "X-Client-Version"],
        "injectHeaders": {
            "X-Synapse-Service-Id": str(req_data.get("serviceId") or "")
        },
        "retryPolicy": ServiceRetryPolicyRecord(
            maxAttempts=2,
            backoffMs=200,
            retryOnStatus=[429, 500, 502, 503, 504],
        ).model_dump(by_alias=True),
    }


def default_metering_payload() -> dict[str, Any]:
    return {
        "billingUnit": "per_call",
        "billOnError": False,
        "billableStatusClasses": [2],
        "requestIdRequired": True,
        "responseSizeMetering": True,
    }


def normalized_invoke_config(
    invoke: dict[str, Any],
    constraints: ServiceConstraintRecord,
    targets: List[ServiceInvokeTargetRecord],
) -> ServiceInvokeConfigRecord:
    request_spec = dict_payload(invoke.get("request"))
    response_spec = dict_payload(invoke.get("response"))
    return ServiceInvokeConfigRecord(
        method=_normalized_http_method(invoke.get("method")),
        targets=targets,
        timeoutMs=int(invoke.get("timeoutMs") or constraints.timeout_ms),
        request=ServiceRequestSpecRecord.model_validate(
            request_spec or {"contentType": JSON_CONTENT_TYPE, "schema": {}}
        ),
        response=ServiceResponseSpecRecord.model_validate(
            response_spec or {"contentType": JSON_CONTENT_TYPE, "schema": {}}
        ),
        headersTemplate=dict(invoke.get("headersTemplate") or {}),
        examples=list(invoke.get("examples") or []),
    )


def service_definition_payload(
    req_data: dict[str, Any],
    owner_wallet: str,
    service_name: str,
    tags: List[str],
    pricing_amount: str,
    pricing_currency: str,
    constraints: ServiceConstraintRecord,
    health_check: dict[str, Any],
    invoke: dict[str, Any],
    normalized_targets: List[ServiceInvokeTargetRecord],
) -> dict[str, Any]:
    forwarding_payload = dict_payload(req_data.get("forwarding"))
    metering_payload = dict_payload(req_data.get("metering"))
    return {
        "id": str(req_data.get("id") or "") or None,
        "serviceId": str(req_data.get("serviceId") or "").strip() or None,
        "schemaVersion": int(req_data.get("schemaVersion") or 2),
        "ownerAddress": owner_wallet,
        "serviceName": service_name,
        "summary": str(req_data.get("summary") or req_data.get("description") or "").strip(),
        "tags": tags,
        "pricingAmount": pricing_amount,
        "pricingCurrency": pricing_currency,
        "role": str(req_data.get("role") or "Provider"),
        "address": str(req_data.get("address") or owner_wallet),
        "status": lifecycle_status,
        "isActive": lifecycle_status == "active",
        "constraints": constraints,
        "auth": normalized_auth_payload(req_data, normalized_targets),
        "providerProfile": normalized_provider_profile(req_data),
        "payoutAccount": normalized_payout_account(req_data),
        "governance": normalized_governance(req_data),
        "healthCheck": ServiceHealthCheckRecord.model_validate(health_check),
        "forwarding": ServiceForwardingRecord.model_validate(
            forwarding_payload or default_forwarding_payload(req_data)
        ),
        "metering": ServiceMeteringRecord.model_validate(
            metering_payload or default_metering_payload()
        ),
        "invoke": normalized_invoke_config(invoke, constraints, normalized_targets),
        "createdAt": to_dt_str(req_data.get("createdAt"), "") or "",
        "updatedAt": to_dt_str(req_data.get("updatedAt"), "") or "",
    }


def normalize_service_payload(
    req_data: dict[str, Any], owner_wallet: str
) -> ServiceDefinitionRecord:
    invoke = validated_invoke_payload(req_data)
    normalized_targets = normalized_invoke_targets(invoke)
    health_check = normalized_health_check(req_data)
    constraints = normalized_constraints(req_data)
    pricing_amount, pricing_currency = resolved_pricing(req_data)
    service_name = resolved_service_name(req_data)
    tags = resolved_tags(req_data)

    return ServiceDefinitionRecord.model_validate(
        service_definition_payload(
            req_data,
            owner_wallet,
            service_name,
            tags,
            pricing_amount,
            pricing_currency,
            constraints,
            health_check,
            invoke,
            normalized_targets,
        )
    )


def _provider_short(owner_wallet: str) -> str:
    compact = "".join(ch for ch in owner_wallet.lower() if ch in string.hexdigits)
    return (compact[-2:] if len(compact) >= 2 else "SA").upper()


def generate_service_id(owner_wallet: str) -> str:
    time36 = format(int(time.time() * 1000), "x")[-6:].upper()
    rand4 = "".join(
        random.choice(string.ascii_uppercase + string.digits) for _ in range(4)
    )
    return f"SVC_{_provider_short(owner_wallet)}_{time36}_{rand4}"


def bind_forwarding_service_id(
    service_payload: ServiceDefinitionRecord,
) -> ServiceDefinitionRecord:
    service_id = str(service_payload.service_id or "").strip()
    if not service_id:
        return service_payload
    next_forwarding = service_payload.forwarding.model_copy(
        update={
            "inject_headers": {
                **service_payload.forwarding.inject_headers,
                "X-Synapse-Service-Id": service_id,
            }
        }
    )
    return service_payload.model_copy(update={"forwarding": next_forwarding})


def ensure_unique_service_id(
    rows: List[ServiceDefinitionRecord], service_id: str
) -> None:
    normalized_service_id = str(service_id or "").strip()
    if not normalized_service_id:
        return
    for row in rows:
        if str(row.service_id or "").strip() == normalized_service_id:
            raise ValueError(f"serviceId '{normalized_service_id}' already exists")
