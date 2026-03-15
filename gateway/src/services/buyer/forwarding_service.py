from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple
import random

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.config import settings
from src.models.pydantic_models import InferenceRequest
from src.services.platform import credential_service
from src.services.buyer import forwarding_billing
from src.services.buyer import forwarding_upstream
from src.services.buyer import forwarding_validation
from src.storage import BaseStorage

# Shared best-effort runtime caches. Redis is preferred in production; memory fallback keeps dev mode usable.
_redis_client = None
_memory_window_counters: Dict[str, Tuple[float, int]] = {}


def _build_buyer_receipt(
    request_id: str,
    service_id: str,
    unit_price: float,
    total_charge: float,
    buyer_balance_after: float,
) -> Dict[str, Any]:
    """Build buyer-facing receipt fields only, hiding internal settlement split details."""
    return forwarding_billing.build_buyer_receipt(request_id, service_id, unit_price, total_charge, buyer_balance_after)


def _build_buyer_success_response(receipt: Dict[str, Any], upstream_result: Any) -> Dict[str, Any]:
    """Return the canonical generate success envelope consumed by buyer SDKs."""
    return forwarding_billing.build_buyer_success_response(receipt, upstream_result)


def _effective_service_constraints(service: Dict[str, Any]) -> Dict[str, int]:
    """Resolve service constraints after applying platform min/max guardrails."""
    return forwarding_validation.effective_service_constraints(service)


def _pricing_breakdown(storage: BaseStorage, seller_wallet: str, unit_price: float) -> Tuple[float, float, float, float, float, float]:
    """Compute fee-rate decomposition for charging, reconciliation, and audits."""
    return forwarding_billing.pricing_breakdown(storage, seller_wallet, unit_price)


def _append_usage_log(storage: BaseStorage, row: Dict[str, Any]) -> None:
    """Persist one usage row into usage_log for operational visibility and billing traceability."""
    forwarding_billing.append_usage_log(storage, row)


def _validate_service_id(x_service_id: Optional[str], request_service_id: Optional[str]) -> str:
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


def _find_active_service(storage: BaseStorage, service_id: str) -> Dict[str, Any]:
    """Fetch an active service row by serviceId or raise gateway-safe error codes."""
    return forwarding_validation.find_active_service(storage, service_id)


def _parse_service_price_usdc(service_row: Dict[str, Any]) -> float:
    """Parse service USDC unit price with strict positivity constraints."""
    return forwarding_validation.parse_service_price_usdc(service_row)


def _validate_invoke_request_contract(service: Dict[str, Any], payload: Dict[str, Any]) -> None:
    """Enforce invoke contract requirements for method/content-type/required fields."""
    forwarding_validation.validate_invoke_request_contract(service, payload)


def _select_weighted_target_url(invoke: Dict[str, Any]) -> str:
    """Select one upstream target by weighted-random routing configuration."""
    return forwarding_upstream.select_weighted_target_url(invoke)


async def _call_upstream(service: Dict[str, Any], prompt: str, request_id: str) -> Any:
    """Forward prompt to seller upstream and enforce payload size + timeout limits."""
    return await forwarding_upstream.call_upstream(service, prompt, request_id)


def _window_key_and_ttl(reset_interval: str, now_ts: int) -> Tuple[str, int]:
    """Compute spend-window key and TTL for monthly/daily/hourly/weekly/never credit windows."""
    now_dt = datetime.fromtimestamp(now_ts, tz=timezone.utc)
    if reset_interval == "never":
        return "never", 86400 * 365 * 50
    if reset_interval == "hourly":
        next_dt = now_dt.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        return now_dt.strftime("%Y%m%d%H"), max(1, int((next_dt - now_dt).total_seconds()))
    if reset_interval == "daily":
        next_dt = now_dt.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
        return now_dt.strftime("%Y%m%d"), max(1, int((next_dt - now_dt).total_seconds()))
    if reset_interval == "weekly":
        week_start = now_dt - timedelta(days=now_dt.weekday())
        key = week_start.strftime("%Y%W")
        next_dt = week_start.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=7)
        return key, max(1, int((next_dt - now_dt).total_seconds()))

    key = now_dt.strftime("%Y%m")
    if now_dt.month == 12:
        next_dt = now_dt.replace(year=now_dt.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        next_dt = now_dt.replace(month=now_dt.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
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

        _redis_client = redis_async.from_url(redis_url, encoding="utf-8", decode_responses=True)
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


async def _add_window_spend(credential_id: str, window_key: str, ttl_sec: int, amount: float) -> None:
    """Accumulate spend for one credit window in Redis or in-memory fallback counters."""
    key = f"cred_spend:{credential_id}:{window_key}"
    redis_client = await _get_redis_client()
    if redis_client is not None:
        await redis_client.incrbyfloat(key, float(amount))
        await redis_client.expire(key, int(ttl_sec))
        return

    current, _ = _memory_window_counters.get(key, (0.0, 0))
    _memory_window_counters[key] = (float(current) + float(amount), credential_service.now_ts() + int(ttl_sec))


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
            raise HTTPException(status_code=429, detail={"code": "CREDENTIAL_RPM_EXCEEDED", "message": "Credential rate limit exceeded"})
        return

    count, expires_at = _memory_window_counters.get(key, (0.0, 0))
    if expires_at and expires_at < credential_service.now_ts():
        count = 0.0
    count += 1.0
    _memory_window_counters[key] = (count, credential_service.now_ts() + 65)
    if int(count) > rpm:
        raise HTTPException(status_code=429, detail={"code": "CREDENTIAL_RPM_EXCEEDED", "message": "Credential rate limit exceeded"})


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
            raise HTTPException(status_code=429, detail={"code": "SERVICE_QPS_EXCEEDED", "message": "Service QPS limit exceeded"})
        return

    count, expires_at = _memory_window_counters.get(key, (0.0, 0))
    if expires_at and expires_at < credential_service.now_ts():
        count = 0.0
    count += 1.0
    _memory_window_counters[key] = (count, credential_service.now_ts() + 2)
    if int(count) > max_qps:
        raise HTTPException(status_code=429, detail={"code": "SERVICE_QPS_EXCEEDED", "message": "Service QPS limit exceeded"})


async def _check_credit_limit(credential: Dict[str, Any], charge_amount: float) -> None:
    """Validate current credential spend window against configured credit limit."""
    credit_limit = credential.get("creditLimit")
    if credit_limit is None:
        return

    reset_interval = credential_service.resolve_reset_interval(str(credential.get("resetInterval") or "daily"))
    win_key, _ = _window_key_and_ttl(reset_interval, credential_service.now_ts())
    spent = await _get_window_spend(str(credential.get("id")), win_key)
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


async def _record_credit_window_spend(credential: Dict[str, Any], charge_amount: float) -> None:
    """Record successful charge into credential credit window counters."""
    credit_limit = credential.get("creditLimit")
    if credit_limit is None:
        return

    reset_interval = credential_service.resolve_reset_interval(str(credential.get("resetInterval") or "daily"))
    win_key, ttl_sec = _window_key_and_ttl(reset_interval, credential_service.now_ts())
    await _add_window_spend(str(credential.get("id")), win_key, ttl_sec, charge_amount)


def _log_upstream_failure(
    storage: BaseStorage,
    request_id: str,
    owner_wallet: str,
    seller_wallet: str,
    service_id: str,
    settlement: Dict[str, float],
    error_code: Optional[str] = None,
    error_message: Optional[str] = None,
) -> None:
    """Write one failed_upstream usage event with either error code or raw message."""
    row: Dict[str, Any] = {
        "request_id": request_id,
        "buyer": owner_wallet,
        "seller": seller_wallet,
        "service_id": service_id,
        "status": "failed_upstream",
        "unit_price": settlement["unit_price"],
        "fee_rate": settlement["fee_rate"],
        "protocol_fee": settlement["protocol_fee"],
        "routing_tax": settlement["routing_tax"],
        "platform_fee_total": settlement["platform_fee_total"],
        "seller_net": settlement["seller_net"],
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
    await _check_rpm_limit(str(credential.get("id")), int(credential.get("rpm") or 0))

    service = _find_active_service(storage, service_id)
    constraints = _effective_service_constraints(service)
    await _check_service_qps_limit(service_id, int(constraints["maxQps"]))
    unit_price = _parse_service_price_usdc(service)

    owner_wallet = normalize_wallet(str(credential.get("ownerAddress") or ""))
    seller_wallet = normalize_wallet(str(service.get("address") or service.get("ownerAddress") or ""))
    fee_rate, protocol_fee, routing_tax, platform_fee_total, seller_net, total_charge = _pricing_breakdown(storage, seller_wallet, unit_price)
    await _check_credit_limit(credential, total_charge)
    settlement = {
        "unit_price": unit_price,
        "fee_rate": fee_rate,
        "protocol_fee": protocol_fee,
        "routing_tax": routing_tax,
        "platform_fee_total": platform_fee_total,
        "seller_net": seller_net,
        "total_charge": total_charge,
    }

    buyer_after, updated_credential = await forwarding_billing.charge_and_mark_usage(
        storage,
        owner_wallet,
        seller_wallet,
        total_charge,
        platform_fee_total,
        seller_net,
        str(credential.get("id")),
    )

    try:
        upstream_result = await _call_upstream(service, prompt, request_id)
    except HTTPException as exc:
        await forwarding_billing.rollback_charge(storage, owner_wallet, seller_wallet, total_charge, platform_fee_total, seller_net, updated_credential)
        _log_upstream_failure(
            storage,
            request_id,
            owner_wallet,
            seller_wallet,
            service_id,
            settlement,
            error_code=exc.detail.get("code") if isinstance(exc.detail, dict) else None,
        )
        raise
    except Exception as exc:
        await forwarding_billing.rollback_charge(storage, owner_wallet, seller_wallet, total_charge, platform_fee_total, seller_net, updated_credential)
        _log_upstream_failure(
            storage,
            request_id,
            owner_wallet,
            seller_wallet,
            service_id,
            settlement,
            error_message=str(exc),
        )
        raise HTTPException(status_code=502, detail={"code": "UPSTREAM_ERROR", "message": f"Upstream provider failed: {str(exc)}"})

    await _record_credit_window_spend(credential, total_charge)

    _append_usage_log(
        storage,
        {
            "request_id": request_id,
            "buyer": owner_wallet,
            "seller": seller_wallet,
            "service_id": service_id,
            "status": "succeeded",
            "unit_price": unit_price,
            "fee_rate": fee_rate,
            "protocol_fee": protocol_fee,
            "routing_tax": routing_tax,
            "platform_fee_total": platform_fee_total,
            "seller_net": seller_net,
            "total_charge": total_charge,
            "created_at": credential_service.now_ts(),
        },
    )

    credential_service.append_audit_log(
        storage,
        "V2_USAGE_CHARGED",
        owner_wallet,
        {
            "requestId": request_id,
            "serviceId": service_id,
            "unitPrice": unit_price,
            "feeRate": fee_rate,
            "platformFee": protocol_fee,
            "routingTax": routing_tax,
            "platformFeeTotal": platform_fee_total,
            "sellerNet": seller_net,
            "totalCharge": total_charge,
            "buyerBalanceAfter": buyer_after,
            "credentialId": credential.get("id"),
        },
    )

    receipt = _build_buyer_receipt(
        request_id=request_id,
        service_id=service_id,
        unit_price=unit_price,
        total_charge=total_charge,
        buyer_balance_after=buyer_after,
    )
    return _build_buyer_success_response(receipt, upstream_result)
