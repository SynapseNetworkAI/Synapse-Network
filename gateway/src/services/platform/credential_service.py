import asyncio
import hashlib
import json
import os
import secrets
import time
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

import jwt  # type: ignore[import-untyped]
from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.config import settings
from src.domain.audit import AuditLogEntry
from src.models.pydantic_models import CredentialIssueRequest, CredentialQuotaUpdateRequest
from src.storage import BaseStorage

write_lock = asyncio.Lock()
_BUYER_CREDENTIALS_COLLECTION = "buyer_credentials"
_LEGACY_BUYER_COLLECTIONS = ("credentials", "agent_credentials")
_REMOVED_CREDENTIAL_FIELDS = {"agentId", "serviceId", "serviceRecordId"}


def now_ts() -> int:
    return int(time.time())


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def issue_token() -> str:
    return f"agt_{secrets.token_hex(24)}"


def token_prefix(raw_token: str) -> str:
    return raw_token[:10]


def parse_authorization(auth_header: Optional[str]) -> str:
    if not auth_header or not auth_header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED", "message": "Missing bearer token"})
    return auth_header.split(" ", 1)[1].strip()


def require_owner_wallet(authorization: Optional[str], x_user_address: Optional[str]) -> str:
    token = parse_authorization(authorization)
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except Exception:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED", "message": "Invalid token"})

    sub = normalize_wallet(str(payload.get("sub") or ""))
    if not sub:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED", "message": "Invalid token subject"})

    if x_user_address:
        requested = normalize_wallet(x_user_address)
        if requested != sub:
            raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "Wallet mismatch"})

    return sub


def normalize_credential_rows(raw: Any) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    if isinstance(raw, list):
        rows = [r for r in raw if isinstance(r, dict)]
        for row in rows:
            for field in _REMOVED_CREDENTIAL_FIELDS:
                row.pop(field, None)
        return rows, {}

    if isinstance(raw, dict):
        base_rows = raw.get("credentials") if isinstance(raw.get("credentials"), list) else []
        rows = [r for r in base_rows if isinstance(r, dict)]
        for row in rows:
            for field in _REMOVED_CREDENTIAL_FIELDS:
                row.pop(field, None)
        extras = {k: v for k, v in raw.items() if k not in {"credentials", "updatedAt"}}
        return rows, extras

    return [], {}


def _mark_buyer_rows(rows: List[Dict[str, Any]]) -> None:
    for row in rows:
        row["credentialType"] = "buyer"


def save_credential_rows(storage: BaseStorage, rows: List[Dict[str, Any]], extras: Optional[Dict[str, Any]] = None) -> None:
    _mark_buyer_rows(rows)
    payload: Dict[str, Any] = {"credentials": rows, "updatedAt": now_ts()}
    if extras:
        payload.update(extras)

    _ = payload
    storage.get_data_manager().system.credential_auth.write_credential_rows("buyer", rows)


def load_credential_rows(storage: BaseStorage) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    primary_rows = storage.get_data_manager().system.credential_auth.read_credential_rows("buyer")
    primary = {"credentials": primary_rows, "updatedAt": 0}
    rows, extras = normalize_credential_rows(primary)
    if rows or extras:
        _mark_buyer_rows(rows)
        return rows, extras

    for legacy_collection in _LEGACY_BUYER_COLLECTIONS:
        _ = legacy_collection
        legacy_rows_raw = storage.get_data_manager().system.credential_auth.read_credential_rows("buyer")
        legacy = {"credentials": legacy_rows_raw, "updatedAt": 0}
        legacy_rows, legacy_extras = normalize_credential_rows(legacy)
        if legacy_rows or legacy_extras:
            _mark_buyer_rows(legacy_rows)
            # One-way migration: read legacy once, then write canonical buyer credentials store.
            save_credential_rows(storage, legacy_rows, legacy_extras)
            return legacy_rows, legacy_extras

    return [], {}


def resolve_ttl_seconds(expires_in_sec: Optional[int]) -> int:
    if expires_in_sec is None:
        return 86400 * 365 * 10

    ttl = int(expires_in_sec)
    if ttl <= 0:
        raise HTTPException(status_code=400, detail={"code": "INVALID_EXPIRES_IN", "message": "expiresInSec must be positive"})

    return ttl


def resolve_reset_interval(value: Optional[str]) -> str:
    if not value:
        return "daily"

    normalized = value.strip().lower()
    allowed = {"hourly", "daily", "weekly", "monthly", "never"}
    if normalized not in allowed:
        raise HTTPException(status_code=400, detail={"code": "INVALID_RESET_INTERVAL", "message": "resetInterval must be one of hourly,daily,weekly,monthly,never"})

    return normalized


def append_audit_log(storage: BaseStorage, action: str, owner_wallet: str, details: Dict[str, Any]) -> None:
    storage.get_data_manager().audit.logs.append_audit_row(
        AuditLogEntry(
            id=str(uuid4()),
            timestamp=now_ts(),
            action=action,
            owner_address=owner_wallet,
            details=details,
        )
    )


def read_audit_log(storage: BaseStorage, owner_wallet: str, limit: int) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    try:
        rows = storage.get_data_manager().audit.logs.read_audit_rows(owner_wallet=owner_wallet, limit=limit)
        result = [row.model_dump(by_alias=True) if isinstance(row, AuditLogEntry) else row for row in rows]
        result.sort(key=lambda r: int(r.get("timestamp", 0)), reverse=True)
        return result[:limit]
    except Exception:
        pass

    directory = str(getattr(storage, "directory", "") or "")
    if not directory:
        return []

    path = os.path.join(directory, "audit_log.jsonl")
    if not os.path.exists(path):
        return []

    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            raw = line.strip()
            if not raw:
                continue
            try:
                row = json.loads(raw)
            except Exception:
                continue
            if normalize_wallet(str(row.get("ownerAddress", ""))) == owner_wallet:
                result.append(row)

    result.sort(key=lambda r: int(r.get("timestamp", 0)), reverse=True)
    return result[:limit]


def resolve_active_credential(storage: BaseStorage, token: str) -> Dict[str, Any]:
    rows, _ = load_credential_rows(storage)
    token_hash = hash_token(token)
    now = now_ts()
    found = next((r for r in rows if str(r.get("tokenHash", "")) == token_hash), None)
    if not found:
        raise HTTPException(status_code=401, detail={"code": "CREDENTIAL_INVALID", "message": "Credential is invalid"})
    if str(found.get("status", "")) != "active":
        raise HTTPException(status_code=401, detail={"code": "CREDENTIAL_INACTIVE", "message": "Credential is inactive"})

    expires_at = int(found.get("expiresAt") or 0)
    expiration = int(found.get("expiration") or 0)
    if (expires_at and expires_at <= now) or (expiration and expiration <= now):
        raise HTTPException(status_code=401, detail={"code": "CREDENTIAL_EXPIRED", "message": "Credential has expired"})

    max_calls = int(found.get("maxCalls") or 0)
    calls_used = int(found.get("callsUsed") or 0)
    if max_calls > 0 and calls_used >= max_calls:
        raise HTTPException(status_code=429, detail={"code": "CREDENTIAL_MAX_CALLS_EXCEEDED", "message": "Credential max calls reached"})

    return found


def _build_visible_credential(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row.get("id"),
        "ownerAddress": row.get("ownerAddress"),
        "name": row.get("name"),
        "tokenPrefix": row.get("tokenPrefix"),
        "status": row.get("status"),
        "maxCalls": row.get("maxCalls"),
        "callsUsed": row.get("callsUsed"),
        "rpm": row.get("rpm"),
        "creditLimit": row.get("creditLimit"),
        "resetInterval": row.get("resetInterval"),
        "expiration": row.get("expiration"),
        "expiresAt": row.get("expiresAt"),
        "createdAt": row.get("createdAt"),
        "updatedAt": row.get("updatedAt"),
        "revokedAt": row.get("revokedAt"),
    }


def list_credentials_by_owner(storage: BaseStorage, owner_wallet: str) -> List[Dict[str, Any]]:
    rows, _ = load_credential_rows(storage)
    visible = [
        _build_visible_credential(row)
        for row in rows
        if normalize_wallet(str(row.get("ownerAddress", ""))) == owner_wallet
    ]
    visible.sort(key=lambda row: int(row.get("createdAt") or 0), reverse=True)
    return visible


def list_secrets_by_owner(storage: BaseStorage, owner_wallet: str) -> List[Dict[str, Any]]:
    rows, _ = load_credential_rows(storage)
    result: List[Dict[str, Any]] = []
    for row in rows:
        if normalize_wallet(str(row.get("ownerAddress", ""))) != owner_wallet:
            continue
        result.append(
            {
                "id": row.get("id"),
                "name": row.get("name"),
                "maskedKey": f"{row.get('tokenPrefix', 'agt_')}...",
                "status": row.get("status"),
                "creditLimit": row.get("creditLimit"),
                "resetInterval": row.get("resetInterval"),
                "expiration": row.get("expiration"),
                "expiresAt": row.get("expiresAt"),
                "createdAt": row.get("createdAt"),
            }
        )

    result.sort(key=lambda x: int(x.get("createdAt") or 0), reverse=True)
    return result


def _validate_issue_request(req: CredentialIssueRequest, now: int) -> Tuple[int, int, Optional[float], str, Optional[int], int]:
    expires_at = now + resolve_ttl_seconds(req.expiresInSec)
    max_calls = int(req.maxCalls or 1000000)
    rpm = int(req.rpm or 600)
    credit_limit = float(req.creditLimit) if req.creditLimit is not None else None
    reset_interval = resolve_reset_interval(req.resetInterval)
    expiration = int(req.expiration) if req.expiration else None

    if max_calls <= 0:
        raise HTTPException(status_code=400, detail={"code": "INVALID_MAX_CALLS", "message": "maxCalls must be positive"})
    if rpm <= 0:
        raise HTTPException(status_code=400, detail={"code": "INVALID_RPM", "message": "rpm must be positive"})
    if credit_limit is not None and credit_limit <= 0:
        raise HTTPException(status_code=400, detail={"code": "INVALID_CREDIT_LIMIT", "message": "creditLimit must be positive"})
    if expiration is not None and expiration <= now:
        raise HTTPException(status_code=400, detail={"code": "INVALID_EXPIRATION", "message": "expiration must be in the future"})

    return max_calls, rpm, credit_limit, reset_interval, expiration, expires_at


async def issue_credential_for_owner(storage: BaseStorage, owner_wallet: str, req: CredentialIssueRequest) -> Dict[str, Any]:
    now = now_ts()
    max_calls, rpm, credit_limit, reset_interval, expiration, expires_at = _validate_issue_request(req, now)

    plain_token = issue_token()
    record = {
        "id": str(uuid4()),
        "credentialType": "buyer",
        "ownerAddress": owner_wallet,
        "name": (req.name or "My Secret Key").strip(),
        "tokenHash": hash_token(plain_token),
        "tokenPrefix": token_prefix(plain_token),
        "status": "active",
        "maxCalls": max_calls,
        "callsUsed": 0,
        "rpm": rpm,
        "creditLimit": round(credit_limit, 6) if credit_limit is not None else None,
        "resetInterval": reset_interval,
        "expiration": expiration,
        "createdAt": now,
        "updatedAt": now,
        "expiresAt": expires_at,
        "revokedAt": None,
    }

    async with write_lock:
        rows, extras = load_credential_rows(storage)
        rows.append(record)
        save_credential_rows(storage, rows, extras)

    append_audit_log(
        storage,
        "CREDENTIAL_ISSUED",
        owner_wallet,
        {
            "credentialId": record["id"],
            "maxCalls": max_calls,
            "rpm": rpm,
            "creditLimit": record["creditLimit"],
            "resetInterval": record["resetInterval"],
            "expiration": record["expiration"],
            "expiresAt": expires_at,
        },
    )

    return {"status": "success", "credential": {**record, "token": plain_token}}


async def revoke_credential_for_owner(
    storage: BaseStorage,
    owner_wallet: str,
    credential_id: str,
    not_found_code: str,
    not_found_message: str = "Credential not found",
    forbidden_message: str = "Credential does not belong to current wallet",
    audit_action: str = "CREDENTIAL_REVOKED",
) -> Dict[str, Any]:
    now = now_ts()

    async with write_lock:
        rows, extras = load_credential_rows(storage)
        index = next((i for i, row in enumerate(rows) if str(row.get("id")) == credential_id), -1)
        if index < 0:
            raise HTTPException(status_code=404, detail={"code": not_found_code, "message": not_found_message})

        found = rows[index]
        if normalize_wallet(str(found.get("ownerAddress", ""))) != owner_wallet:
            raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": forbidden_message})

        found["status"] = "revoked"
        found["updatedAt"] = now
        found["revokedAt"] = now
        rows[index] = found
        save_credential_rows(storage, rows, extras)

    append_audit_log(storage, audit_action, owner_wallet, {"credentialId": credential_id})
    return {"status": "success", "credential": found}


def _update_if_present(found: Dict[str, Any], field: str, value: Any, now: int) -> None:
    if value is None:
        return

    if field in {"maxCalls", "rpm", "expiresAt", "expiration"}:
        value = int(value)
    if field == "creditLimit":
        value = round(float(value), 6)

    if field == "maxCalls" and value <= 0:
        raise HTTPException(status_code=400, detail={"code": "INVALID_MAX_CALLS", "message": "maxCalls must be positive"})
    if field == "rpm" and value <= 0:
        raise HTTPException(status_code=400, detail={"code": "INVALID_RPM", "message": "rpm must be positive"})
    if field == "expiresAt" and value <= now:
        raise HTTPException(status_code=400, detail={"code": "INVALID_EXPIRES_AT", "message": "expiresAt must be in the future"})
    if field == "creditLimit" and value <= 0:
        raise HTTPException(status_code=400, detail={"code": "INVALID_CREDIT_LIMIT", "message": "creditLimit must be positive"})
    if field == "expiration" and value <= now:
        raise HTTPException(status_code=400, detail={"code": "INVALID_EXPIRATION", "message": "expiration must be in the future"})
    if field == "resetInterval":
        value = resolve_reset_interval(value)

    found[field] = value


async def update_credential_quota_for_owner(
    storage: BaseStorage,
    owner_wallet: str,
    credential_id: str,
    req: CredentialQuotaUpdateRequest,
) -> Dict[str, Any]:
    now = now_ts()

    async with write_lock:
        rows, extras = load_credential_rows(storage)
        index = next((i for i, row in enumerate(rows) if str(row.get("id")) == credential_id), -1)
        if index < 0:
            raise HTTPException(status_code=404, detail={"code": "CREDENTIAL_NOT_FOUND", "message": "Credential not found"})

        found = rows[index]
        if normalize_wallet(str(found.get("ownerAddress", ""))) != owner_wallet:
            raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "Credential does not belong to current wallet"})

        updates = {
            "maxCalls": req.maxCalls,
            "rpm": req.rpm,
            "expiresAt": req.expiresAt,
            "creditLimit": req.creditLimit,
            "resetInterval": req.resetInterval,
            "expiration": req.expiration,
        }
        for field, value in updates.items():
            _update_if_present(found, field, value, now)

        found["updatedAt"] = now
        rows[index] = found
        save_credential_rows(storage, rows, extras)

    append_audit_log(storage, "CREDENTIAL_QUOTA_UPDATED", owner_wallet, {"credentialId": credential_id})
    return {"status": "success", "credential": found}
