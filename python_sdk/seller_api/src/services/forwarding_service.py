import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple
from uuid import uuid4

import httpx
from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.models.pydantic_models import InferenceRequest
from src.services import credential_service
from src.storage import BaseStorage

_redis_client = None
_memory_window_counters: Dict[str, Tuple[float, int]] = {}


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

    redis_url = os.getenv("REDIS_URL", "").strip()
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
    return service_id


async def _check_credit_limit(credential: Dict[str, Any], unit_price: float) -> None:
    credit_limit = credential.get("creditLimit")
    if credit_limit is None:
        return

    reset_interval = credential_service.resolve_reset_interval(str(credential.get("resetInterval") or "daily"))
    win_key, _ = _window_key_and_ttl(reset_interval, credential_service.now_ts())
    spent = await _get_window_spend(str(credential.get("id")), win_key)
    if float(spent) + float(unit_price) <= float(credit_limit) + 1e-9:
        return

    raise HTTPException(
        status_code=402,
        detail={
            "code": "CREDENTIAL_CREDIT_LIMIT_EXCEEDED",
            "message": "Secret key credit limit exceeded",
            "creditLimit": round(float(credit_limit), 6),
            "windowSpend": round(float(spent), 6),
            "attemptedCharge": round(float(unit_price), 6),
            "resetInterval": reset_interval,
        },
    )


def _pricing_breakdown(unit_price: float) -> Tuple[float, float]:
    fee_rate = 0.1
    platform_fee = round(unit_price * fee_rate, 6)
    seller_net = round(unit_price - platform_fee, 6)
    return platform_fee, seller_net


async def _charge_and_mark_usage(
    storage: BaseStorage,
    owner_wallet: str,
    seller_wallet: str,
    unit_price: float,
    platform_fee: float,
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
        if buyer_balance < unit_price:
            raise HTTPException(status_code=402, detail={"code": "INSUFFICIENT_BALANCE", "message": "buyer balance is insufficient, please deposit first"})

        buyer_after = round(buyer_balance - unit_price, 6)
        buyers[owner_wallet] = buyer_after
        sellers[seller_wallet] = round(float(sellers.get(seller_wallet, 0.0)) + seller_net, 6)
        platform["feeAccrued"] = round(float(platform.get("feeAccrued", 0.0)) + platform_fee, 6)
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
    unit_price: float,
    platform_fee: float,
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

        buyers[owner_wallet] = round(float(buyers.get(owner_wallet, 0.0)) + unit_price, 6)
        sellers[seller_wallet] = round(float(sellers.get(seller_wallet, 0.0)) - seller_net, 6)
        platform["feeAccrued"] = round(float(platform.get("feeAccrued", 0.0)) - platform_fee, 6)
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
    invoke = service.get("invoke") if isinstance(service.get("invoke"), dict) else {}
    upstream_method = str(invoke.get("method") or "POST").upper()
    upstream_url = str(invoke.get("url") or "http://127.0.0.1:8100/api/v1/quotes/famous")

    async with httpx.AsyncClient(timeout=15.0) as client:
        headers = {"X-Request-Id": request_id}
        if upstream_method == "GET":
            response = await client.get(upstream_url, params={"text": prompt}, headers=headers)
        else:
            response = await client.request(upstream_method, upstream_url, json={"text": prompt}, headers=headers)

        response.raise_for_status()
        data = response.json()
        if isinstance(data, dict) and "quote" in data:
            return data.get("quote")
        return data


async def _record_credit_window_spend(credential: Dict[str, Any], unit_price: float) -> None:
    credit_limit = credential.get("creditLimit")
    if credit_limit is None:
        return

    reset_interval = credential_service.resolve_reset_interval(str(credential.get("resetInterval") or "daily"))
    win_key, ttl_sec = _window_key_and_ttl(reset_interval, credential_service.now_ts())
    await _add_window_spend(str(credential.get("id")), win_key, ttl_sec, unit_price)


async def generate_response_v2(
    storage: BaseStorage,
    request: InferenceRequest,
    x_service_id: Optional[str],
    credential_token: Optional[str],
) -> Dict[str, Any]:
    service_id = _validate_service_id(x_service_id, request.serviceId)
    if not credential_token:
        raise HTTPException(status_code=401, detail={"code": "CREDENTIAL_REQUIRED", "message": "X-Credential is required for /api/v2/generate"})

    credential = credential_service.resolve_active_credential(storage, credential_token)
    await _check_rpm_limit(str(credential.get("id")), int(credential.get("rpm") or 0))

    service = _find_active_service(storage, service_id)
    unit_price = _parse_service_price_usdc(service)
    await _check_credit_limit(credential, unit_price)

    owner_wallet = normalize_wallet(str(credential.get("ownerAddress") or ""))
    seller_wallet = normalize_wallet(str(service.get("address") or service.get("ownerAddress") or ""))
    platform_fee, seller_net = _pricing_breakdown(unit_price)

    request_id = str(uuid4())
    buyer_after, updated_credential = await _charge_and_mark_usage(
        storage,
        owner_wallet,
        seller_wallet,
        unit_price,
        platform_fee,
        seller_net,
        str(credential.get("id")),
    )

    try:
        upstream_result = await _call_upstream(service, request.prompt, request_id)
    except Exception as exc:
        await _rollback_charge(storage, owner_wallet, seller_wallet, unit_price, platform_fee, seller_net, updated_credential)
        _append_usage_log(
            storage,
            {
                "request_id": request_id,
                "buyer": owner_wallet,
                "seller": seller_wallet,
                "service_id": service_id,
                "status": "failed_upstream",
                "unit_price": unit_price,
                "platform_fee": platform_fee,
                "seller_net": seller_net,
                "created_at": credential_service.now_ts(),
                "error_msg": str(exc),
            },
        )
        raise HTTPException(status_code=502, detail={"code": "UPSTREAM_ERROR", "message": f"Upstream provider failed: {str(exc)}"})

    await _record_credit_window_spend(credential, unit_price)

    _append_usage_log(
        storage,
        {
            "request_id": request_id,
            "buyer": owner_wallet,
            "seller": seller_wallet,
            "service_id": service_id,
            "status": "succeeded",
            "unit_price": unit_price,
            "platform_fee": platform_fee,
            "seller_net": seller_net,
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
            "platformFee": platform_fee,
            "sellerNet": seller_net,
            "buyerBalanceAfter": buyer_after,
            "credentialId": credential.get("id"),
        },
    )

    return {
        "status": "success",
        "code": "DELIVERED",
        "billing": {
            "requestId": request_id,
            "serviceId": service_id,
            "unitPrice": unit_price,
            "platformFee": platform_fee,
            "sellerNet": seller_net,
            "buyerBalanceAfter": buyer_after,
        },
        "data": {"result": upstream_result},
    }
