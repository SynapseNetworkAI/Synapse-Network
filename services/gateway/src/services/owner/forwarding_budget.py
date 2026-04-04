"""Budget checks, rate limiting, and Redis spend-window counters for the invoke pipeline."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.config import settings
from src.domain.identity import RuntimeCredentialRecord
from src.services.platform import credential_service
from src.storage import BaseStorage

# Shared best-effort runtime caches. Redis is preferred in production; memory fallback keeps dev mode usable.
_redis_client = None
_memory_window_counters: dict[str, tuple[float, int]] = {}


# ---------------------------------------------------------------------------
# Decimal helpers
# ---------------------------------------------------------------------------

def _q6(value: Decimal | str | int | float) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------------------
# Owner billing-cycle budget
# ---------------------------------------------------------------------------

def _billing_cycle_start(now_ts: Optional[int] = None) -> int:
    now_dt = datetime.fromtimestamp(now_ts or credential_service.now_ts(), tz=timezone.utc)
    return int(datetime(year=now_dt.year, month=now_dt.month, day=1, tzinfo=timezone.utc).timestamp())


def _is_billable_usage_status(status: Any) -> bool:
    return str(status or "").strip().lower() in {"accepted", "succeeded"}


def _owner_billing_cycle_remaining_budget(
    storage: BaseStorage, owner_wallet: str
) -> Optional[float]:
    gateway_state = storage.get_data_manager().system.gateway_state
    read_owner_spend_limit_rows = getattr(gateway_state, "read_owner_spend_limit_rows", None)
    if read_owner_spend_limit_rows is None:
        return None

    owner = normalize_wallet(owner_wallet)
    found = next(
        (r for r in read_owner_spend_limit_rows() if normalize_wallet(str(r.owner_address or "")) == owner),
        None,
    )
    if found is None or found.spending_limit_usdc is None:
        return None

    cycle_start = _billing_cycle_start()
    current_spend = Decimal("0")
    for row in gateway_state.read_invocation_billing_rows():
        if normalize_wallet(str(row.consumer_address or "")) != owner:
            continue
        if int(row.ts or 0) < cycle_start:
            continue
        if not _is_billable_usage_status(row.status):
            continue
        charge = row.total_charge if row.total_charge is not None else row.unit_price
        if charge is None:
            continue
        current_spend += Decimal(str(charge))

    remaining = max(Decimal("0"), _q6(found.spending_limit_usdc) - _q6(current_spend))
    return round(float(_q6(remaining)), 6)


# ---------------------------------------------------------------------------
# Per-invocation budget checks
# ---------------------------------------------------------------------------

def _per_invocation_budget(policy: Any, charge_amount: float) -> tuple[Optional[float], Optional[str]]:
    cap = float(policy.per_invocation_cap_usdc or 0)
    if cap <= 0:
        return None, None
    if charge_amount > cap + 1e-9:
        return round(cap, 6), "PER_INVOCATION_CAP_EXCEEDED"
    return round(cap, 6), None


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
    remaining_lifetime = round(max(0.0, lifetime_cap - spent), 6) if lifetime_cap > 0 else None
    remaining_daily = round(max(0.0, daily_cap - spent), 6) if daily_cap > 0 else None
    return remaining_lifetime, remaining_daily


def _budget_error_code(
    charge_amount: float,
    remaining_lifetime: Optional[float],
    remaining_daily: Optional[float],
    remaining_owner_billing: Optional[float],
    per_invocation_code: Optional[str],
) -> Optional[str]:
    if per_invocation_code is not None:
        return per_invocation_code
    if remaining_lifetime is not None and charge_amount > remaining_lifetime + 1e-9:
        return "BUDGET_EXHAUSTED"
    if remaining_daily is not None and charge_amount > remaining_daily + 1e-9:
        return "BUDGET_EXHAUSTED"
    if remaining_owner_billing is not None and charge_amount > remaining_owner_billing + 1e-9:
        return "OWNER_BILLING_CYCLE_LIMIT_EXCEEDED"
    return None


async def budget_check(
    storage: BaseStorage,
    credential: RuntimeCredentialRecord,
    charge_amount: float,
) -> dict[str, Any]:
    policy = credential.policy
    remaining_owner_billing = _owner_billing_cycle_remaining_budget(
        storage, credential_service.credential_owner_wallet(credential)
    )
    if policy is None:
        error_code = (
            "OWNER_BILLING_CYCLE_LIMIT_EXCEEDED"
            if remaining_owner_billing is not None and charge_amount > remaining_owner_billing + 1e-9
            else None
        )
        return {
            "allowed": error_code is None,
            "remainingBudgetUsdc": None,
            "remainingBillingCycleLimitUsdc": remaining_owner_billing,
            "errorCode": error_code,
        }

    remaining_budget, per_invocation_code = _per_invocation_budget(policy, charge_amount)
    remaining_lifetime, remaining_daily = await _spend_window_budget(credential, policy)
    error_code = _budget_error_code(
        charge_amount, remaining_lifetime, remaining_daily, remaining_owner_billing, per_invocation_code
    )
    return {
        "allowed": error_code is None,
        "remainingBudgetUsdc": remaining_lifetime if remaining_lifetime is not None else remaining_budget,
        "remainingBillingCycleLimitUsdc": remaining_owner_billing,
        "errorCode": error_code,
    }


def raise_for_budget_check(budget_result: dict[str, Any]) -> None:
    if budget_result.get("allowed"):
        return
    error_code = str(budget_result.get("errorCode") or "BUDGET_EXHAUSTED")
    message = (
        "Owner billing cycle spend limit does not allow this invocation"
        if error_code == "OWNER_BILLING_CYCLE_LIMIT_EXCEEDED"
        else "Credential budget does not allow this invocation"
    )
    raise HTTPException(status_code=402, detail={"code": error_code, "message": message})


# ---------------------------------------------------------------------------
# Spend-window key helpers
# ---------------------------------------------------------------------------

def _window_key_and_ttl(reset_interval: str, now_ts: int) -> tuple[str, int]:
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
        next_dt = week_start.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=7)
        return week_start.strftime("%Y%W"), max(1, int((next_dt - now_dt).total_seconds()))
    # monthly
    key = now_dt.strftime("%Y%m")
    year, month = (now_dt.year + 1, 1) if now_dt.month == 12 else (now_dt.year, now_dt.month + 1)
    next_dt = now_dt.replace(year=year, month=month, day=1, hour=0, minute=0, second=0, microsecond=0)
    return key, max(1, int((next_dt - now_dt).total_seconds()))


# ---------------------------------------------------------------------------
# Redis / in-memory window counters
# ---------------------------------------------------------------------------

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
        return float(await redis_client.get(key) or 0.0)
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


# ---------------------------------------------------------------------------
# Rate limiting: RPM + QPS
# ---------------------------------------------------------------------------

async def check_rpm_limit(credential_id: str, rpm: int) -> None:
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
                detail={"code": "CREDENTIAL_RPM_EXCEEDED", "message": "Credential rate limit exceeded"},
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
            detail={"code": "CREDENTIAL_RPM_EXCEEDED", "message": "Credential rate limit exceeded"},
        )


async def check_service_qps_limit(service_id: str, max_qps: int) -> None:
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
                detail={"code": "SERVICE_QPS_EXCEEDED", "message": "Service QPS limit exceeded"},
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
            detail={"code": "SERVICE_QPS_EXCEEDED", "message": "Service QPS limit exceeded"},
        )


async def record_credit_window_spend(credential: RuntimeCredentialRecord, charge_amount: float) -> None:
    credit_limit = credential_service.credential_credit_limit(credential)
    if credit_limit is None:
        return
    reset_interval = credential_service.resolve_reset_interval(
        str(credential.metadata.reset_interval or "daily")
    )
    win_key, ttl_sec = _window_key_and_ttl(reset_interval, credential_service.now_ts())
    await _add_window_spend(str(credential.credential.credential_id), win_key, ttl_sec, charge_amount)
