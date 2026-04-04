"""Invoke pipeline orchestration: validate, rate-limit, charge, proxy, audit, respond."""
from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, Optional

from fastapi import HTTPException

from src.api.schemas.pydantic_models import AgentInvokeRequest, InferenceRequest
from src.core.common import normalize_wallet
from src.domain.execution import InvocationRecord, ServiceQuoteRecord
from src.domain.finance import UsageLogRow
from src.domain.identity import RuntimeCredentialRecord
from src.domain.service_contract import ServiceDefinitionRecord
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

_PRICE_TOLERANCE = Decimal("0.000001")


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


def _request_payload(request: InferenceRequest, service: ServiceDefinitionRecord) -> Dict[str, Any]:
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
    service_id: str, settlement: Dict[str, float],
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
    request_payload: Dict[str, Any],
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
    raise_for_budget_check(await budget_check(storage, credential, total_charge))

    existing = read_invocation_by_idempotency(storage, credential.credential.credential_id, idempotency_key)
    if existing is not None:
        if existing.request_digest != payload_digest(request_payload) or existing.quote_id != quote.quote_id:
            raise HTTPException(
                status_code=409,
                detail={"code": "IDEMPOTENCY_CONFLICT", "message": "Idempotency key already used with different request payload"},
            )
        return existing, 0.0, settlement

    invocation = build_invocation_record(service, credential, quote, idempotency_key, request_payload)
    persist_quote(storage, quote_with_status(quote, "CONSUMED"))
    persist_invocation(storage, invocation)

    owner_wallet = credential_service.credential_owner_wallet(credential)
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

    running = invocation.model_copy(update={"status": "RUNNING", "started_at": now_dt_str(), "updated_at": now_dt_str()})
    persist_invocation(storage, running)

    try:
        invocation_result = await forwarding_upstream.call_upstream(service, running, request_payload)
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
) -> Dict[str, Any]:
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
    succeeded, consumer_after, settlement = await _execute_invocation_pipeline(
        storage, credential, service, quote, request_payload, request_id, request_id,
    )
    receipt = forwarding_billing.build_consumer_receipt(
        request_id=request_id, quote_id=quote.quote_id,
        invocation_id=succeeded.invocation_id, service_id=service_id,
        unit_price=settlement["unit_price"], total_charge=settlement["total_charge"],
        consumer_balance_after=consumer_after,
    )
    return forwarding_billing.build_consumer_success_response(receipt, succeeded.result.payload)


def get_invocation_receipt_v1(
    storage: BaseStorage,
    invocation_id: str,
    credential_token: Optional[str],
) -> dict[str, Any]:
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
) -> dict[str, Any]:
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
    invocation, _, _ = await _execute_invocation_pipeline(
        storage, credential, service, quote, invoke_payload, request.idempotencyKey, trace_request_id,
    )
    return invocation_state_payload(invocation)
