from __future__ import annotations

from datetime import UTC, datetime
import time

from fastapi import HTTPException

from app.schemas.sentiment import FreshnessRecord, ServiceDescriptor, SourceRecord
from app.schemas.smart_contract_audit import (
    SmartContractAuditRequest,
    SmartContractAuditResponse,
    SmartContractAuditResult,
)
from app.services.smart_contract_audit import (
    analyze_source_bundle,
    resolve_target_identifier,
)
from app.services.smart_contract_audit.adapters import (
    FetchAttemptError,
    VerifiedSourceBundle,
    VerifiedSourceFetchError,
    fetch_verified_source_bundle_with_fallback,
)
from app.services.smart_contract_audit.domain import (
    ContractAuditReportRecord,
    ProviderInvocationRecord,
)
from app.services.smart_contract_audit.repository import (
    SmartContractAuditRepository,
    get_smart_contract_audit_repository,
)


SERVICE_ID = "svc_smart_contract_audit"
SERVICE_NAME = "Smart Contract Audit Model"
SERVICE_VERSION = "1.0.0"


def _now_zulu() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


async def fetch_verified_source_bundle(
    *,
    chain: str,
    contract_address: str,
) -> tuple[VerifiedSourceBundle, tuple[FetchAttemptError, ...]]:
    try:
        return await fetch_verified_source_bundle_with_fallback(
            chain=chain,
            contract_address=contract_address,
        )
    except VerifiedSourceFetchError as exc:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "VERIFIED_SOURCE_NOT_FOUND",
                "message": str(exc),
                "target": f"{chain}:{contract_address}",
                "fallback_attempts": [
                    {
                        "providerName": attempt.provider_name,
                        "errorCode": attempt.error_code,
                        "message": attempt.message,
                    }
                    for attempt in exc.attempts
                ],
            },
        ) from exc
    except LookupError as exc:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "VERIFIED_SOURCE_NOT_FOUND",
                "message": str(exc),
                "target": f"{chain}:{contract_address}",
            },
        ) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail={
                "code": "VERIFIED_SOURCE_FETCH_FAILED",
                "message": f"Failed to fetch verified source from upstream providers: {exc}",
                "target": f"{chain}:{contract_address}",
            },
        ) from exc


async def build_smart_contract_audit(
    payload: SmartContractAuditRequest,
) -> tuple[SmartContractAuditResponse, tuple[FetchAttemptError, ...]]:
    source_bundle = payload.source_bundle
    sources: list[SourceRecord] = []
    errors = []
    fallback_attempts: tuple[FetchAttemptError, ...] = ()
    if source_bundle is None:
        verified_bundle, fallback_attempts = await fetch_verified_source_bundle(
            chain=payload.chain or "",
            contract_address=payload.contract_address or "",
        )
        source_bundle = verified_bundle.source_bundle
        sources.append(
            SourceRecord(
                name=verified_bundle.provider_name,
                freshnessSec=verified_bundle.freshness_sec,
            )
        )
    else:
        sources.append(SourceRecord(name="provided_source_bundle", freshnessSec=0))

    report = analyze_source_bundle(
        source_bundle,
        analysis_depth=payload.analysis_depth,
        include_evidence=payload.include_evidence,
    )
    sources.append(SourceRecord(name="synapse_rule_engine", freshnessSec=0))

    return SmartContractAuditResponse(
        service=ServiceDescriptor(
            serviceId=SERVICE_ID,
            serviceName=SERVICE_NAME,
            version=SERVICE_VERSION,
        ),
        sources=sources,
        freshness=FreshnessRecord(
            generatedAt=_now_zulu(),
            maxSourceAgeSec=max(source.freshness_sec for source in sources),
            cacheHit=False,
        ),
        result=SmartContractAuditResult(
            target=resolve_target_identifier(
                chain=payload.chain,
                contract_address=payload.contract_address,
            ),
            riskScore=report.risk_score,
            riskLevel=report.risk_level,
            criticalFindings=list(report.findings),
            attackSurfaceSummary=report.attack_surface_summary,
            fixSuggestions=list(report.fix_suggestions),
            analysisMode=payload.analysis_depth,
        ),
        errors=errors,
    ), fallback_attempts


def _resolve_error_code(exc: Exception) -> str:
    if isinstance(exc, HTTPException):
        detail = exc.detail
        if isinstance(detail, dict):
            code = detail.get("code")
            if isinstance(code, str) and code.strip():
                return code
    return "SMART_CONTRACT_AUDIT_REQUEST_FAILED"


def _resolve_upstream_status(exc: Exception) -> int | None:
    if isinstance(exc, HTTPException):
        detail = exc.detail
        if isinstance(detail, dict):
            value = detail.get("upstream_status")
            if isinstance(value, int):
                return value
    return None


def _observability_payload(
    *,
    resolved_source_provider: str | None,
    fallback_attempts: tuple[FetchAttemptError, ...],
) -> dict:
    return {
        "resolvedSourceProvider": resolved_source_provider,
        "fallbackAttempts": [
            {
                "providerName": attempt.provider_name,
                "errorCode": attempt.error_code,
                "message": attempt.message,
            }
            for attempt in fallback_attempts
        ],
    }


async def execute_smart_contract_audit(
    payload: SmartContractAuditRequest,
    *,
    request_id: str | None,
    gateway_request_id: str | None,
    repository: SmartContractAuditRepository | None = None,
) -> SmartContractAuditResponse:
    current_repository = repository or get_smart_contract_audit_repository()
    started = time.perf_counter()
    try:
        response, fallback_attempts = await build_smart_contract_audit(payload)
    except Exception as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        fallback_attempts_payload = ()
        if isinstance(exc, HTTPException) and isinstance(exc.detail, dict):
            raw_attempts = exc.detail.get("fallback_attempts")
            if isinstance(raw_attempts, list):
                fallback_attempts_payload = tuple(
                    FetchAttemptError(
                        provider_name=str(item.get("providerName") or ""),
                        error_code=str(item.get("errorCode") or ""),
                        message=str(item.get("message") or ""),
                    )
                    for item in raw_attempts
                    if isinstance(item, dict)
                )
        current_repository.append_invocation(
            ProviderInvocationRecord.build(
                service_id=SERVICE_ID,
                input_payload=payload.model_dump(mode="json"),
                response_status=exc.status_code if isinstance(exc, HTTPException) else 500,
                request_id=request_id,
                gateway_request_id=gateway_request_id,
                error_code=_resolve_error_code(exc),
                upstream_status=_resolve_upstream_status(exc),
                latency_ms=latency_ms,
                cache_hit=False,
                observability_payload=_observability_payload(
                    resolved_source_provider=None,
                    fallback_attempts=fallback_attempts_payload,
                ),
            )
        )
        raise

    report_record = ContractAuditReportRecord.from_response(
        payload=payload,
        response=response,
        fallback_attempts=fallback_attempts,
    )
    current_repository.save_report(report_record)
    latency_ms = int((time.perf_counter() - started) * 1000)
    resolved_source_provider = response.sources[0].name if response.sources else None
    current_repository.append_invocation(
        ProviderInvocationRecord.build(
            service_id=SERVICE_ID,
            input_payload=payload.model_dump(mode="json"),
            response_status=200,
            request_id=request_id,
            gateway_request_id=gateway_request_id,
            error_code=None,
            upstream_status=None,
            latency_ms=latency_ms,
            cache_hit=response.freshness.cache_hit,
            observability_payload=_observability_payload(
                resolved_source_provider=resolved_source_provider,
                fallback_attempts=fallback_attempts,
            ),
        )
    )
    return response
