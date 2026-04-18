"""Quote and invocation record builders, persistence helpers, and state payload renderers."""
from __future__ import annotations

import hashlib
import json
from typing import Any, Optional
from uuid import uuid4

from fastapi import HTTPException

from src.domain.execution import InvocationRecord, ServiceQuoteRecord
from src.domain.identity import RuntimeCredentialRecord
from src.domain.invocation_response import (
    InvocationErrorInfo,
    InvocationErrorResponse,
    InvocationPendingResponse,
    InvocationReceiptRef,
    InvocationStateResponse,
    InvocationSuccessResponse,
)
from src.domain.service_contract import ServiceDefinitionRecord
from src.services.platform import credential_service
from src.storage import BaseStorage
from src.utils.datetime_utils import now_dt_str, to_dt_str


# ---------------------------------------------------------------------------
# Storage helper
# ---------------------------------------------------------------------------

def execution_repo(storage: BaseStorage) -> Any:
    repo = getattr(storage.get_data_manager().system, "execution", None)
    if repo is None:
        raise HTTPException(
            status_code=500,
            detail={"code": "EXECUTION_REPOSITORY_UNAVAILABLE", "message": "Execution repository is unavailable"},
        )
    return repo


# ---------------------------------------------------------------------------
# Request fingerprinting
# ---------------------------------------------------------------------------

def payload_digest(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Quote builders
# ---------------------------------------------------------------------------

def _quote_expiration_seconds(service: ServiceDefinitionRecord) -> int:
    return min(max(30, int(service.constraints.timeout_ms or 0) // 1000), 300)


def build_service_quote(
    service: ServiceDefinitionRecord,
    credential: RuntimeCredentialRecord,
    request_payload: dict[str, Any],
    unit_price: float,
    response_mode: str = "sync",
) -> ServiceQuoteRecord:
    created_at = now_dt_str()
    return ServiceQuoteRecord(
        quoteId=f"quote-{uuid4().hex}",
        serviceId=service.service_id,
        credentialId=credential.credential.credential_id,
        agentId=credential.agent.agent_id,
        quotedPriceUsdc=round(unit_price, 6),
        priceModel="fixed",
        status="OPEN",
        requestFingerprint=payload_digest({
            "serviceId": service.service_id,
            "credentialId": credential.credential.credential_id,
            "payload": request_payload,
        }),
        responseMode=response_mode,
        invokeConstraints={
            "body": service.invoke.request.schema_document.body,
            "timeoutMs": int(service.constraints.timeout_ms or 0),
            "maxPayloadBytes": int(service.constraints.max_request_bytes or 0),
        },
        expiresAt=to_dt_str(credential_service.now_ts() + _quote_expiration_seconds(service), created_at) or created_at,
        createdAt=created_at,
    )


def quote_with_status(quote: ServiceQuoteRecord, status: str) -> ServiceQuoteRecord:
    return quote.model_copy(update={"status": status})


# ---------------------------------------------------------------------------
# Invocation record builders
# ---------------------------------------------------------------------------

def build_invocation_record(
    service: ServiceDefinitionRecord,
    credential: RuntimeCredentialRecord,
    quote: ServiceQuoteRecord,
    idempotency_key: str,
    request_payload: dict[str, Any],
) -> InvocationRecord:
    created_at = now_dt_str()
    endpoint_id = service.primary_endpoint.endpoint_id if service.primary_endpoint is not None else None
    return InvocationRecord(
        invocationId=f"inv-{uuid4().hex}",
        quoteId=quote.quote_id,
        serviceId=service.service_id,
        endpointId=endpoint_id,
        credentialId=credential.credential.credential_id,
        agentId=credential.agent.agent_id,
        idempotencyKey=idempotency_key,
        requestDigest=payload_digest(request_payload),
        responseMode=quote.response_mode,
        status="PENDING",
        createdAt=created_at,
        updatedAt=created_at,
    )


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def persist_quote(storage: BaseStorage, quote: ServiceQuoteRecord) -> None:
    execution_repo(storage).upsert_quote(quote)


def persist_invocation(storage: BaseStorage, invocation: InvocationRecord) -> None:
    execution_repo(storage).upsert_invocation(invocation)


def read_invocation(storage: BaseStorage, invocation_id: str) -> InvocationRecord:
    record = execution_repo(storage).read_invocation(invocation_id)
    if record is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "INVOCATION_NOT_FOUND", "message": "Invocation not found"},
        )
    return record


def read_invocation_by_idempotency(
    storage: BaseStorage, credential_id: str, idempotency_key: str
) -> Optional[InvocationRecord]:
    return execution_repo(storage).read_invocation_by_idempotency(credential_id, idempotency_key)


# ---------------------------------------------------------------------------
# Invocation status/error helpers
# ---------------------------------------------------------------------------

def invocation_failure_status(error_code: Optional[str]) -> str:
    retryable = {
        "SERVICE_UNAVAILABLE",
        "SERVICE_TIMEOUT",
        "UPSTREAM_ERROR",
        "UPSTREAM_RATE_LIMITED",
        "RESPONSE_PAYLOAD_TOO_LARGE",
    }
    return "FAILED_RETRYABLE" if error_code in retryable else "FAILED_FINAL"


def invocation_error_action(error_code: Optional[str]) -> Optional[str]:
    if error_code in {
        "SERVICE_UNAVAILABLE",
        "SERVICE_TIMEOUT",
        "UPSTREAM_ERROR",
        "UPSTREAM_RATE_LIMITED",
    }:
        return "retry"
    return "fix_request" if error_code else None


# ---------------------------------------------------------------------------
# State payload renderers (consumed by router responses)
# ---------------------------------------------------------------------------

def invocation_error_payload(invocation: InvocationRecord) -> InvocationErrorResponse:
    status = str(invocation.status or "FAILED_FINAL")
    retryable = status == "FAILED_RETRYABLE"
    return InvocationErrorResponse(
        invocationId=invocation.invocation_id,
        status=status,
        error=InvocationErrorInfo(
            code=invocation.error_code or "INVOCATION_FAILED",
            message="Invocation failed",
            retryable=retryable,
            action=invocation.error_action or ("retry" if retryable else "stop"),
        ),
    )


def invocation_success_payload(invocation: InvocationRecord) -> InvocationSuccessResponse:
    return InvocationSuccessResponse(
        invocationId=invocation.invocation_id,
        status=str(invocation.status),
        chargedUsdc=round(float(invocation.charged_usdc), 6),
        result=invocation.result.payload,
        receipt=InvocationReceiptRef(
            quoteId=invocation.quote_id,
            invocationId=invocation.invocation_id,
        ),
    )


def invocation_state_payload(invocation: InvocationRecord) -> InvocationStateResponse:
    if invocation.status == "SUCCEEDED":
        return invocation_success_payload(invocation)
    if invocation.status in {"FAILED_RETRYABLE", "FAILED_FINAL"}:
        return invocation_error_payload(invocation)
    return InvocationPendingResponse(
        invocationId=invocation.invocation_id,
        status=str(invocation.status),
        chargedUsdc=round(float(invocation.charged_usdc), 6),
    )
