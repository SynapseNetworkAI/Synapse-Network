from typing import Any, Dict, Optional
from uuid import uuid4
import re

from fastapi import HTTPException

from src.core.config import settings
from src.storage.registry_repository import RegistryRepository
from src.storage import BaseStorage

_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]+$")
_SERVICE_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]+$")
_CREDENTIAL_PATTERN = re.compile(r"^agt_[A-Za-z0-9]+$")
_MAX_PROMPT_LENGTH = 8000
_MAX_SERVICE_ID_LENGTH = 128
_MAX_REQUEST_ID_LENGTH = 128
_MAX_CREDENTIAL_LENGTH = 128


def as_int(raw: Any, fallback: int) -> int:
    """Convert arbitrary input to int with a safe fallback for malformed values."""
    try:
        return int(raw)
    except Exception:
        return int(fallback)


def effective_service_constraints(service: Dict[str, Any]) -> Dict[str, int]:
    """Clamp seller constraints into platform-safe runtime boundaries."""
    raw = service.get("constraints") if isinstance(service.get("constraints"), dict) else {}
    timeout_ms = as_int(raw.get("timeoutMs"), settings.gateway_default_timeout_ms)
    max_request_bytes = as_int(raw.get("maxRequestBytes"), settings.gateway_default_request_bytes)
    max_response_bytes = as_int(raw.get("maxResponseBytes"), settings.gateway_default_response_bytes)
    max_qps = as_int(raw.get("maxQps"), settings.gateway_default_service_qps)

    timeout_ms = min(max(timeout_ms, settings.gateway_min_timeout_ms), settings.gateway_max_timeout_ms)
    max_request_bytes = min(max(max_request_bytes, settings.gateway_min_request_bytes), settings.gateway_max_request_bytes)
    max_response_bytes = min(max(max_response_bytes, settings.gateway_min_response_bytes), settings.gateway_max_response_bytes)
    max_qps = min(max(max_qps, settings.gateway_min_service_qps), settings.gateway_max_service_qps)

    return {
        "timeoutMs": timeout_ms,
        "maxRequestBytes": max_request_bytes,
        "maxResponseBytes": max_response_bytes,
        "maxQps": max_qps,
    }


def find_active_service(storage: BaseStorage, service_id: str) -> Dict[str, Any]:
    """Load one active service by serviceId, otherwise raise a gateway-safe HTTP error."""
    rows = RegistryRepository(storage).load_service_registry()

    target = next((r for r in rows if isinstance(r, dict) and str(r.get("serviceId", "")).strip() == service_id), None)
    if not target:
        raise HTTPException(status_code=404, detail={"code": "SERVICE_NOT_FOUND", "message": "Service not found"})
    if target.get("isActive") is False:
        raise HTTPException(status_code=403, detail={"code": "SERVICE_INACTIVE", "message": "Service is inactive"})
    return target


def parse_service_price_usdc(service_row: Dict[str, Any]) -> float:
    """Parse and validate service unit price in USDC with strict positivity checks."""
    pricing = service_row.get("pricing")
    raw_amount = pricing.get("amount") if isinstance(pricing, dict) else pricing
    try:
        amount = float(raw_amount)
    except Exception:
        raise HTTPException(status_code=500, detail={"code": "INVALID_SERVICE_PRICE", "message": "service pricing is invalid"})
    if amount <= 0:
        raise HTTPException(status_code=500, detail={"code": "INVALID_SERVICE_PRICE", "message": "service pricing must be positive"})
    return round(amount, 6)


def validate_service_id(x_service_id: Optional[str], request_service_id: Optional[str]) -> str:
    """Validate serviceId from header/body and enforce canonical allowed format."""
    service_id = (x_service_id or request_service_id or "").strip()
    if not service_id:
        raise HTTPException(status_code=422, detail={"code": "SERVICE_ID_REQUIRED", "message": "serviceId is required"})
    if x_service_id and request_service_id and x_service_id != request_service_id:
        raise HTTPException(status_code=403, detail={"code": "SERVICE_ID_MISMATCH", "message": "Header and body serviceId mismatch"})
    if len(service_id) > _MAX_SERVICE_ID_LENGTH or not _SERVICE_ID_PATTERN.fullmatch(service_id):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "SERVICE_ID_INVALID_FORMAT",
                "message": "serviceId format is invalid; only letters, digits, dot, underscore, colon, hyphen are allowed (max 128)",
            },
        )
    return service_id


def validate_prompt(prompt: str) -> str:
    """Validate buyer prompt for non-empty content and platform max length."""
    raw = str(prompt or "")
    if not raw.strip():
        raise HTTPException(status_code=422, detail={"code": "PROMPT_REQUIRED", "message": "prompt is required and cannot be empty"})
    if len(raw) > _MAX_PROMPT_LENGTH:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "PROMPT_TOO_LONG",
                "message": f"prompt exceeds max length {_MAX_PROMPT_LENGTH}",
                "maxLength": _MAX_PROMPT_LENGTH,
            },
        )
    return raw


def validate_credential_token(credential_token: Optional[str]) -> str:
    """Validate buyer credential token format before credential lookup."""
    token = str(credential_token or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail={"code": "CREDENTIAL_REQUIRED", "message": "X-Credential is required for /api/v1/gateway/generate"})
    if len(token) > _MAX_CREDENTIAL_LENGTH or not _CREDENTIAL_PATTERN.fullmatch(token):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "CREDENTIAL_FORMAT_INVALID",
                "message": "X-Credential format is invalid",
            },
        )
    return token


def resolve_request_id(client_request_id: Optional[str]) -> str:
    """Resolve client trace id or generate a UUID when the header is absent."""
    candidate = str(client_request_id or "").strip()
    if not candidate:
        return str(uuid4())
    if len(candidate) > _MAX_REQUEST_ID_LENGTH or not _REQUEST_ID_PATTERN.fullmatch(candidate):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INVALID_REQUEST_ID",
                "message": "X-Request-Id must match [A-Za-z0-9._:-] and be <= 128 chars",
            },
        )
    return candidate


def validate_invoke_request_contract(service: Dict[str, Any], payload: Dict[str, Any]) -> None:
    """Enforce runtime invoke contract: POST + JSON + required fields from schema."""
    invoke = service.get("invoke") if isinstance(service.get("invoke"), dict) else {}
    service_id = str(service.get("serviceId") or "unknown")

    method = str(invoke.get("method") or "POST").upper()
    if method != "POST":
        raise HTTPException(
            status_code=500,
            detail={
                "code": "INVALID_INVOKE_CONFIG",
                "message": "invoke.method must be POST",
            },
        )

    request_spec = invoke.get("request") if isinstance(invoke.get("request"), dict) else {}
    content_type = str(request_spec.get("contentType") or "application/json").strip().lower()
    if content_type != "application/json":
        raise HTTPException(
            status_code=500,
            detail={
                "code": "INVALID_INVOKE_CONFIG",
                "message": "invoke.request.contentType must be application/json",
            },
        )

    schema = request_spec.get("schema") if isinstance(request_spec.get("schema"), dict) else {}
    required = schema.get("required") if isinstance(schema.get("required"), list) else []
    missing_fields = [
        str(field)
        for field in required
        if isinstance(field, str) and (field not in payload or payload.get(field) is None)
    ]
    if missing_fields:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "REQUEST_REQUIRED_FIELDS_MISSING",
                "message": f"service {service_id} requires fields: {', '.join(missing_fields)}",
                "serviceId": service_id,
                "missingFields": missing_fields,
            },
        )