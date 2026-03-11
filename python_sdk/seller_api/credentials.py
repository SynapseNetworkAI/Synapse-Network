import hashlib
import secrets
import time
from typing import Any, Dict, List

from fastapi import HTTPException

from .common import normalize_service_id, normalize_wallet
from .persistence import (
    load_agent_credentials,
    load_service_registry,
    save_agent_credentials,
)
from .settings import (
    AGENT_CREDENTIAL_DEFAULT_TTL_SEC,
    AGENT_CREDENTIAL_MAX_CALLS_DEFAULT,
    AGENT_CREDENTIAL_MAX_TTL_SEC,
    AGENT_RATE_LIMIT_PER_MIN,
    OWNER_RATE_LIMIT_PER_MIN,
    RATE_LIMIT_WINDOW_SEC,
    SERVICE_RATE_LIMIT_PER_MIN,
)
from .state import lock, rate_limit_windows


def hash_credential_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_agent_credential_token() -> str:
    return f"agt_{secrets.token_urlsafe(32)}"


def enforce_rate_limit(dimension: str, key: str, limit_per_window: int) -> None:
    if limit_per_window <= 0:
        return

    now = time.time()
    bucket_key = f"{dimension}:{key}"
    window_start = now - RATE_LIMIT_WINDOW_SEC

    with lock:
        points = rate_limit_windows.get(bucket_key, [])
        points = [point for point in points if point >= window_start]
        if len(points) >= limit_per_window:
            retry_after = max(1, int(points[0] + RATE_LIMIT_WINDOW_SEC - now))
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "RATE_LIMITED",
                    "message": f"{dimension} rate limit exceeded",
                    "dimension": dimension,
                    "retryAfterSec": retry_after,
                },
            )
        points.append(now)
        rate_limit_windows[bucket_key] = points


def list_owned_services(owner_wallet: str) -> List[Dict[str, Any]]:
    rows = load_service_registry()
    owner = normalize_wallet(owner_wallet)
    return [row for row in rows if normalize_wallet(str(row.get("ownerAddress", ""))) == owner]


def find_active_credential_or_unauthorized(token: str) -> Dict[str, Any]:
    token_hash = hash_credential_token(token)
    rows = load_agent_credentials()
    found = next((row for row in rows if row.get("tokenHash") == token_hash), None)
    if not found:
        raise HTTPException(status_code=401, detail={"code": "AGENT_CREDENTIAL_INVALID", "message": "Agent credential invalid"})

    if found.get("status") != "active":
        raise HTTPException(status_code=401, detail={"code": "AGENT_CREDENTIAL_REVOKED", "message": "Agent credential revoked"})

    now = int(time.time())
    if int(found.get("expiresAt", 0)) <= now:
        raise HTTPException(status_code=401, detail={"code": "AGENT_CREDENTIAL_EXPIRED", "message": "Agent credential expired"})

    max_calls = found.get("maxCalls")
    calls_used = int(found.get("callsUsed", 0))
    if isinstance(max_calls, int) and max_calls > 0 and calls_used >= max_calls:
        raise HTTPException(
            status_code=403,
            detail={"code": "AGENT_CREDENTIAL_QUOTA_EXCEEDED", "message": "Credential call quota exceeded"},
        )

    return found


def consume_credential_call(credential_id: str) -> Dict[str, Any]:
    with lock:
        rows = load_agent_credentials()
        index = next((i for i, row in enumerate(rows) if row.get("id") == credential_id), -1)
        if index < 0:
            raise HTTPException(status_code=401, detail={"code": "AGENT_CREDENTIAL_INVALID", "message": "Agent credential missing"})

        row = rows[index]
        if row.get("status") != "active":
            raise HTTPException(status_code=401, detail={"code": "AGENT_CREDENTIAL_REVOKED", "message": "Agent credential revoked"})

        now = int(time.time())
        if int(row.get("expiresAt", 0)) <= now:
            raise HTTPException(status_code=401, detail={"code": "AGENT_CREDENTIAL_EXPIRED", "message": "Agent credential expired"})

        calls_used = int(row.get("callsUsed", 0)) + 1
        max_calls = row.get("maxCalls")
        if isinstance(max_calls, int) and max_calls > 0 and calls_used > max_calls:
            raise HTTPException(
                status_code=403,
                detail={"code": "AGENT_CREDENTIAL_QUOTA_EXCEEDED", "message": "Credential call quota exceeded"},
            )

        row["callsUsed"] = calls_used
        row["updatedAt"] = now
        rows[index] = row
        save_agent_credentials(rows)
        return row

def refund_credential_call(credential_id: str) -> Optional[Dict[str, Any]]:
    with lock:
        rows = load_agent_credentials()
        index = next((i for i, row in enumerate(rows) if row.get("id") == credential_id), -1)
        if index < 0:
            return None

        row = rows[index]
        calls_used = int(row.get("callsUsed", 0))
        if calls_used > 0:
            row["callsUsed"] = calls_used - 1
            row["updatedAt"] = int(time.time())
            rows[index] = row
            save_agent_credentials(rows)
        return row


def enforce_generate_rate_limits(owner_wallet: str, agent_id: str, service_id: str, rpm_limit: int) -> None:
    enforce_rate_limit("owner", owner_wallet, OWNER_RATE_LIMIT_PER_MIN)
    enforce_rate_limit("agent", f"{owner_wallet}:{agent_id}", rpm_limit)
    enforce_rate_limit("service", f"{owner_wallet}:{service_id}", SERVICE_RATE_LIMIT_PER_MIN)


def resolve_credential_ttl(requested_ttl: Any) -> int:
    ttl_candidate = requested_ttl if isinstance(requested_ttl, int) else AGENT_CREDENTIAL_DEFAULT_TTL_SEC
    return max(60, min(ttl_candidate, AGENT_CREDENTIAL_MAX_TTL_SEC))


def resolve_max_calls(value: Any) -> int:
    if isinstance(value, int) and value > 0:
        return value
    return AGENT_CREDENTIAL_MAX_CALLS_DEFAULT


def resolve_rpm(value: Any) -> int:
    if isinstance(value, int) and value > 0:
        return value
    return AGENT_RATE_LIMIT_PER_MIN


def validate_service_for_credential(owner_services: List[Dict[str, Any]], agent_id: str, service_id: str | None) -> Dict[str, Any]:
    if service_id:
        normalized_service_id = normalize_service_id(service_id)
        target = next((row for row in owner_services if row.get("serviceId") == normalized_service_id), None)
        if not target:
            raise HTTPException(status_code=404, detail={"code": "SERVICE_NOT_FOUND", "message": "Service not found for owner"})
        if agent_id and target.get("agentId") != agent_id:
            raise HTTPException(status_code=400, detail={"code": "AGENT_SERVICE_MISMATCH", "message": "agentId and serviceId do not match"})
        return target

    target = next((row for row in owner_services if row.get("agentId") == agent_id), None)
    if not target:
        raise HTTPException(status_code=404, detail={"code": "AGENT_NOT_FOUND", "message": "No service found for provided agentId"})
    return target

def refund_credential_call(credential_id: str) -> Optional[Dict[str, Any]]:
    with lock:
        rows = load_agent_credentials()
        index = next((i for i, row in enumerate(rows) if row.get("id") == credential_id), -1)
        if index < 0:
            return None
        row = rows[index]
        calls_used = int(row.get("callsUsed", 0))
        if calls_used > 0:
            row["callsUsed"] = calls_used - 1
            row["updatedAt"] = int(time.time())
            rows[index] = row
            save_agent_credentials(rows)
        return row
