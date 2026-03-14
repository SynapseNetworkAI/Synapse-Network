from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple
from uuid import uuid4
import re
import json
import random

import httpx
from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.config import settings
from src.models.pydantic_models import InferenceRequest
from src.services import credential_service
from src.storage import BaseStorage

_redis_client = None
_memory_window_counters: Dict[str, Tuple[float, int]] = {}

_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]+$")
_SERVICE_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]+$")
_CREDENTIAL_PATTERN = re.compile(r"^agt_[A-Za-z0-9]+$")
_MAX_PROMPT_LENGTH = 8000
_MAX_SERVICE_ID_LENGTH = 128
_MAX_REQUEST_ID_LENGTH = 128
_MAX_CREDENTIAL_LENGTH = 128
_MAX_TARGET_WEIGHT = 10000


def _as_int(raw: Any, fallback: int) -> int:
    try:
        return int(raw)
    except Exception:
        return int(fallback)


def _effective_service_constraints(service: Dict[str, Any]) -> Dict[str, int]:
    raw = service.get("constraints") if isinstance(service.get("constraints"), dict) else {}
    timeout_ms = _as_int(raw.get("timeoutMs"), 3000)
    max_request_bytes = _as_int(raw.get("maxRequestBytes"), 4096)
    max_response_bytes = _as_int(raw.get("maxResponseBytes"), 2048)
    max_qps = _as_int(raw.get("maxQps"), 50)

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


def _sanitize_fee_rate(raw: Any, fallback: float) -> float:
    try:
        value = float(raw)
    except Exception:
        return float(fallback)
    if value < 0:
        return 0.0
    if value > 1:
        return 1.0
    return value


def _resolve_platform_fee_rate(storage: BaseStorage, seller_wallet: str) -> float:
    # Priority: owner override -> runtime default override -> global setting.
    # Reserved for future admin UI controls without changing billing call path.
    fallback = _sanitize_fee_rate(settings.platform_fee_rate, 0.10)
    policy = storage.get_collection("platform_fee_policy") or {}
    if not isinstance(policy, dict):
        return fallback

    policy_default = _sanitize_fee_rate(policy.get("defaultRate"), fallback)
    owner_rates = policy.get("ownerRates") if isinstance(policy.get("ownerRates"), dict) else {}
    owner_key = normalize_wallet(str(seller_wallet or ""))
    if owner_key and owner_key in owner_rates:
        return _sanitize_fee_rate(owner_rates.get(owner_key), policy_default)
    return policy_default


def _resolve_gateway_routing_tax() -> float:
    try:
        value = float(settings.gateway_routing_tax)
    except Exception:
        return 0.0
    if value < 0:
        return 0.0
    return round(value, 6)


def _build_buyer_receipt(
    request_id: str,
    service_id: str,
    unit_price: float,
    total_charge: float,
    buyer_balance_after: float,
) -> Dict[str, Any]:
    return {
        "requestId": request_id,
        "serviceId": service_id,
        "totalCharge": total_charge,
        "buyerBalanceAfter": buyer_balance_after,
        "serviceUnitPrice": unit_price,
    }


def _build_buyer_success_response(receipt: Dict[str, Any], upstream_result: Any) -> Dict[str, Any]:
    return {
        "statusCode": 200,
        "ok": True,
        "payload": {
            "status": "success",
            "code": "DELIVERED",
            "receipt": receipt,
            "data": {"result": upstream_result},
        },
    }


def _window_key_and_ttl(reset_interval: str, now_ts: int) -> Tuple[str, int]:
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
    key = f"cred_spend:{credential_id}:{window_key}"
    redis_client = await _get_redis_client()
    if redis_client is not None:
        await redis_client.incrbyfloat(key, float(amount))
        await redis_client.expire(key, int(ttl_sec))
        return

    current, _ = _memory_window_counters.get(key, (0.0, 0))
    _memory_window_counters[key] = (float(current) + float(amount), credential_service.now_ts() + int(ttl_sec))


async def _check_rpm_limit(credential_id: str, rpm: int) -> None:
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


def _find_active_service(storage: BaseStorage, service_id: str) -> Dict[str, Any]:
    rows = storage.get_collection("service_registry") or []
    if not isinstance(rows, list):
        rows = []

    target = next((r for r in rows if isinstance(r, dict) and str(r.get("serviceId", "")).strip() == service_id), None)
    if not target:
        raise HTTPException(status_code=404, detail={"code": "SERVICE_NOT_FOUND", "message": "Service not found"})
    if target.get("isActive") is False:
        raise HTTPException(status_code=403, detail={"code": "SERVICE_INACTIVE", "message": "Service is inactive"})
    return target


def _parse_service_price_usdc(service_row: Dict[str, Any]) -> float:
    pricing = service_row.get("pricing")
    raw_amount = pricing.get("amount") if isinstance(pricing, dict) else pricing
    try:
        amount = float(raw_amount)
    except Exception:
        raise HTTPException(status_code=500, detail={"code": "INVALID_SERVICE_PRICE", "message": "service pricing is invalid"})
    if amount <= 0:
        raise HTTPException(status_code=500, detail={"code": "INVALID_SERVICE_PRICE", "message": "service pricing must be positive"})
    return round(amount, 6)


def _append_usage_log(storage: BaseStorage, row: Dict[str, Any]) -> None:
    rows = storage.get_collection("usage_log") or []
    if not isinstance(rows, list):
        rows = []
    rows.append(row)
    storage.save_collection("usage_log", rows)


def _validate_service_id(x_service_id: Optional[str], request_service_id: Optional[str]) -> str:
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


def _validate_prompt(prompt: str) -> str:
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


def _validate_credential_token(credential_token: Optional[str]) -> str:
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


def _resolve_request_id(client_request_id: Optional[str]) -> str:
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


async def _check_credit_limit(credential: Dict[str, Any], charge_amount: float) -> None:
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


def _pricing_breakdown(storage: BaseStorage, seller_wallet: str, unit_price: float) -> Tuple[float, float, float, float, float, float]:
    fee_rate = _resolve_platform_fee_rate(storage, seller_wallet)
    protocol_fee = round(unit_price * fee_rate, 6)
    routing_tax = _resolve_gateway_routing_tax()
    platform_fee_total = round(protocol_fee + routing_tax, 6)
    seller_net = round(unit_price - protocol_fee, 6)
    total_charge = round(unit_price + routing_tax, 6)
    return fee_rate, protocol_fee, routing_tax, platform_fee_total, seller_net, total_charge


async def _charge_and_mark_usage(
    storage: BaseStorage,
    owner_wallet: str,
    seller_wallet: str,
    total_charge: float,
    platform_fee_total: float,
    seller_net: float,
    credential_id: str,
) -> Tuple[float, Optional[Dict[str, Any]]]:
    now = credential_service.now_ts()
    buyer_after = 0.0
    updated_credential = None

    async with credential_service.write_lock:
        ledger = storage.get_collection("balance_ledger") or {}
        if not isinstance(ledger, dict):
            ledger = {}
        buyers = ledger.setdefault("buyers", {})
        sellers = ledger.setdefault("sellers", {})
        platform = ledger.setdefault("platform", {"feeAccrued": 0.0})

        buyer_balance = float(buyers.get(owner_wallet, 0.0))
        if buyer_balance < total_charge:
            raise HTTPException(status_code=402, detail={"code": "INSUFFICIENT_BALANCE", "message": "buyer balance is insufficient, please deposit first"})

        buyer_after = round(buyer_balance - total_charge, 6)
        buyers[owner_wallet] = buyer_after
        sellers[seller_wallet] = round(float(sellers.get(seller_wallet, 0.0)) + seller_net, 6)
        platform["feeAccrued"] = round(float(platform.get("feeAccrued", 0.0)) + platform_fee_total, 6)
        ledger["updatedAt"] = now
        storage.save_collection("balance_ledger", ledger)

        rows, extras = credential_service.load_credential_rows(storage)
        idx = next((i for i, row in enumerate(rows) if str(row.get("id")) == credential_id), -1)
        if idx >= 0:
            rows[idx]["callsUsed"] = int(rows[idx].get("callsUsed") or 0) + 1
            rows[idx]["updatedAt"] = now
            updated_credential = rows[idx]
            credential_service.save_credential_rows(storage, rows, extras)

    return buyer_after, updated_credential


async def _rollback_charge(
    storage: BaseStorage,
    owner_wallet: str,
    seller_wallet: str,
    total_charge: float,
    platform_fee_total: float,
    seller_net: float,
    updated_credential: Optional[Dict[str, Any]],
) -> None:
    async with credential_service.write_lock:
        ledger = storage.get_collection("balance_ledger") or {}
        if not isinstance(ledger, dict):
            ledger = {}
        buyers = ledger.setdefault("buyers", {})
        sellers = ledger.setdefault("sellers", {})
        platform = ledger.setdefault("platform", {"feeAccrued": 0.0})

        buyers[owner_wallet] = round(float(buyers.get(owner_wallet, 0.0)) + total_charge, 6)
        sellers[seller_wallet] = round(float(sellers.get(seller_wallet, 0.0)) - seller_net, 6)
        platform["feeAccrued"] = round(float(platform.get("feeAccrued", 0.0)) - platform_fee_total, 6)
        ledger["updatedAt"] = credential_service.now_ts()
        storage.save_collection("balance_ledger", ledger)

        if not updated_credential:
            return

        rows, extras = credential_service.load_credential_rows(storage)
        idx = next((i for i, row in enumerate(rows) if str(row.get("id")) == str(updated_credential.get("id"))), -1)
        if idx >= 0:
            rows[idx]["callsUsed"] = max(0, int(rows[idx].get("callsUsed") or 0) - 1)
            rows[idx]["updatedAt"] = credential_service.now_ts()
            credential_service.save_credential_rows(storage, rows, extras)


async def _call_upstream(service: Dict[str, Any], prompt: str, request_id: str) -> Any:
    constraints = _effective_service_constraints(service)
    request_payload = {"text": prompt}
    request_bytes = len(json.dumps(request_payload, ensure_ascii=False).encode("utf-8"))
    if request_bytes > constraints["maxRequestBytes"]:
        raise HTTPException(
            status_code=413,
            detail={
                "code": "REQUEST_PAYLOAD_TOO_LARGE",
                "message": "Request payload exceeds service maxRequestBytes",
                "maxRequestBytes": constraints["maxRequestBytes"],
                "actualRequestBytes": request_bytes,
            },
        )

    invoke = service.get("invoke") if isinstance(service.get("invoke"), dict) else {}
    upstream_method = str(invoke.get("method") or "POST").upper()
    upstream_url = _select_weighted_target_url(invoke)

    timeout_sec = float(constraints["timeoutMs"]) / 1000.0
    async with httpx.AsyncClient(timeout=timeout_sec) as client:
        headers = {"X-Request-Id": request_id}
        if upstream_method == "GET":
            response = await client.get(upstream_url, params={"text": prompt}, headers=headers)
        else:
            response = await client.request(upstream_method, upstream_url, json=request_payload, headers=headers)

        response_size = len(response.content or b"")
        if response_size > constraints["maxResponseBytes"]:
            raise HTTPException(
                status_code=413,
                detail={
                    "code": "RESPONSE_PAYLOAD_TOO_LARGE",
                    "message": "Response payload exceeds service maxResponseBytes",
                    "maxResponseBytes": constraints["maxResponseBytes"],
                    "actualResponseBytes": response_size,
                },
            )

        response.raise_for_status()
        data = response.json()
        if isinstance(data, dict) and "quote" in data:
            return data.get("quote")
        return data


def _normalized_weighted_targets(invoke: Dict[str, Any]) -> Tuple[list[Dict[str, Any]], list[int]]:
    targets = invoke.get("targets") if isinstance(invoke.get("targets"), list) else []
    normalized_targets: list[Dict[str, Any]] = []
    normalized_weights: list[int] = []

    for item in targets:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        try:
            weight = int(item.get("weight") if item.get("weight") is not None else 100)
        except Exception:
            raise HTTPException(
                status_code=500,
                detail={
                    "code": "INVALID_INVOKE_CONFIG",
                    "message": "invoke.targets[].weight must be an integer",
                },
            )
        if weight <= 0 or weight > _MAX_TARGET_WEIGHT:
            raise HTTPException(
                status_code=500,
                detail={
                    "code": "INVALID_INVOKE_CONFIG",
                    "message": f"invoke.targets[].weight must be in [1, {_MAX_TARGET_WEIGHT}]",
                },
            )
        normalized_targets.append(item)
        normalized_weights.append(weight)

    if not normalized_targets:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "INVALID_INVOKE_CONFIG",
                "message": "invoke.targets must contain at least one valid target URL",
            },
        )
    return normalized_targets, normalized_weights


def _select_weighted_target_url(invoke: Dict[str, Any]) -> str:
    targets, weights = _normalized_weighted_targets(invoke)
    selected = random.choices(targets, weights=weights, k=1)[0]
    return str(selected.get("url") or "").strip()


async def _record_credit_window_spend(credential: Dict[str, Any], charge_amount: float) -> None:
    credit_limit = credential.get("creditLimit")
    if credit_limit is None:
        return

    reset_interval = credential_service.resolve_reset_interval(str(credential.get("resetInterval") or "daily"))
    win_key, ttl_sec = _window_key_and_ttl(reset_interval, credential_service.now_ts())
    await _add_window_spend(str(credential.get("id")), win_key, ttl_sec, charge_amount)


async def generate_response_v2(
    storage: BaseStorage,
    request: InferenceRequest,
    x_service_id: Optional[str],
    credential_token: Optional[str],
    x_request_id: Optional[str],
) -> Dict[str, Any]:
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

    buyer_after, updated_credential = await _charge_and_mark_usage(
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
        await _rollback_charge(storage, owner_wallet, seller_wallet, total_charge, platform_fee_total, seller_net, updated_credential)
        _append_usage_log(
            storage,
            {
                "request_id": request_id,
                "buyer": owner_wallet,
                "seller": seller_wallet,
                "service_id": service_id,
                "status": "failed_upstream",
                "unit_price": unit_price,
                "fee_rate": fee_rate,
                "protocol_fee": protocol_fee,
                "routing_tax": routing_tax,
                "platform_fee_total": platform_fee_total,
                "seller_net": seller_net,
                "total_charge": total_charge,
                "created_at": credential_service.now_ts(),
                "error_code": exc.detail.get("code") if isinstance(exc.detail, dict) else None,
            },
        )
        raise
    except Exception as exc:
        await _rollback_charge(storage, owner_wallet, seller_wallet, total_charge, platform_fee_total, seller_net, updated_credential)
        _append_usage_log(
            storage,
            {
                "request_id": request_id,
                "buyer": owner_wallet,
                "seller": seller_wallet,
                "service_id": service_id,
                "status": "failed_upstream",
                "unit_price": unit_price,
                "fee_rate": fee_rate,
                "protocol_fee": protocol_fee,
                "routing_tax": routing_tax,
                "platform_fee_total": platform_fee_total,
                "seller_net": seller_net,
                "total_charge": total_charge,
                "created_at": credential_service.now_ts(),
                "error_msg": str(exc),
            },
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
