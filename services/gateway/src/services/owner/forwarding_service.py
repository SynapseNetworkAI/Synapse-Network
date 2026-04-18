"""Invoke pipeline orchestration: validate, rate-limit, charge, proxy, audit, respond."""
from __future__ import annotations

import time
from decimal import Decimal
from typing import Any, Optional

from fastapi import HTTPException

from src.api.schemas.pydantic_models import AgentInvokeRequest, InferenceRequest
from src.core.common import normalize_wallet
from src.domain.execution import InvocationRecord, ServiceQuoteRecord
from src.domain.finance import UsageLogRow
from src.domain.identity import RuntimeCredentialRecord
from src.domain.invocation_response import ConsumerSuccessResponse, InvocationStateResponse
from src.domain.service_contract import ServiceDefinitionRecord
from src.services.analytics.gateway_events import (
    emit_invoke_completed,
    emit_invoke_failed,
    emit_invoke_started,
    emit_provider_first_revenue_received,
    emit_provider_revenue_received,
    emit_quote_generated,
)
from src.services.platform import credential_service
from src.services.owner import forwarding_billing, forwarding_upstream, forwarding_validation
from src.services.owner.forwarding_budget import (
    budget_check,
    check_rpm_limit,
    check_service_qps_limit,
    raise_for_budget_check,
    record_credit_window_spend,
    _q6,
)
from src.services.owner.forwarding_records import (
    build_invocation_record,
    build_service_quote,
    invocation_failure_status,
    invocation_error_action,
    invocation_state_payload,
    payload_digest,
    persist_invocation,
    persist_quote,
    quote_with_status,
    read_invocation,
    read_invocation_by_idempotency,
)
from src.storage import BaseStorage
from src.utils.datetime_utils import now_dt_str
from src.utils.logging_utils import workflow_logger

_PRICE_TOLERANCE = Decimal("0.000001")


def _invocation_logger(
    request_id: str,
    service_id: str,
    credential: RuntimeCredentialRecord,
    *,
    mode: str,
):
    return workflow_logger(
        "invocation",
        request_id=request_id,
        service_id=service_id,
        credential_id=str(credential.credential.credential_id),
        entry=mode,
    )


def _log_invocation_failure(log, exc: Exception) -> None:
    if isinstance(exc, HTTPException):
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        error_code = detail.get("code") or detail.get("errorCode")
        if exc.status_code >= 500:
            log.error(
                "invocation.failed",
                error_code=error_code,
                status_code=exc.status_code,
            )
        else:
            log.warning(
                "invocation.failed",
                error_code=error_code,
                status_code=exc.status_code,
            )
        return
    log.exception("invocation.failed", error_code=getattr(exc, "code", None))


def _service_wallet(service: ServiceDefinitionRecord) -> str:
    return normalize_wallet(str(service.address or service.owner_address or ""))


def _charge_amount_from_unit_price(
    storage: BaseStorage, provider_wallet: str, unit_price: float
) -> tuple[dict[str, float], float]:
    fee_rate, protocol_fee, routing_tax, platform_fee_total, provider_net, total_charge = (
        forwarding_billing.pricing_breakdown(storage, provider_wallet, unit_price)
    )
    settlement = {
        "unit_price": unit_price, "fee_rate": fee_rate, "protocol_fee": protocol_fee,
        "routing_tax": routing_tax, "platform_fee_total": platform_fee_total,
        "provider_net": provider_net, "total_charge": total_charge,
    }
    return settlement, total_charge


def _request_payload(request: InferenceRequest, service: ServiceDefinitionRecord) -> dict[str, Any]:
    payload = dict(request.payload or {})
    if payload:
        return payload
    prompt = str(request.prompt or "")
    if prompt.strip():
        return {"text": forwarding_validation.validate_prompt(prompt)}
    schema = dict(service.invoke.request.schema_document.body or {})
    required = schema.get("required") if isinstance(schema.get("required"), list) else []
    if any(str(f) == "text" for f in required):
        forwarding_validation.validate_prompt(prompt)
    return {}


def _log_upstream_failure(
    storage: BaseStorage, request_id: str, owner_wallet: str, provider_wallet: str,
    service_id: str, settlement: dict[str, float],
    error_code: Optional[str] = None, error_message: Optional[str] = None,
) -> None:
    forwarding_billing.append_invocation_billing(
        storage,
        UsageLogRow(
            id=f"{request_id}:failed_upstream",
            ts=credential_service.now_ts(),
            requestId=request_id, serviceId=service_id,
            consumerAddress=owner_wallet, providerAddress=provider_wallet,
            status="failed_upstream",
            unitPrice=round(settlement["unit_price"], 6),
            protocolFee=round(settlement["protocol_fee"], 6),
            routingTax=round(settlement["routing_tax"], 6),
            totalCharge=round(settlement["total_charge"], 6),
            businessType="charge", riskLevel="green",
        ),
    )


async def _execute_invocation_pipeline(
    storage: BaseStorage,
    credential: RuntimeCredentialRecord,
    service: ServiceDefinitionRecord,
    quote: ServiceQuoteRecord,
    request_payload: dict[str, Any],
    idempotency_key: str,
    trace_request_id: str,
) -> tuple[InvocationRecord, float, dict[str, float]]:
    await check_rpm_limit(
        str(credential.credential.credential_id),
        int(credential.policy.rpm_limit if credential.policy is not None else 0),
    )
    constraints = forwarding_validation.effective_service_constraints(service)
    await check_service_qps_limit(service.service_id, int(constraints.max_qps))

    provider_wallet = _service_wallet(service)
    unit_price = round(float(quote.quoted_price_usdc), 6)
    settlement, total_charge = _charge_amount_from_unit_price(storage, provider_wallet, unit_price)
    budget_result = await budget_check(storage, credential, total_charge)
    if not budget_result.get("allowed"):
        from src.services.analytics.gateway_events import emit_budget_blocked
        await emit_budget_blocked(
            credential_service.credential_owner_wallet(credential),
            service_id=service.service_id,
            required_usdc=float(total_charge),
            available_usdc=budget_result.get("remainingBudgetUsdc"),
            error_code=str(budget_result.get("errorCode") or "BUDGET_EXHAUSTED"),
            correlation_id=trace_request_id,
        )
    raise_for_budget_check(budget_result)

    existing = read_invocation_by_idempotency(storage, credential.credential.credential_id, idempotency_key)
    if existing is not None:
        if existing.request_digest != payload_digest(request_payload):
            raise HTTPException(
                status_code=409,
                detail={"code": "IDEMPOTENCY_CONFLICT", "message": "Idempotency key already used with different request payload"},
            )
        return existing, 0.0, settlement

    upstream_plan = await forwarding_upstream.prepare_upstream_call(service, request_payload)
    invocation = build_invocation_record(service, credential, quote, idempotency_key, request_payload)

    owner_wallet = credential_service.credential_owner_wallet(credential)
    try:
        persist_quote(storage, quote_with_status(quote, "CONSUMED"))
        persist_invocation(storage, invocation)
        consumer_after, updated_credential = await forwarding_billing.charge_and_mark_usage(
            storage, owner_wallet, provider_wallet, total_charge,
            settlement["platform_fee_total"], settlement["provider_net"],
            str(credential.credential.credential_id),
            request_id=trace_request_id, unit_price=unit_price,
            protocol_fee=settlement["protocol_fee"], routing_tax=settlement["routing_tax"],
            usage_row=UsageLogRow(
                id=invocation.invocation_id, ts=credential_service.now_ts(),
                agentId=credential.agent.agent_id, requestId=trace_request_id,
                serviceId=service.service_id, consumerAddress=owner_wallet, providerAddress=provider_wallet,
                status="accepted", unitPrice=round(unit_price, 6),
                protocolFee=round(settlement["protocol_fee"], 6),
                routingTax=round(settlement["routing_tax"], 6),
                totalCharge=round(total_charge, 6), businessType="charge", riskLevel="green",
            ),
            invocation=invocation,
        )
    except Exception:
        await upstream_plan.permit.release_without_outcome()
        raise

    running = invocation.model_copy(update={"status": "RUNNING", "started_at": now_dt_str(), "updated_at": now_dt_str()})
    persist_invocation(storage, running)
    _t0 = time.monotonic()
    await emit_invoke_started(
        owner_wallet,
        service_id=service.service_id,
        provider_address=provider_wallet,
        quote_id=quote.quote_id,
        price_usdc=float(total_charge),
        correlation_id=trace_request_id,
    )

    try:
        invocation_result = await forwarding_upstream.call_upstream(
            service,
            running,
            request_payload,
            call_plan=upstream_plan,
        )
    except HTTPException as exc:
        await forwarding_billing.rollback_charge(
            storage, owner_wallet, provider_wallet, total_charge,
            settlement["platform_fee_total"], settlement["provider_net"], updated_credential,
        )
        error_code = exc.detail.get("code") if isinstance(exc.detail, dict) else None
        _log_upstream_failure(storage, trace_request_id, owner_wallet, provider_wallet, service.service_id, settlement, error_code=error_code)
        failed = running.model_copy(update={
            "status": invocation_failure_status(error_code), "error_code": error_code,
            "error_action": invocation_error_action(error_code),
            "finished_at": now_dt_str(), "updated_at": now_dt_str(),
        })
        persist_invocation(storage, failed)
        await emit_invoke_failed(
            owner_wallet, service_id=service.service_id,
            provider_address=provider_wallet, quote_id=quote.quote_id,
            error_code=error_code, failure_stage="upstream",
            correlation_id=trace_request_id,
        )
        credential_service.append_audit_log(storage, "V2_USAGE_CHARGE_FAILED", owner_wallet, {
            "requestId": trace_request_id, "agentId": credential.agent.agent_id,
            "credentialId": credential.credential.credential_id, "serviceId": service.service_id,
            "quoteId": quote.quote_id, "invocationId": failed.invocation_id,
            "resultStatus": "failed", "errorCode": error_code, "businessType": "charge",
        })
        raise
    except Exception as exc:
        await forwarding_billing.rollback_charge(
            storage, owner_wallet, provider_wallet, total_charge,
            settlement["platform_fee_total"], settlement["provider_net"], updated_credential,
        )
        _log_upstream_failure(storage, trace_request_id, owner_wallet, provider_wallet, service.service_id, settlement, error_message=str(exc))
        failed = running.model_copy(update={
            "status": "FAILED_RETRYABLE", "error_code": "UPSTREAM_ERROR",
            "error_action": "retry", "finished_at": now_dt_str(), "updated_at": now_dt_str(),
        })
        persist_invocation(storage, failed)
        await emit_invoke_failed(
            owner_wallet, service_id=service.service_id,
            provider_address=provider_wallet, quote_id=quote.quote_id,
            error_code="UPSTREAM_ERROR", failure_stage="upstream",
            correlation_id=trace_request_id,
        )
        credential_service.append_audit_log(storage, "V2_USAGE_CHARGE_FAILED", owner_wallet, {
            "requestId": trace_request_id, "agentId": credential.agent.agent_id,
            "credentialId": credential.credential.credential_id, "serviceId": service.service_id,
            "quoteId": quote.quote_id, "invocationId": failed.invocation_id,
            "resultStatus": "failed", "errorCode": "UPSTREAM_ERROR", "businessType": "charge",
        })
        raise HTTPException(status_code=502, detail={"code": "UPSTREAM_ERROR", "message": f"Upstream provider failed: {exc}"})

    await record_credit_window_spend(credential, total_charge)

    succeeded = running.model_copy(update={
        "status": "SUCCEEDED", "charged_usdc": round(total_charge, 6), "result": invocation_result,
        "finished_at": now_dt_str(), "updated_at": now_dt_str(),
    })
    persist_invocation(storage, succeeded)

    # Analytics: invoke_completed
    owner_wallet_for_analytics = credential_service.credential_owner_wallet(credential)
    elapsed_ms = int((time.monotonic() - _t0) * 1000)
    await emit_invoke_completed(
        owner_wallet_for_analytics,
        service_id=service.service_id,
        provider_address=provider_wallet,
        quote_id=quote.quote_id,
        price_usdc=float(total_charge),
        latency_ms=elapsed_ms,
        correlation_id=trace_request_id,
    )
    # Analytics: provider_revenue_received
    await emit_provider_revenue_received(
        provider_wallet,
        service_id=service.service_id,
        gross_usdc=float(settlement["unit_price"]),
        platform_fee_usdc=float(settlement["protocol_fee"]),
        provider_net_usdc=float(settlement["provider_net"]),
        correlation_id=trace_request_id,
    )
    # Analytics: provider_first_revenue_received (milestone — only on first settled row)
    normalized_provider = normalize_wallet(provider_wallet)
    raw_billing_rows = storage.get_data_manager().system.gateway_state.read_invocation_billing_rows()
    billing_rows = raw_billing_rows if isinstance(raw_billing_rows, list) else []
    prior_settled = [
        r for r in billing_rows
        if normalize_wallet(str(getattr(r, "provider_address", "") or "")) == normalized_provider
        and str(getattr(r, "status", "")).lower() == "succeeded"
    ]
    # prior_settled includes the row just appended, so threshold is exactly 1
    if len(prior_settled) == 1:
        await emit_provider_first_revenue_received(
            provider_wallet,
            service_id=service.service_id,
            gross_usdc=float(settlement["unit_price"]),
            correlation_id=trace_request_id,
        )

    credential_service.append_audit_log(storage, "V2_USAGE_CHARGED", owner_wallet, {
        "requestId": trace_request_id, "agentId": credential.agent.agent_id,
        "credentialId": credential.credential.credential_id,
        "quoteId": quote.quote_id, "invocationId": succeeded.invocation_id,
        "serviceId": service.service_id, "unitPrice": unit_price,
        "feeRate": settlement["fee_rate"], "platformFee": settlement["protocol_fee"],
        "routingTax": settlement["routing_tax"], "platformFeeTotal": settlement["platform_fee_total"],
        "providerNetAmount": settlement["provider_net"], "totalCharge": total_charge,
        "consumerAvailableBalanceAfter": consumer_after, "resultStatus": "success", "businessType": "charge",
    })
    return succeeded, consumer_after, settlement


async def generate_response_v2(
    storage: BaseStorage,
    request: InferenceRequest,
    x_service_id: Optional[str],
    credential_token: Optional[str],
    x_request_id: Optional[str],
) -> ConsumerSuccessResponse:
    """Orchestrate full generate pipeline: validate, rate-limit, charge, proxy, audit, respond."""
    service_id = forwarding_validation.validate_service_id(x_service_id, request.serviceId)
    token = forwarding_validation.validate_credential_token(credential_token)
    request_id = forwarding_validation.resolve_request_id(x_request_id)

    credential = credential_service.resolve_active_credential(storage, token)
    service = forwarding_validation.find_active_service(storage, service_id)
    unit_price = forwarding_validation.parse_service_price_usdc(service)
    request_payload = _request_payload(request, service)
    forwarding_validation.validate_invoke_request_contract(service, request_payload)

    quote = build_service_quote(service, credential, request_payload, unit_price)
    persist_quote(storage, quote)
    await emit_quote_generated(
        credential_service.credential_owner_wallet(credential),
        service_id=service_id, quote_id=quote.quote_id,
        price_usdc=float(unit_price), correlation_id=request_id,
    )
    log = _invocation_logger(request_id, service_id, credential, mode="generate")
    log.info(
        "invocation.start",
        quote_id=quote.quote_id,
        service_price_usdc=float(unit_price),
    )
    try:
        succeeded, consumer_after, settlement = await _execute_invocation_pipeline(
            storage,
            credential,
            service,
            quote,
            request_payload,
            request_id,
            request_id,
        )
    except Exception as exc:
        _log_invocation_failure(log, exc)
        raise
    receipt = forwarding_billing.build_consumer_receipt(
        request_id=request_id, quote_id=quote.quote_id,
        invocation_id=succeeded.invocation_id, service_id=service_id,
        unit_price=settlement["unit_price"], total_charge=settlement["total_charge"],
        consumer_balance_after=consumer_after,
    )
    log.info(
        "invocation.complete",
        invocation_id=succeeded.invocation_id,
        total_charge=settlement["total_charge"],
        consumer_balance_after=consumer_after,
    )
    return forwarding_billing.build_consumer_success_response(receipt, succeeded.result.payload)


def get_invocation_receipt_v1(
    storage: BaseStorage,
    invocation_id: str,
    credential_token: Optional[str],
) -> InvocationStateResponse:
    token = forwarding_validation.validate_credential_token(credential_token)
    credential = credential_service.resolve_active_credential(storage, token)
    invocation = read_invocation(storage, invocation_id)
    if invocation.credential_id != credential.credential.credential_id:
        raise HTTPException(
            status_code=403,
            detail={"code": "INVOCATION_FORBIDDEN", "message": "Invocation does not belong to this credential"},
        )
    return invocation_state_payload(invocation)


async def invoke_v1(
    storage: BaseStorage,
    request: AgentInvokeRequest,
    credential_token: Optional[str],
    x_request_id: Optional[str],
) -> InvocationStateResponse:
    """Single-call invoke: validate price assertion, build internal quote, run pipeline."""
    token = forwarding_validation.validate_credential_token(credential_token)
    trace_request_id = forwarding_validation.resolve_request_id(x_request_id)
    credential = credential_service.resolve_active_credential(storage, token)

    service = forwarding_validation.find_active_service(storage, request.serviceId)
    live_price = forwarding_validation.parse_service_price_usdc(service)
    live_price_decimal = _q6(live_price)
    cost_decimal = _q6(request.costUsdc)

    if abs(live_price_decimal - cost_decimal) > _PRICE_TOLERANCE:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "PRICE_MISMATCH",
                "message": (
                    f"Service price has changed. "
                    f"You expected {float(cost_decimal):.6f} USDC but the current price is "
                    f"{float(live_price_decimal):.6f} USDC. Re-discover to get the updated price."
                ),
                "expectedPriceUsdc": float(cost_decimal),
                "currentPriceUsdc": float(live_price_decimal),
            },
        )

    invoke_payload = request.payload.body
    forwarding_validation.validate_invoke_request_contract(service, invoke_payload)
    quote = build_service_quote(service, credential, invoke_payload, live_price, response_mode=request.responseMode)
    persist_quote(storage, quote)
    await emit_quote_generated(
        credential_service.credential_owner_wallet(credential),
        service_id=request.serviceId, quote_id=quote.quote_id,
        price_usdc=float(live_price), correlation_id=trace_request_id,
    )
    log = _invocation_logger(
        trace_request_id,
        request.serviceId,
        credential,
        mode="invoke",
    )
    log.info("invocation.start", quote_id=quote.quote_id, response_mode=request.responseMode)
    try:
        invocation, _, _ = await _execute_invocation_pipeline(
            storage,
            credential,
            service,
            quote,
            invoke_payload,
            request.idempotencyKey,
            trace_request_id,
        )
    except Exception as exc:
        _log_invocation_failure(log, exc)
        raise
    log.info(
        "invocation.complete",
        invocation_id=invocation.invocation_id,
        status=invocation.status,
    )
    return invocation_state_payload(invocation)
