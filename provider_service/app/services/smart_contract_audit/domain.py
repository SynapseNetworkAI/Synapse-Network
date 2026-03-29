from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import re
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.smart_contract_audit import (
    SmartContractAuditRequest,
    SmartContractAuditResponse,
)
from app.services.smart_contract_audit.adapters import FetchAttemptError


REPORT_KEY_SEGMENT_PATTERN = re.compile(r"[^a-z0-9]+")


def parse_zulu_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def to_zulu(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def source_fingerprint(source_bundle: str) -> str:
    return hashlib.sha256(source_bundle.encode("utf-8")).hexdigest()


def build_report_key(payload: SmartContractAuditRequest) -> str:
    if payload.contract_address and payload.chain:
        chain_key = REPORT_KEY_SEGMENT_PATTERN.sub("_", payload.chain.strip().lower()).strip("_")
        address_key = payload.contract_address.strip().lower()
        return f"{chain_key or 'chain'}__{address_key}__{payload.analysis_depth}"
    bundle = payload.source_bundle or ""
    return f"inline__{source_fingerprint(bundle)}__{payload.analysis_depth}"


class ContractAuditReportRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    report_key: str
    request: SmartContractAuditRequest
    response: SmartContractAuditResponse
    source_provider: str | None = None
    source_fingerprint: str | None = None
    source_generated_at: str | None = None
    expires_at: str | None = None
    observability_payload: dict = Field(default_factory=dict)

    @classmethod
    def from_response(
        cls,
        *,
        payload: SmartContractAuditRequest,
        response: SmartContractAuditResponse,
        fallback_attempts: tuple[FetchAttemptError, ...] = (),
    ) -> "ContractAuditReportRecord":
        source_provider = response.sources[0].name if response.sources else None
        inline_fingerprint = (
            source_fingerprint(payload.source_bundle)
            if payload.source_bundle is not None
            else None
        )
        return cls(
            report_key=build_report_key(payload),
            request=payload,
            response=response,
            source_provider=source_provider,
            source_fingerprint=inline_fingerprint,
            source_generated_at=response.freshness.generated_at,
            expires_at=None,
            observability_payload={
                "resolvedSourceProvider": source_provider,
                "fallbackAttempts": [
                    {
                        "providerName": attempt.provider_name,
                        "errorCode": attempt.error_code,
                        "message": attempt.message,
                    }
                    for attempt in fallback_attempts
                ],
            },
        )


class ProviderInvocationRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    invocation_id: str
    service_id: str
    request_id: str | None = None
    gateway_request_id: str | None = None
    caller_type: str = "gateway"
    input_payload: dict
    response_status: int
    error_code: str | None = None
    upstream_status: int | None = None
    latency_ms: int | None = None
    cache_hit: bool = False
    observability_payload: dict = Field(default_factory=dict)

    @classmethod
    def build(
        cls,
        *,
        service_id: str,
        input_payload: dict,
        response_status: int,
        request_id: str | None,
        gateway_request_id: str | None,
        error_code: str | None,
        upstream_status: int | None,
        latency_ms: int | None,
        cache_hit: bool,
        observability_payload: dict | None = None,
    ) -> "ProviderInvocationRecord":
        return cls(
            invocation_id=f"prov_{uuid4().hex}",
            service_id=service_id,
            request_id=request_id,
            gateway_request_id=gateway_request_id,
            input_payload=input_payload,
            response_status=response_status,
            error_code=error_code,
            upstream_status=upstream_status,
            latency_ms=latency_ms,
            cache_hit=cache_hit,
            observability_payload=observability_payload or {},
        )
