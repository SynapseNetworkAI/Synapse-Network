"""LLM token-metered invocation path with pre-authorization holds."""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from decimal import Decimal, ROUND_CEILING
from typing import Any

from fastapi import HTTPException

from src.domain.execution import InvocationRecord
from src.domain.finance import SettleConsumerHoldUsageCommand, UsageLogRow
from src.domain.identity import RuntimeCredentialRecord
from src.domain.service_contract import ServiceDefinitionRecord
from src.services.owner import forwarding_billing, forwarding_upstream, forwarding_validation
from src.services.owner.forwarding_budget import (
    budget_check,
    check_rpm_limit,
    check_service_qps_limit,
    raise_for_budget_check,
    record_credit_window_spend,
)
from src.services.owner.forwarding_records import (
    build_invocation_record,
    build_service_quote,
    invocation_error_action,
    invocation_failure_status,
    payload_digest,
    persist_invocation,
    persist_quote,
    quote_with_status,
    read_invocation_by_idempotency,
)
from src.services.platform import credential_service
from src.storage import BaseStorage
from src.utils.datetime_utils import now_dt_str
from src.utils.money import MoneyCodec

TOKEN_DIVISOR = Decimal("1000000")
USDC_QUANT = Decimal("0.000001")
DEFAULT_MAX_OUTPUT_TOKENS = 2048
DEFAULT_BUFFER = Decimal("1.2")
DEFAULT_MAX_AUTO_HOLD_USDC = Decimal("1.000000")
MAX_PROVIDER_USAGE_TOKENS = 10_000_000

@dataclass(frozen=True)
class LlmPreAuthPlan:
    mode: str
    hold_usdc: Decimal
    input_tokens_estimated: int
    output_tokens_estimated: int
    prompt_characters: int

@dataclass(frozen=True)
class LlmUsage:
    input_tokens: int
    output_tokens: int
    total_tokens: int
    source: str

@dataclass(frozen=True)
class LlmSettlement:
    charged_usdc: Decimal
    provider_revenue_usdc: Decimal
    platform_fee_usdc: Decimal
    released_usdc: Decimal
    fee_rate: Decimal
    protocol_fee: Decimal
    routing_tax: Decimal

def is_llm_service(service: ServiceDefinitionRecord) -> bool:
    return (
        str(service.service_kind or "").lower() == "llm"
        or str(service.price_model or "").lower() == "token_metered"
        or str(service.metering.billing_unit or "").lower() == "token"
    )

def _q6(value: Decimal | str | int) -> Decimal:
    return MoneyCodec.quantize_usdc(value)

def _ceil_usdc(value: Decimal) -> Decimal:
    if value <= Decimal("0"):
        return Decimal("0.000000")
    return value.quantize(USDC_QUANT, rounding=ROUND_CEILING)

def _decimal_config(value: Any, fallback: Decimal) -> Decimal:
    try:
        parsed = Decimal(str(value))
    except Exception:
        return fallback
    return parsed if parsed >= Decimal("0") else fallback

def _int_config(value: Any, fallback: int) -> int:
    try:
        parsed = int(value)
    except Exception:
        return fallback
    return parsed if parsed > 0 else fallback

def _stringify_prompt_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

def prompt_character_count(payload: dict[str, Any]) -> int:
    total = 0
    messages = payload.get("messages")
    if isinstance(messages, list):
        for message in messages:
            if isinstance(message, dict):
                total += len(_stringify_prompt_value(message.get("content")))
                total += len(_stringify_prompt_value(message.get("tool_calls")))
                total += len(_stringify_prompt_value(message.get("function_call")))
            else:
                total += len(_stringify_prompt_value(message))
    for key in ("prompt", "input", "instructions", "system", "developer"):
        total += len(_stringify_prompt_value(payload.get(key)))
    return total

def _output_estimate(payload: dict[str, Any], service: ServiceDefinitionRecord) -> int:
    raw = (
        payload.get("max_tokens")
        or payload.get("maxTokens")
        or payload.get("max_completion_tokens")
        or service.metering.default_max_output_tokens
    )
    return _int_config(raw, DEFAULT_MAX_OUTPUT_TOKENS)

def _token_cost(tokens: int, price_per_1m: Decimal) -> Decimal:
    return (Decimal(tokens) * price_per_1m) / TOKEN_DIVISOR

def _pricing(service: ServiceDefinitionRecord) -> tuple[Decimal, Decimal, Decimal, Decimal]:
    input_price = _decimal_config(
        service.metering.input_price_per_1m_tokens_usdc, Decimal("0")
    )
    output_price = _decimal_config(
        service.metering.output_price_per_1m_tokens_usdc, Decimal("0")
    )
    if input_price <= Decimal("0") and output_price <= Decimal("0"):
        raise HTTPException(
            status_code=500,
            detail={
                "code": "LLM_PRICING_NOT_CONFIGURED",
                "message": "LLM service must configure input/output token prices per 1M tokens.",
            },
        )
    buffer = _decimal_config(service.metering.hold_buffer_multiplier, DEFAULT_BUFFER)
    max_auto = _decimal_config(service.metering.max_auto_hold_usdc, DEFAULT_MAX_AUTO_HOLD_USDC)
    return input_price, output_price, buffer, max_auto

def reject_streaming_request(payload: dict[str, Any]) -> None:
    if payload.get("stream") is True:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "LLM_STREAMING_NOT_SUPPORTED",
                "message": (
                    "Streaming LLM responses are not supported in Synapse V1 "
                    "because final token usage is required for billing."
                ),
            },
        )

def build_pre_auth_plan(
    service: ServiceDefinitionRecord,
    payload: dict[str, Any],
    max_cost_usdc: Decimal | None,
) -> LlmPreAuthPlan:
    reject_streaming_request(payload)
    input_price, output_price, buffer, max_auto = _pricing(service)
    prompt_chars = prompt_character_count(payload)
    input_tokens = int(math.ceil(prompt_chars / 3)) if prompt_chars > 0 else 0
    output_tokens = _output_estimate(payload, service)
    raw_estimate = _token_cost(input_tokens, input_price) + _token_cost(output_tokens, output_price)
    buffered_estimate = _ceil_usdc(raw_estimate * buffer)
    if max_cost_usdc is not None:
        explicit_hold = _q6(max_cost_usdc)
        if buffered_estimate > explicit_hold:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "LLM_MAX_COST_TOO_LOW",
                    "message": "maxCostUsdc is lower than Gateway's conservative LLM cost estimate.",
                    "estimatedHoldUsdc": str(buffered_estimate),
                    "maxCostUsdc": str(explicit_hold),
                },
            )
        return LlmPreAuthPlan("explicit", explicit_hold, input_tokens, output_tokens, prompt_chars)
    if buffered_estimate > max_auto:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "LLM_AUTO_HOLD_LIMIT_EXCEEDED",
                "message": "Estimated LLM hold exceeds the service auto-hold cap. Provide maxCostUsdc explicitly.",
                "estimatedHoldUsdc": str(buffered_estimate),
                "maxAutoHoldUsdc": str(_q6(max_auto)),
            },
        )
    return LlmPreAuthPlan("auto", buffered_estimate, input_tokens, output_tokens, prompt_chars)


def parse_usage(result_payload: dict[str, Any]) -> LlmUsage:
    usage = result_payload.get("usage")
    if not isinstance(usage, dict):
        raise HTTPException(
            status_code=502,
            detail={"code": "LLM_USAGE_MISSING", "message": "Provider LLM response did not include usage."},
        )
    if "prompt_tokens" in usage or "completion_tokens" in usage:
        source = "openai"
        input_raw = usage.get("prompt_tokens")
        output_raw = usage.get("completion_tokens")
    else:
        source = "synapse"
        input_raw = usage.get("input_tokens")
        output_raw = usage.get("output_tokens")
    total_raw = usage.get("total_tokens")

    def _token(raw: Any, name: str) -> int:
        if not isinstance(raw, int) or isinstance(raw, bool) or raw < 0:
            raise HTTPException(
                status_code=502,
                detail={"code": "LLM_USAGE_INVALID", "message": f"usage.{name} must be a non-negative integer."},
            )
        return raw

    input_tokens = _token(input_raw, "input_tokens")
    output_tokens = _token(output_raw, "output_tokens")
    total_tokens = input_tokens + output_tokens if total_raw is None else _token(total_raw, "total_tokens")
    if total_tokens < input_tokens + output_tokens:
        raise HTTPException(
            status_code=502,
            detail={"code": "LLM_USAGE_INVALID", "message": "usage.total_tokens is lower than input + output tokens."},
        )
    if total_tokens > MAX_PROVIDER_USAGE_TOKENS:
        raise HTTPException(
            status_code=502,
            detail={"code": "LLM_USAGE_INVALID", "message": "usage.total_tokens exceeds Synapse V1 safety bounds."},
        )
    return LlmUsage(input_tokens, output_tokens, total_tokens, source)


def compute_charge(service: ServiceDefinitionRecord, usage: LlmUsage) -> Decimal:
    input_price, output_price, _buffer, _max_auto = _pricing(service)
    raw = _token_cost(usage.input_tokens, input_price) + _token_cost(usage.output_tokens, output_price)
    return _ceil_usdc(raw)


def _reserve_hold(storage: BaseStorage, owner_wallet: str, amount: Decimal) -> None:
    try:
        storage.get_data_manager().finance.balance.reserve_consumer_balance_for_manual_review(
            owner_wallet, amount, now_dt_str()
        )
    except RuntimeError as exc:
        if str(exc) in {"INSUFFICIENT_AVAILABLE_BALANCE", "INSUFFICIENT_CONSUMER_BALANCE_ATOMIC"}:
            raise HTTPException(
                status_code=402,
                detail={"code": "INSUFFICIENT_BALANCE", "message": "consumer balance is insufficient, please deposit first"},
            ) from exc
        raise


def _release_hold(storage: BaseStorage, owner_wallet: str, amount: Decimal) -> None:
    if amount <= Decimal("0"):
        return
    storage.get_data_manager().finance.balance.release_consumer_frozen_to_available(
        owner_wallet, amount, now_dt_str()
    )


async def _settle_hold(
    *,
    storage: BaseStorage,
    owner_wallet: str,
    provider_wallet: str,
    hold_usdc: Decimal,
    charged_usdc: Decimal,
    settlement: LlmSettlement,
    credential_id: str,
    request_id: str,
    invocation: InvocationRecord,
    usage_row: UsageLogRow,
) -> Decimal:
    if charged_usdc > hold_usdc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "LLM_BILLING_HOLD_EXCEEDED",
                "message": "Provider usage exceeded the LLM pre-authorization hold.",
            },
        )
    if hasattr(storage, "settle_consumer_llm_hold_atomic"):
        result = storage.settle_consumer_llm_hold_atomic(
            SettleConsumerHoldUsageCommand(
                owner_wallet=owner_wallet,
                provider_wallet=provider_wallet,
                hold_usdc=hold_usdc,
                total_charge=charged_usdc,
                provider_net=settlement.provider_revenue_usdc,
                platform_fee_total=settlement.platform_fee_usdc,
                request_id=request_id,
                unit_price=charged_usdc,
                protocol_fee=settlement.protocol_fee,
                routing_tax=settlement.routing_tax,
                invocation=invocation,
                usage_row=usage_row,
            )
        )
        await forwarding_billing._increment_credential_usage_with_retry(storage, credential_id)
        return _q6(getattr(result, "consumer_available_balance_after", Decimal("0")))

    _release_hold(storage, owner_wallet, hold_usdc)
    consumer_after, _updated = await forwarding_billing.charge_and_mark_usage(
        storage,
        owner_wallet,
        provider_wallet,
        charged_usdc,
        settlement.platform_fee_usdc,
        settlement.provider_revenue_usdc,
        credential_id,
        request_id=request_id,
        unit_price=charged_usdc,
        protocol_fee=settlement.protocol_fee,
        routing_tax=settlement.routing_tax,
        usage_row=usage_row,
        invocation=invocation,
    )
    return consumer_after


def _settlement_breakdown(
    storage: BaseStorage,
    provider_wallet: str,
    charged_usdc: Decimal,
    hold_usdc: Decimal,
) -> LlmSettlement:
    fee_rate, protocol_fee, routing_tax, platform_fee_total, provider_net, total_charge = (
        forwarding_billing.pricing_breakdown(storage, provider_wallet, charged_usdc)
    )
    # LLM token charge is already the full consumer charge; do not add per-request
    # routing tax on top, or tiny token calls become dominated by fixed fees.
    routing_tax = Decimal("0.000000")
    platform_fee_total = _q6(protocol_fee)
    provider_net = _q6(provider_net)
    charged_total = _q6(charged_usdc)
    return LlmSettlement(
        charged_usdc=charged_total,
        provider_revenue_usdc=provider_net,
        platform_fee_usdc=platform_fee_total,
        released_usdc=_q6(hold_usdc - charged_total),
        fee_rate=fee_rate,
        protocol_fee=_q6(protocol_fee),
        routing_tax=routing_tax,
    )


def _augment_payload(
    payload: dict[str, Any],
    usage: LlmUsage,
    plan: LlmPreAuthPlan,
    settlement: LlmSettlement,
) -> dict[str, Any]:
    augmented = dict(payload)
    augmented["usage"] = {
        "inputTokens": usage.input_tokens,
        "outputTokens": usage.output_tokens,
        "totalTokens": usage.total_tokens,
    }
    augmented["synapse"] = {
        "priceModel": "token_metered",
        "holdUsdc": str(plan.hold_usdc),
        "chargedUsdc": str(settlement.charged_usdc),
        "releasedUsdc": str(settlement.released_usdc),
        "providerRevenueUsdc": str(settlement.provider_revenue_usdc),
        "platformFeeUsdc": str(settlement.platform_fee_usdc),
        "preAuthMode": plan.mode,
    }
    return augmented


async def invoke_llm_v1(
    storage: BaseStorage,
    request: Any,
    credential: RuntimeCredentialRecord,
    service: ServiceDefinitionRecord,
    trace_request_id: str,
    provider_wallet: str,
) -> InvocationRecord:
    invoke_payload = dict(request.payload.body or {})
    if str(request.responseMode or "sync").lower() == "stream":
        reject_streaming_request({"stream": True})
    forwarding_validation.validate_invoke_request_contract(service, invoke_payload)
    plan = build_pre_auth_plan(service, invoke_payload, request.maxCostUsdc)
    budget_result = await budget_check(storage, credential, plan.hold_usdc)
    raise_for_budget_check(budget_result)
    await check_rpm_limit(
        str(credential.credential.credential_id),
        int(credential.policy.rpm_limit if credential.policy is not None else 0),
    )
    await check_service_qps_limit(service.service_id, int(service.constraints.max_qps))

    existing = read_invocation_by_idempotency(
        storage, credential.credential.credential_id, request.idempotencyKey
    )
    if existing is not None:
        if existing.request_digest != payload_digest(invoke_payload):
            raise HTTPException(
                status_code=409,
                detail={"code": "IDEMPOTENCY_CONFLICT", "message": "Idempotency key already used with different request payload"},
            )
        return existing

    quote = build_service_quote(
        service,
        credential,
        invoke_payload,
        plan.hold_usdc,
        response_mode=request.responseMode,
        price_model="token_metered",
    )
    invocation = build_invocation_record(service, credential, quote, request.idempotencyKey, invoke_payload)
    owner_wallet = credential_service.credential_owner_wallet(credential)
    persist_quote(storage, quote_with_status(quote, "CONSUMED"))
    persist_invocation(storage, invocation)
    _reserve_hold(storage, owner_wallet, plan.hold_usdc)

    running = invocation.model_copy(
        update={"status": "RUNNING", "started_at": now_dt_str(), "updated_at": now_dt_str()}
    )
    persist_invocation(storage, running)
    settled = False
    try:
        upstream_plan = await forwarding_upstream.prepare_upstream_call(service, invoke_payload)
        invocation_result = await forwarding_upstream.call_upstream(
            service, running, invoke_payload, call_plan=upstream_plan
        )
        usage = parse_usage(invocation_result.payload)
        charged_usdc = compute_charge(service, usage)
        settlement = _settlement_breakdown(storage, provider_wallet, charged_usdc, plan.hold_usdc)
        usage_row = UsageLogRow(
            id=running.invocation_id,
            ts=credential_service.now_ts(),
            agentId=credential.agent.agent_id,
            requestId=trace_request_id,
            serviceId=service.service_id,
            consumerAddress=owner_wallet,
            providerAddress=provider_wallet,
            status="accepted",
            unitPrice=charged_usdc,
            protocolFee=settlement.protocol_fee,
            routingTax=settlement.routing_tax,
            totalCharge=charged_usdc,
            businessType="charge",
            riskLevel="green",
        )
        await _settle_hold(
            storage=storage,
            owner_wallet=owner_wallet,
            provider_wallet=provider_wallet,
            hold_usdc=plan.hold_usdc,
            charged_usdc=charged_usdc,
            settlement=settlement,
            credential_id=str(credential.credential.credential_id),
            request_id=trace_request_id,
            invocation=running,
            usage_row=usage_row,
        )
        settled = True
        await record_credit_window_spend(credential, charged_usdc)
        payload = _augment_payload(invocation_result.payload, usage, plan, settlement)
        succeeded = running.model_copy(
            update={
                "status": "SUCCEEDED",
                "charged_usdc": charged_usdc,
                "result": invocation_result.model_copy(update={"payload": payload}),
                "finished_at": now_dt_str(),
                "updated_at": now_dt_str(),
            }
        )
        persist_invocation(storage, succeeded)
        return succeeded  # noqa: TRY300
    except Exception as exc:
        if not settled:
            _release_hold(storage, owner_wallet, plan.hold_usdc)
        error_code = "UPSTREAM_ERROR"
        if isinstance(exc, HTTPException) and isinstance(exc.detail, dict):
            error_code = str(exc.detail.get("code") or error_code)
        failed = running.model_copy(
            update={
                "status": invocation_failure_status(error_code),
                "error_code": error_code,
                "error_action": invocation_error_action(error_code),
                "finished_at": now_dt_str(),
                "updated_at": now_dt_str(),
            }
        )
        persist_invocation(storage, failed)
        raise
