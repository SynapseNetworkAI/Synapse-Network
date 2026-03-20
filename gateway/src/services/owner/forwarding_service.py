from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import json
from typing import Any, Dict, Optional, Tuple
from uuid import uuid4

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.config import settings
from src.api.schemas.pydantic_models import (
    AgentInvocationRequest,
    AgentQuoteRequest,
    InferenceRequest,
)
from src.domain.execution import InvocationRecord, InvocationResultRecord, ServiceQuoteRecord
from src.domain.finance import UsageLogRow
from src.domain.identity import RuntimeCredentialRecord
from src.domain.service_contract import ServiceConstraintRecord, ServiceDefinitionRecord
from src.services.platform import credential_service
from src.services.owner import forwarding_billing
from src.services.owner import forwarding_upstream
from src.services.owner import forwarding_validation
from src.storage import BaseStorage
from src.utils.datetime_utils import now_dt_str, to_dt_str

# Shared best-effort runtime caches. Redis is preferred in production; memory fallback keeps dev mode usable.
_redis_client = None
_memory_window_counters: Dict[str, Tuple[float, int]] = {}


def _build_consumer_receipt(
    request_id: str,
    quote_id: str,
    invocation_id: str,
    service_id: str,
    unit_price: float,
    total_charge: float,
    consumer_balance_after: float,
) -> Dict[str, Any]:
    """Build consumer-facing receipt fields only, hiding internal settlement split details."""
    return forwarding_billing.build_consumer_receipt(
        request_id,
        quote_id,
        invocation_id,
        service_id,
        unit_price,
        total_charge,
        consumer_balance_after,
    )


def _build_consumer_success_response(
    receipt: Dict[str, Any], upstream_result: Dict[str, Any]
) -> Dict[str, Any]:
    """Return the canonical generate success envelope consumed by consumer SDKs."""
    return forwarding_billing.build_consumer_success_response(receipt, upstream_result)


def _effective_service_constraints(service: ServiceDefinitionRecord) -> ServiceConstraintRecord:
    """Resolve service constraints after applying platform min/max guardrails."""
    return forwarding_validation.effective_service_constraints(service)


def _pricing_breakdown(
    storage: BaseStorage, provider_wallet: str, unit_price: float
) -> Tuple[float, float, float, float, float, float]:
    """Compute fee-rate decomposition for charging, reconciliation, and audits."""
    return forwarding_billing.pricing_breakdown(storage, provider_wallet, unit_price)


def _append_usage_log(storage: BaseStorage, row: UsageLogRow | Dict[str, Any]) -> None:
    """Persist one invocation billing row for operational visibility and settlement traceability."""
    forwarding_billing.append_invocation_billing(storage, row)


def _validate_service_id(
    x_service_id: Optional[str], request_service_id: Optional[str]
) -> str:
    """Validate and normalize serviceId from headers/body before service lookup."""
    return forwarding_validation.validate_service_id(x_service_id, request_service_id)


def _validate_prompt(prompt: str) -> str:
    """Validate generate prompt content and max length contract."""
    return forwarding_validation.validate_prompt(prompt)


def _validate_credential_token(credential_token: Optional[str]) -> str:
    """Validate credential token format before credential resolution."""
    return forwarding_validation.validate_credential_token(credential_token)


def _resolve_request_id(client_request_id: Optional[str]) -> str:
    """Use client request id when valid, otherwise generate a platform UUID."""
    return forwarding_validation.resolve_request_id(client_request_id)


def _find_active_service(
    storage: BaseStorage, service_id: str
) -> ServiceDefinitionRecord:
    """Fetch an active service row by serviceId or raise gateway-safe error codes."""
    return forwarding_validation.find_active_service(storage, service_id)


def _parse_service_price_usdc(service_row: ServiceDefinitionRecord) -> float:
    """Parse service USDC unit price with strict positivity constraints."""
    return forwarding_validation.parse_service_price_usdc(service_row)


def _validate_invoke_request_contract(
    service: ServiceDefinitionRecord, payload: Dict[str, Any]
) -> None:
    """Enforce invoke contract requirements for method/content-type/required fields."""
    forwarding_validation.validate_invoke_request_contract(service, payload)


def _select_weighted_target_url(invoke: Any) -> str:
    """Select one upstream target by weighted-random routing configuration."""
    return forwarding_upstream.select_weighted_target_url(invoke)


async def _call_upstream(
    service: ServiceDefinitionRecord,
    invocation: InvocationRecord,
    request_payload: Dict[str, Any],
) -> InvocationResultRecord:
    """Forward prompt to provider upstream and enforce payload size + timeout limits."""
    return await forwarding_upstream.call_upstream(service, invocation, request_payload)


def _request_payload(prompt: str) -> Dict[str, Any]:
    return {"text": prompt}


def _execution_repo(storage: BaseStorage) -> Any:
    repo = getattr(storage.get_data_manager().system, "execution", None)
    if repo is None:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "EXECUTION_REPOSITORY_UNAVAILABLE",
                "message": "Execution repository is unavailable",
            },
        )
    return repo


def _payload_digest(payload: Dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _epoch_seconds(value: Optional[str]) -> int:
    if not value:
        return 0
    normalized = to_dt_str(value, value)
    if not normalized:
        return 0
    try:
        return int(datetime.strptime(normalized, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp())
    except Exception:
        return 0


def _quote_expiration_seconds(service: ServiceDefinitionRecord) -> int:
    timeout_seconds = max(30, int(service.constraints.timeout_ms or 0) // 1000)
    return min(timeout_seconds, 300)


def _build_service_quote(
    service: ServiceDefinitionRecord,
    credential: RuntimeCredentialRecord,
    request_payload: Dict[str, Any],
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
        requestFingerprint=_payload_digest(
            {
                "serviceId": service.service_id,
                "credentialId": credential.credential.credential_id,
                "payload": request_payload,
            }
        ),
        responseMode=response_mode,
        invokeConstraints={
            "body": service.invoke.request.schema_document.body,
            "timeoutMs": int(service.constraints.timeout_ms or 0),
            "maxPayloadBytes": int(service.constraints.max_request_bytes or 0),
        },
        expiresAt=to_dt_str(
            credential_service.now_ts() + _quote_expiration_seconds(service),
            created_at,
        )
        or created_at,
        createdAt=created_at,
    )


def _build_invocation_record(
    service: ServiceDefinitionRecord,
    credential: RuntimeCredentialRecord,
    quote: ServiceQuoteRecord,
    idempotency_key: str,
    request_payload: Dict[str, Any],
) -> InvocationRecord:
    created_at = now_dt_str()
    endpoint_id = None
    if service.primary_endpoint is not None:
        endpoint_id = service.primary_endpoint.endpoint_id
    return InvocationRecord(
        invocationId=f"inv-{uuid4().hex}",
        quoteId=quote.quote_id,
        serviceId=service.service_id,
        endpointId=endpoint_id,
        credentialId=credential.credential.credential_id,
        agentId=credential.agent.agent_id,
        idempotencyKey=idempotency_key,
        requestDigest=_payload_digest(request_payload),
        responseMode=quote.response_mode,
        status="PENDING",
        createdAt=created_at,
        updatedAt=created_at,
    )


def _quote_with_status(quote: ServiceQuoteRecord, status: str) -> ServiceQuoteRecord:
    return quote.model_copy(update={"status": status})


def _persist_quote(storage: BaseStorage, quote: ServiceQuoteRecord) -> None:
    _execution_repo(storage).upsert_quote(quote)


def _read_quote(storage: BaseStorage, quote_id: str) -> ServiceQuoteRecord:
    quote = _execution_repo(storage).read_quote(quote_id)
    if quote is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "QUOTE_NOT_FOUND", "message": "Quote not found"},
        )
    return quote


def _persist_invocation(storage: BaseStorage, invocation: InvocationRecord) -> None:
    _execution_repo(storage).upsert_invocation(invocation)


def _read_invocation(storage: BaseStorage, invocation_id: str) -> InvocationRecord:
    invocation = _execution_repo(storage).read_invocation(invocation_id)
    if invocation is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "INVOCATION_NOT_FOUND", "message": "Invocation not found"},
        )
    return invocation


def _read_invocation_by_idempotency(
    storage: BaseStorage, credential_id: str, idempotency_key: str
) -> Optional[InvocationRecord]:
    return _execution_repo(storage).read_invocation_by_idempotency(
        credential_id, idempotency_key
    )


def _quote_is_expired(quote: ServiceQuoteRecord) -> bool:
    expires_at = _epoch_seconds(quote.expires_at)
    return bool(expires_at and expires_at <= credential_service.now_ts())


def _service_wallet(service: ServiceDefinitionRecord) -> str:
    return normalize_wallet(str(service.address or service.owner_address or ""))


def _charge_amount_from_unit_price(
    storage: BaseStorage, provider_wallet: str, unit_price: float
) -> tuple[dict[str, float], float]:
    (
        fee_rate,
        protocol_fee,
        routing_tax,
        platform_fee_total,
        provider_net,
        total_charge,
    ) = _pricing_breakdown(storage, provider_wallet, unit_price)
    settlement = {
        "unit_price": unit_price,
        "fee_rate": fee_rate,
        "protocol_fee": protocol_fee,
        "routing_tax": routing_tax,
        "platform_fee_total": platform_fee_total,
        "provider_net": provider_net,
        "total_charge": total_charge,
    }
    return settlement, total_charge


async def _budget_check(
    credential: RuntimeCredentialRecord, charge_amount: float
) -> dict[str, Any]:
    policy = credential.policy
    if policy is None:
        return {
            "allowed": True,
            "remainingBudgetUsdc": None,
            "remainingDailyLimitUsdc": None,
            "errorCode": None,
        }

    remaining_budget, per_invocation_code = _per_invocation_budget(policy, charge_amount)
    remaining_lifetime, remaining_daily = await _spend_window_budget(credential, policy)
    error_code = _budget_error_code(
        charge_amount,
        remaining_lifetime,
        remaining_daily,
        per_invocation_code,
    )

    return {
        "allowed": error_code is None,
        "remainingBudgetUsdc": remaining_lifetime if remaining_lifetime is not None else remaining_budget,
        "remainingDailyLimitUsdc": remaining_daily,
        "errorCode": error_code,
    }


def _per_invocation_budget(policy: Any, charge_amount: float) -> tuple[Optional[float], Optional[str]]:
    per_invocation_cap = float(policy.per_invocation_cap_usdc or 0)
    if per_invocation_cap <= 0:
        return None, None
    remaining = round(per_invocation_cap, 6)
    if charge_amount > per_invocation_cap + 1e-9:
        return remaining, "PER_INVOCATION_CAP_EXCEEDED"
    return remaining, None


async def _spend_window_budget(
    credential: RuntimeCredentialRecord, policy: Any
) -> tuple[Optional[float], Optional[float]]:
    lifetime_cap = float(policy.lifetime_cap_usdc or 0)
    daily_cap = float(policy.daily_cap_usdc or 0)
    if lifetime_cap <= 0 and daily_cap <= 0:
        return None, None
    reset_interval = credential_service.resolve_reset_interval(
        str(credential.metadata.reset_interval or "daily")
    )
    win_key, _ = _window_key_and_ttl(reset_interval, credential_service.now_ts())
    spent = await _get_window_spend(str(credential.credential.credential_id), win_key)
    remaining_lifetime = (
        round(max(0.0, lifetime_cap - spent), 6) if lifetime_cap > 0 else None
    )
    remaining_daily = round(max(0.0, daily_cap - spent), 6) if daily_cap > 0 else None
    return remaining_lifetime, remaining_daily


def _budget_error_code(
    charge_amount: float,
    remaining_lifetime: Optional[float],
    remaining_daily: Optional[float],
    per_invocation_code: Optional[str],
) -> Optional[str]:
    if per_invocation_code is not None:
        return per_invocation_code
    if remaining_lifetime is not None and charge_amount > remaining_lifetime + 1e-9:
        return "BUDGET_EXHAUSTED"
    if remaining_daily is not None and charge_amount > remaining_daily + 1e-9:
        return "DAILY_LIMIT_EXCEEDED"
    return None


def _raise_for_budget_check(budget_check: dict[str, Any]) -> None:
    if budget_check.get("allowed"):
        return
    error_code = str(budget_check.get("errorCode") or "BUDGET_EXHAUSTED")
    raise HTTPException(
        status_code=402,
        detail={
            "code": error_code,
            "message": "Credential budget does not allow this invocation",
        },
    )


def _quote_response(
    trace_request_id: str,
    quote: ServiceQuoteRecord,
    budget_check: dict[str, Any],
) -> dict[str, Any]:
    return {
        "requestId": trace_request_id,
        "quoteId": quote.quote_id,
        "serviceId": quote.service_id,
        "priceUsdc": round(float(quote.quoted_price_usdc), 6),
        "priceModel": quote.price_model,
        "budgetCheck": {
            "allowed": bool(budget_check.get("allowed")),
            "remainingBudgetUsdc": budget_check.get("remainingBudgetUsdc"),
            "remainingDailyLimitUsdc": budget_check.get("remainingDailyLimitUsdc"),
        },
        "expiresAt": quote.expires_at,
        "idempotencyScope": "quoteId",
        "invokeConstraints": quote.invoke_constraints.model_dump(by_alias=True),
    }


def _invocation_error_payload(invocation: InvocationRecord) -> dict[str, Any]:
    status = str(invocation.status or "FAILED_FINAL")
    retryable = status == "FAILED_RETRYABLE"
    return {
        "invocationId": invocation.invocation_id,
        "status": status,
        "error": {
            "code": invocation.error_code or "INVOCATION_FAILED",
            "message": "Invocation failed",
            "retryable": retryable,
            "action": invocation.error_action or ("retry" if retryable else "stop"),
        },
    }


def _invocation_success_payload(invocation: InvocationRecord) -> dict[str, Any]:
    return {
        "invocationId": invocation.invocation_id,
        "status": invocation.status,
        "chargedUsdc": round(float(invocation.charged_usdc), 6),
        "result": invocation.result.payload,
        "receipt": {
            "quoteId": invocation.quote_id,
            "invocationId": invocation.invocation_id,
        },
    }


def _invocation_state_payload(invocation: InvocationRecord) -> dict[str, Any]:
    if invocation.status == "SUCCEEDED":
        return _invocation_success_payload(invocation)
    if invocation.status in {"FAILED_RETRYABLE", "FAILED_FINAL"}:
        return _invocation_error_payload(invocation)
    return {
        "invocationId": invocation.invocation_id,
        "status": invocation.status,
        "chargedUsdc": round(float(invocation.charged_usdc), 6),
    }


async def _execute_invocation_pipeline(
    storage: BaseStorage,
    credential: RuntimeCredentialRecord,
    service: ServiceDefinitionRecord,
    quote: ServiceQuoteRecord,
    request_payload: Dict[str, Any],
    idempotency_key: str,
    trace_request_id: str,
) -> tuple[InvocationRecord, float, dict[str, float]]:
    await _check_rpm_limit(
        str(credential.credential.credential_id),
        int(credential.policy.rpm_limit if credential.policy is not None else 0),
    )
    constraints = _effective_service_constraints(service)
    await _check_service_qps_limit(service.service_id, int(constraints.max_qps))

    provider_wallet = _service_wallet(service)
    unit_price = round(float(quote.quoted_price_usdc), 6)
    settlement, total_charge = _charge_amount_from_unit_price(
        storage, provider_wallet, unit_price
    )
    budget_check = await _budget_check(credential, total_charge)
    _raise_for_budget_check(budget_check)

    existing_invocation = _read_invocation_by_idempotency(
        storage, credential.credential.credential_id, idempotency_key
    )
    request_digest = _payload_digest(request_payload)
    if existing_invocation is not None:
        if (
            existing_invocation.request_digest != request_digest
            or existing_invocation.quote_id != quote.quote_id
        ):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "IDEMPOTENCY_CONFLICT",
                    "message": "Idempotency key already used with different request payload",
                },
            )
        return existing_invocation, 0.0, settlement

    invocation = _build_invocation_record(
        service, credential, quote, idempotency_key, request_payload
    )
    _persist_quote(storage, _quote_with_status(quote, "CONSUMED"))
    _persist_invocation(storage, invocation)

    consumer_after, updated_credential = await forwarding_billing.charge_and_mark_usage(
        storage,
        credential_service.credential_owner_wallet(credential),
        provider_wallet,
        total_charge,
        settlement["platform_fee_total"],
        settlement["provider_net"],
        str(credential.credential.credential_id),
        request_id=trace_request_id,
        unit_price=unit_price,
        protocol_fee=settlement["protocol_fee"],
        routing_tax=settlement["routing_tax"],
        usage_row=UsageLogRow(
            id=invocation.invocation_id,
            ts=credential_service.now_ts(),
            agentId=credential.agent.agent_id,
            requestId=trace_request_id,
            serviceId=service.service_id,
            consumerAddress=credential_service.credential_owner_wallet(credential),
            providerAddress=provider_wallet,
            status="accepted",
            unitPrice=round(unit_price, 6),
            protocolFee=round(settlement["protocol_fee"], 6),
            routingTax=round(settlement["routing_tax"], 6),
            totalCharge=round(total_charge, 6),
            businessType="charge",
            riskLevel="green",
        ),
        invocation=invocation,
    )

    running_invocation = invocation.model_copy(
        update={
            "status": "RUNNING",
            "started_at": now_dt_str(),
            "updated_at": now_dt_str(),
        }
    )
    _persist_invocation(storage, running_invocation)

    owner_wallet = credential_service.credential_owner_wallet(credential)

    try:
        invocation_result = await _call_upstream(
            service, running_invocation, request_payload
        )
    except HTTPException as exc:
        await forwarding_billing.rollback_charge(
            storage,
            owner_wallet,
            provider_wallet,
            total_charge,
            settlement["platform_fee_total"],
            settlement["provider_net"],
            updated_credential,
        )
        error_code = exc.detail.get("code") if isinstance(exc.detail, dict) else None
        _log_upstream_failure(
            storage,
            trace_request_id,
            owner_wallet,
            provider_wallet,
            service.service_id,
            settlement,
            error_code=error_code,
        )
        failed_invocation = running_invocation.model_copy(
            update={
                "status": _invocation_failure_status(error_code),
                "error_code": error_code,
                "error_action": _invocation_error_action(error_code),
                "finished_at": now_dt_str(),
                "updated_at": now_dt_str(),
            }
        )
        _persist_invocation(storage, failed_invocation)
        credential_service.append_audit_log(
            storage,
            "V2_USAGE_CHARGE_FAILED",
            owner_wallet,
            {
                "requestId": trace_request_id,
                "agentId": credential.agent.agent_id,
                "credentialId": credential.credential.credential_id,
                "serviceId": service.service_id,
                "quoteId": quote.quote_id,
                "invocationId": failed_invocation.invocation_id,
                "resultStatus": "failed",
                "errorCode": error_code,
                "businessType": "charge",
            },
        )
        raise
    except Exception as exc:
        await forwarding_billing.rollback_charge(
            storage,
            owner_wallet,
            provider_wallet,
            total_charge,
            settlement["platform_fee_total"],
            settlement["provider_net"],
            updated_credential,
        )
        _log_upstream_failure(
            storage,
            trace_request_id,
            owner_wallet,
            provider_wallet,
            service.service_id,
            settlement,
            error_message=str(exc),
        )
        failed_invocation = running_invocation.model_copy(
            update={
                "status": "FAILED_RETRYABLE",
                "error_code": "UPSTREAM_ERROR",
                "error_action": "retry",
                "finished_at": now_dt_str(),
                "updated_at": now_dt_str(),
            }
        )
        _persist_invocation(storage, failed_invocation)
        credential_service.append_audit_log(
            storage,
            "V2_USAGE_CHARGE_FAILED",
            owner_wallet,
            {
                "requestId": trace_request_id,
                "agentId": credential.agent.agent_id,
                "credentialId": credential.credential.credential_id,
                "serviceId": service.service_id,
                "quoteId": quote.quote_id,
                "invocationId": failed_invocation.invocation_id,
                "resultStatus": "failed",
                "errorCode": "UPSTREAM_ERROR",
                "businessType": "charge",
            },
        )
        raise HTTPException(
            status_code=502,
            detail={
                "code": "UPSTREAM_ERROR",
                "message": f"Upstream provider failed: {str(exc)}",
            },
        )

    await _record_credit_window_spend(credential, total_charge)

    succeeded_invocation = running_invocation.model_copy(
        update={
            "status": "SUCCEEDED",
            "charged_usdc": round(total_charge, 6),
            "result": invocation_result,
            "finished_at": now_dt_str(),
            "updated_at": now_dt_str(),
        }
    )
    _persist_invocation(storage, succeeded_invocation)
    credential_service.append_audit_log(
        storage,
        "V2_USAGE_CHARGED",
        owner_wallet,
        {
            "requestId": trace_request_id,
            "agentId": credential.agent.agent_id,
            "credentialId": credential.credential.credential_id,
            "quoteId": quote.quote_id,
            "invocationId": succeeded_invocation.invocation_id,
            "serviceId": service.service_id,
            "unitPrice": unit_price,
            "feeRate": settlement["fee_rate"],
            "platformFee": settlement["protocol_fee"],
            "routingTax": settlement["routing_tax"],
            "platformFeeTotal": settlement["platform_fee_total"],
            "providerNetAmount": settlement["provider_net"],
            "totalCharge": total_charge,
            "consumerAvailableBalanceAfter": consumer_after,
            "resultStatus": "success",
            "businessType": "charge",
        },
    )
    return succeeded_invocation, consumer_after, settlement


def _invocation_failure_status(error_code: Optional[str]) -> str:
    retryable_codes = {
        "SERVICE_UNAVAILABLE",
        "UPSTREAM_ERROR",
        "RESPONSE_PAYLOAD_TOO_LARGE",
    }
    return "FAILED_RETRYABLE" if error_code in retryable_codes else "FAILED_FINAL"


def _invocation_error_action(error_code: Optional[str]) -> Optional[str]:
    if error_code in {"SERVICE_UNAVAILABLE", "UPSTREAM_ERROR"}:
        return "retry"
    if error_code:
        return "fix_request"
    return None


def _window_key_and_ttl(reset_interval: str, now_ts: int) -> Tuple[str, int]:
    """Compute spend-window key and TTL for monthly/daily/hourly/weekly/never credit windows."""
    now_dt = datetime.fromtimestamp(now_ts, tz=timezone.utc)
    if reset_interval == "never":
        return "never", 86400 * 365 * 50
    if reset_interval == "hourly":
        next_dt = now_dt.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        return now_dt.strftime("%Y%m%d%H"), max(
            1, int((next_dt - now_dt).total_seconds())
        )
    if reset_interval == "daily":
        next_dt = now_dt.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(
            days=1
        )
        return now_dt.strftime("%Y%m%d"), max(
            1, int((next_dt - now_dt).total_seconds())
        )
    if reset_interval == "weekly":
        week_start = now_dt - timedelta(days=now_dt.weekday())
        key = week_start.strftime("%Y%W")
        next_dt = week_start.replace(
            hour=0, minute=0, second=0, microsecond=0
        ) + timedelta(days=7)
        return key, max(1, int((next_dt - now_dt).total_seconds()))

    key = now_dt.strftime("%Y%m")
    if now_dt.month == 12:
        next_dt = now_dt.replace(
            year=now_dt.year + 1,
            month=1,
            day=1,
            hour=0,
            minute=0,
            second=0,
            microsecond=0,
        )
    else:
        next_dt = now_dt.replace(
            month=now_dt.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0
        )
    return key, max(1, int((next_dt - now_dt).total_seconds()))


async def _get_redis_client():
    """Return lazy-initialized async Redis client, or None when Redis is unavailable."""
    global _redis_client
    if _redis_client is not None:
        return _redis_client

    redis_url = settings.redis_url
    if not redis_url:
        return None

    try:
        import redis.asyncio as redis_async  # type: ignore[import-not-found]

        _redis_client = redis_async.from_url(
            redis_url, encoding="utf-8", decode_responses=True
        )
        await _redis_client.ping()
        return _redis_client
    except Exception:
        _redis_client = None
        return None


async def _get_window_spend(credential_id: str, window_key: str) -> float:
    """Read current spend in one credit window from Redis, with in-memory fallback."""
    key = f"cred_spend:{credential_id}:{window_key}"
    redis_client = await _get_redis_client()
    if redis_client is not None:
        value = await redis_client.get(key)
        return float(value or 0.0)

    value, expires_at = _memory_window_counters.get(key, (0.0, 0))
    if expires_at and expires_at < credential_service.now_ts():
        _memory_window_counters.pop(key, None)
        return 0.0
    return float(value)


async def _add_window_spend(
    credential_id: str, window_key: str, ttl_sec: int, amount: float
) -> None:
    """Accumulate spend for one credit window in Redis or in-memory fallback counters."""
    key = f"cred_spend:{credential_id}:{window_key}"
    redis_client = await _get_redis_client()
    if redis_client is not None:
        await redis_client.incrbyfloat(key, float(amount))
        await redis_client.expire(key, int(ttl_sec))
        return

    current, _ = _memory_window_counters.get(key, (0.0, 0))
    _memory_window_counters[key] = (
        float(current) + float(amount),
        credential_service.now_ts() + int(ttl_sec),
    )


async def _check_rpm_limit(credential_id: str, rpm: int) -> None:
    """Enforce per-credential RPM guard before charging or upstream invocation."""
    if rpm <= 0:
        return

    key = f"cred_rpm:{credential_id}:{credential_service.now_ts() // 60}"
    redis_client = await _get_redis_client()
    if redis_client is not None:
        current = await redis_client.incr(key)
        if current == 1:
            await redis_client.expire(key, 65)
        if int(current) > rpm:
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "CREDENTIAL_RPM_EXCEEDED",
                    "message": "Credential rate limit exceeded",
                },
            )
        return

    count, expires_at = _memory_window_counters.get(key, (0.0, 0))
    if expires_at and expires_at < credential_service.now_ts():
        count = 0.0
    count += 1.0
    _memory_window_counters[key] = (count, credential_service.now_ts() + 65)
    if int(count) > rpm:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "CREDENTIAL_RPM_EXCEEDED",
                "message": "Credential rate limit exceeded",
            },
        )


async def _check_service_qps_limit(service_id: str, max_qps: int) -> None:
    """Enforce service-level QPS with Redis atomic counters or local fallback counters."""
    if max_qps <= 0:
        return

    key = f"svc_qps:{service_id}:{credential_service.now_ts()}"
    redis_client = await _get_redis_client()
    if redis_client is not None:
        current = await redis_client.incr(key)
        if current == 1:
            await redis_client.expire(key, 2)
        if int(current) > max_qps:
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "SERVICE_QPS_EXCEEDED",
                    "message": "Service QPS limit exceeded",
                },
            )
        return

    count, expires_at = _memory_window_counters.get(key, (0.0, 0))
    if expires_at and expires_at < credential_service.now_ts():
        count = 0.0
    count += 1.0
    _memory_window_counters[key] = (count, credential_service.now_ts() + 2)
    if int(count) > max_qps:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "SERVICE_QPS_EXCEEDED",
                "message": "Service QPS limit exceeded",
            },
        )


async def _check_credit_limit(
    credential: RuntimeCredentialRecord, charge_amount: float
) -> None:
    """Validate current credential spend window against configured credit limit."""
    credit_limit = credential_service.credential_credit_limit(credential)
    if credit_limit is None:
        return

    reset_interval = credential_service.resolve_reset_interval(
        str(credential.metadata.reset_interval or "daily")
    )
    win_key, _ = _window_key_and_ttl(reset_interval, credential_service.now_ts())
    spent = await _get_window_spend(str(credential.credential.credential_id), win_key)
    if float(spent) + float(charge_amount) <= float(credit_limit) + 1e-9:
        return

    raise HTTPException(
        status_code=402,
        detail={
            "code": "CREDENTIAL_CREDIT_LIMIT_EXCEEDED",
            "message": "Secret key credit limit exceeded",
            "creditLimit": round(float(credit_limit), 6),
            "windowSpend": round(float(spent), 6),
            "attemptedCharge": round(float(charge_amount), 6),
            "resetInterval": reset_interval,
        },
    )


async def _record_credit_window_spend(
    credential: RuntimeCredentialRecord, charge_amount: float
) -> None:
    """Record successful charge into credential credit window counters."""
    credit_limit = credential_service.credential_credit_limit(credential)
    if credit_limit is None:
        return

    reset_interval = credential_service.resolve_reset_interval(
        str(credential.metadata.reset_interval or "daily")
    )
    win_key, ttl_sec = _window_key_and_ttl(reset_interval, credential_service.now_ts())
    await _add_window_spend(
        str(credential.credential.credential_id), win_key, ttl_sec, charge_amount
    )


def _log_upstream_failure(
    storage: BaseStorage,
    request_id: str,
    owner_wallet: str,
    provider_wallet: str,
    service_id: str,
    settlement: Dict[str, float],
    error_code: Optional[str] = None,
    error_message: Optional[str] = None,
) -> None:
    """Write one failed_upstream usage event with either error code or raw message."""
    row: Dict[str, Any] = {
        "request_id": request_id,
        "consumer": owner_wallet,
        "provider": provider_wallet,
        "service_id": service_id,
        "status": "failed_upstream",
        "unit_price": settlement["unit_price"],
        "fee_rate": settlement["fee_rate"],
        "protocol_fee": settlement["protocol_fee"],
        "routing_tax": settlement["routing_tax"],
        "platform_fee_total": settlement["platform_fee_total"],
        "provider_net": settlement["provider_net"],
        "total_charge": settlement["total_charge"],
        "created_at": credential_service.now_ts(),
    }
    if error_code:
        row["error_code"] = error_code
    if error_message:
        row["error_msg"] = error_message
    _append_usage_log(storage, row)


async def generate_response_v2(
    storage: BaseStorage,
    request: InferenceRequest,
    x_service_id: Optional[str],
    credential_token: Optional[str],
    x_request_id: Optional[str],
) -> Dict[str, Any]:
    """Orchestrate full generate pipeline: validate, rate-limit, charge, proxy, audit, and respond."""
    prompt = _validate_prompt(request.prompt)
    service_id = _validate_service_id(x_service_id, request.serviceId)
    token = _validate_credential_token(credential_token)
    request_id = _resolve_request_id(x_request_id)

    credential = credential_service.resolve_active_credential(storage, token)
    service = _find_active_service(storage, service_id)
    unit_price = _parse_service_price_usdc(service)
    request_payload = _request_payload(prompt)
    quote = _build_service_quote(service, credential, request_payload, unit_price)
    _persist_quote(storage, quote)
    succeeded_invocation, consumer_after, settlement = await _execute_invocation_pipeline(
        storage,
        credential,
        service,
        quote,
        request_payload,
        request_id,
        request_id,
    )

    receipt = _build_consumer_receipt(
        request_id=request_id,
        quote_id=quote.quote_id,
        invocation_id=succeeded_invocation.invocation_id,
        service_id=service_id,
        unit_price=settlement["unit_price"],
        total_charge=settlement["total_charge"],
        consumer_balance_after=consumer_after,
    )
    return _build_consumer_success_response(
        receipt, succeeded_invocation.result.payload
    )

async def create_quote_v1(
    storage: BaseStorage,
    request: AgentQuoteRequest,
    credential_token: Optional[str],
    x_request_id: Optional[str],
) -> dict[str, Any]:
    token = _validate_credential_token(credential_token)
    trace_request_id = _resolve_request_id(x_request_id)
    credential = credential_service.resolve_active_credential(storage, token)
    service = _find_active_service(storage, request.serviceId)
    unit_price = _parse_service_price_usdc(service)
    quote = _build_service_quote(
        service,
        credential,
        {"inputPreview": request.inputPreview.model_dump(by_alias=True)},
        unit_price,
        response_mode=request.responseMode,
    )
    _persist_quote(storage, quote)
    settlement, total_charge = _charge_amount_from_unit_price(
        storage, _service_wallet(service), unit_price
    )
    budget_check = await _budget_check(credential, total_charge)
    _ = settlement
    return _quote_response(trace_request_id, quote, budget_check)


async def create_invocation_v1(
    storage: BaseStorage,
    request: AgentInvocationRequest,
    credential_token: Optional[str],
    x_request_id: Optional[str],
) -> dict[str, Any]:
    token = _validate_credential_token(credential_token)
    credential = credential_service.resolve_active_credential(storage, token)
    quote = _read_quote(storage, request.quoteId)
    if quote.credential_id != credential.credential.credential_id:
        raise HTTPException(
            status_code=403,
            detail={"code": "QUOTE_CREDENTIAL_MISMATCH", "message": "Quote does not belong to this credential"},
        )
    if _quote_is_expired(quote):
        expired_quote = _quote_with_status(quote, "EXPIRED")
        _persist_quote(storage, expired_quote)
        raise HTTPException(
            status_code=409,
            detail={"code": "QUOTE_EXPIRED", "message": "Quote has expired"},
        )
    if quote.status not in {"OPEN", "CONSUMED"}:
        raise HTTPException(
            status_code=409,
            detail={"code": "QUOTE_NOT_INVOKABLE", "message": "Quote cannot be invoked"},
        )

    service = _find_active_service(storage, quote.service_id)
    invoke_payload = request.payload.body
    _validate_invoke_request_contract(service, invoke_payload)

    trace_request_id = _resolve_request_id(x_request_id or request.idempotencyKey)
    invocation, _, _ = await _execute_invocation_pipeline(
        storage,
        credential,
        service,
        quote,
        invoke_payload,
        request.idempotencyKey,
        trace_request_id,
    )
    return _invocation_state_payload(invocation)


def get_invocation_receipt_v1(
    storage: BaseStorage,
    invocation_id: str,
    credential_token: Optional[str],
) -> dict[str, Any]:
    token = _validate_credential_token(credential_token)
    credential = credential_service.resolve_active_credential(storage, token)
    invocation = _read_invocation(storage, invocation_id)
    if invocation.credential_id != credential.credential.credential_id:
        raise HTTPException(
            status_code=403,
            detail={"code": "INVOCATION_FORBIDDEN", "message": "Invocation does not belong to this credential"},
        )
    return _invocation_state_payload(invocation)
