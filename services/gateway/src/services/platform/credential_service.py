import asyncio
import hashlib
import json
import os
import secrets
import time
from typing import Any, List, Optional
from uuid import uuid4

import jwt  # type: ignore[import-untyped]
from fastapi import HTTPException

from src.api.schemas.pydantic_models import (
    CredentialIssueRequest,
    CredentialQuotaUpdateRequest,
)
from src.core.common import normalize_wallet
from src.core.config import settings
from src.domain.audit import AuditLogEntry
from src.domain.identity import (
    CredentialPatch,
    RuntimeCredentialRecord,
)
from src.storage import BaseStorage
from src.utils.datetime_utils import now_dt_str, to_dt_str  # noqa: F401

from src.services.platform.credential_builders import (  # noqa: F401
    CredentialRuntimeSeed,
    build_runtime_credential_record,
    clone_runtime_credential,
    dt_str_to_epoch as _dt_str_to_epoch,
)

write_lock = asyncio.Lock()



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
        raise HTTPException(
            status_code=401,
            detail={"code": "UNAUTHORIZED", "message": "Missing bearer token"},
        )
    return auth_header.split(" ", 1)[1].strip()


def require_owner_wallet(
    authorization: Optional[str], x_user_address: Optional[str]
) -> str:
    token = parse_authorization(authorization)
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except Exception:
        raise HTTPException(
            status_code=401, detail={"code": "UNAUTHORIZED", "message": "Invalid token"}
        )

    sub = normalize_wallet(str(payload.get("sub") or ""))
    if not sub:
        raise HTTPException(
            status_code=401,
            detail={"code": "UNAUTHORIZED", "message": "Invalid token subject"},
        )

    if x_user_address:
        requested = normalize_wallet(x_user_address)
        if requested != sub:
            raise HTTPException(
                status_code=403,
                detail={"code": "FORBIDDEN", "message": "Wallet mismatch"},
            )

    return sub


def load_runtime_credentials(
    storage: BaseStorage, credential_type: str
) -> List[RuntimeCredentialRecord]:
    return storage.get_data_manager().system.credential_auth.read_credential_rows(
        credential_type
    )


def save_runtime_credentials(
    storage: BaseStorage,
    credential_type: str,
    rows: List[RuntimeCredentialRecord],
) -> None:
    storage.get_data_manager().system.credential_auth.write_credential_rows(
        credential_type, rows
    )


def load_credential_rows(storage: BaseStorage) -> List[RuntimeCredentialRecord]:
    return load_runtime_credentials(storage, "agent")


def save_credential_rows(
    storage: BaseStorage, rows: List[RuntimeCredentialRecord]
) -> None:
    save_runtime_credentials(storage, "agent", rows)


def credential_name(record: RuntimeCredentialRecord) -> str:
    if record.metadata and record.metadata.name:
        return str(record.metadata.name)
    return str(record.agent.name or "")


def credential_owner_wallet(record: RuntimeCredentialRecord) -> str:
    return normalize_wallet(str(record.owner.owner_wallet or ""))


def credential_credit_limit(record: RuntimeCredentialRecord) -> Optional[float]:
    if record.policy is None:
        return None
    return round(float(record.policy.lifetime_cap_usdc), 6)


def credential_runtime_type(record: RuntimeCredentialRecord) -> str:
    if record.agent.runtime_label:
        return str(record.agent.runtime_label)
    if record.metadata and record.metadata.credential_type:
        return str(record.metadata.credential_type)
    return ""


def find_runtime_credential_index(
    rows: List[RuntimeCredentialRecord], credential_id: str
) -> int:
    return next(
        (
            index
            for index, row in enumerate(rows)
            if str(row.credential.credential_id) == str(credential_id)
        ),
        -1,
    )


def _build_credential_response(record: RuntimeCredentialRecord) -> dict[str, Any]:
    credit_limit = credential_credit_limit(record)
    return {
        "id": record.credential.credential_id,
        "credentialType": credential_runtime_type(record),
        "ownerAddress": credential_owner_wallet(record),
        "name": credential_name(record),
        "tokenPrefix": record.credential.secret_prefix,
        "status": record.credential.status,
        "maxCalls": record.metadata.max_calls if record.metadata is not None else None,
        "callsUsed": record.metadata.calls_used if record.metadata is not None else None,
        "rpm": record.policy.rpm_limit if record.policy is not None else None,
        "creditLimit": credit_limit,
        "resetInterval": record.metadata.reset_interval if record.metadata is not None else None,
        "expiration": record.metadata.expiration if record.metadata is not None else None,
        "expiresAt": _dt_str_to_epoch(record.credential.expires_at),
        "createdAt": record.metadata.created_at if record.metadata is not None else record.credential.issued_at,
        "updatedAt": record.metadata.updated_at if record.metadata is not None else record.credential.last_used_at,
        "revokedAt": _dt_str_to_epoch(record.credential.revoked_at),
    }


def _normalize_system_audit_details(
    action: str, details: dict[str, Any]
) -> dict[str, Any]:
    normalized = dict(details)

    secret_id = normalized.get("secretId")
    credential_id = normalized.get("credentialId")

    if not isinstance(normalized.get("resourceType"), str):
        if isinstance(secret_id, str) and secret_id:
            normalized["resourceType"] = "secret"
        elif isinstance(credential_id, str) and credential_id:
            normalized["resourceType"] = "credential"

    if not isinstance(normalized.get("resourceId"), str):
        if isinstance(secret_id, str) and secret_id:
            normalized["resourceId"] = secret_id
        elif isinstance(credential_id, str) and credential_id:
            normalized["resourceId"] = credential_id

    if not isinstance(normalized.get("resultStatus"), str) and (
        action.endswith("_ISSUED")
        or action.endswith("_UPDATED")
        or action.endswith("_REVOKED")
    ):
        normalized["resultStatus"] = "success"

    return normalized


def append_audit_log(
    storage: BaseStorage, action: str, owner_wallet: str, details: dict[str, Any]
) -> None:
    normalized_details = _normalize_system_audit_details(action, details)
    storage.get_data_manager().audit.logs.append_audit_row(
        AuditLogEntry(
            id=str(uuid4()),
            timestamp=now_ts(),
            action=action,
            domain="system",
            owner_address=owner_wallet,
            details=normalized_details,
        )
    )


def read_audit_log(
    storage: BaseStorage, owner_wallet: str, limit: int
) -> List[dict[str, Any]]:
    result: List[dict[str, Any]] = []
    try:
        audit_repo = storage.get_data_manager().audit.logs
        if hasattr(audit_repo, "read_system_audit_rows"):
            rows = audit_repo.read_system_audit_rows(
                owner_wallet=owner_wallet, limit=limit
            )
        else:
            rows = audit_repo.read_audit_rows(owner_wallet=owner_wallet, limit=limit)
        result = [
            row.model_dump(by_alias=True) if isinstance(row, AuditLogEntry) else row
            for row in rows
        ]
        result.sort(key=lambda row: int(row.get("timestamp", 0)), reverse=True)
        return result[:limit]
    except Exception:
        pass

    directory = str(getattr(storage, "directory", "") or "")
    if not directory:
        return []

    path = os.path.join(directory, "system_audit_log.jsonl")
    if not os.path.exists(path):
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

    result.sort(key=lambda row: int(row.get("timestamp", 0)), reverse=True)
    return result[:limit]


def resolve_active_credential(
    storage: BaseStorage, token: str, credential_type: str = "agent"
) -> RuntimeCredentialRecord:
    rows = load_runtime_credentials(storage, credential_type)
    token_hash_value = hash_token(token)
    now = now_ts()
    found = next(
        (
            row
            for row in rows
            if str(row.credential.secret_hash or "") == token_hash_value
        ),
        None,
    )
    if found is None:
        raise HTTPException(
            status_code=401,
            detail={"code": "CREDENTIAL_INVALID", "message": "Credential is invalid"},
        )
    if str(found.credential.status or "") != "active":
        raise HTTPException(
            status_code=401,
            detail={"code": "CREDENTIAL_INACTIVE", "message": "Credential is inactive"},
        )

    expires_at = _dt_str_to_epoch(found.credential.expires_at)
    expiration = found.metadata.expiration if found.metadata is not None else None
    if (expires_at and expires_at <= now) or (expiration and int(expiration) <= now):
        raise HTTPException(
            status_code=401,
            detail={"code": "CREDENTIAL_EXPIRED", "message": "Credential has expired"},
        )

    max_calls = int(found.metadata.max_calls or 0) if found.metadata is not None else 0
    calls_used = int(found.metadata.calls_used or 0) if found.metadata is not None else 0
    if max_calls > 0 and calls_used >= max_calls:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "CREDENTIAL_MAX_CALLS_EXCEEDED",
                "message": "Credential max calls reached",
            },
        )

    return found


def list_credentials_by_owner(
    storage: BaseStorage, owner_wallet: str
) -> List[dict[str, Any]]:
    rows = load_credential_rows(storage)
    visible = [
        _build_credential_response(row)
        for row in rows
        if credential_owner_wallet(row) == owner_wallet
    ]
    visible.sort(
        key=lambda row: to_dt_str(row.get("createdAt"), "1970-01-01 00:00:00")
        or "1970-01-01 00:00:00",
        reverse=True,
    )
    return visible


def list_secrets_by_owner(
    storage: BaseStorage, owner_wallet: str
) -> List[dict[str, Any]]:
    rows = load_credential_rows(storage)
    result: List[dict[str, Any]] = []
    for row in rows:
        if credential_owner_wallet(row) != owner_wallet:
            continue
        payload = _build_credential_response(row)
        result.append(
            {
                "id": payload["id"],
                "name": payload["name"],
                "maskedKey": f"{row.credential.secret_prefix or 'agt_'}...",
                "status": payload["status"],
                "creditLimit": payload["creditLimit"],
                "resetInterval": payload["resetInterval"],
                "expiration": payload["expiration"],
                "expiresAt": payload["expiresAt"],
                "createdAt": payload["createdAt"],
            }
        )

    result.sort(
        key=lambda row: to_dt_str(row.get("createdAt"), "1970-01-01 00:00:00")
        or "1970-01-01 00:00:00",
        reverse=True,
    )
    return result


def resolve_ttl_seconds(expires_in_sec: Optional[int]) -> int:
    if expires_in_sec is None:
        return 86400 * 365 * 10

    ttl = int(expires_in_sec)
    if ttl <= 0:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_EXPIRES_IN",
                "message": "expiresInSec must be positive",
            },
        )

    return ttl


def resolve_reset_interval(value: Optional[str]) -> str:
    if not value:
        return "daily"

    normalized = value.strip().lower()
    allowed = {"hourly", "daily", "weekly", "monthly", "never"}
    if normalized not in allowed:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_RESET_INTERVAL",
                "message": "resetInterval must be one of hourly,daily,weekly,monthly,never",
            },
        )

    return normalized


# Re-export lifecycle operations so existing callers via credential_service.xxx still work.
from src.services.platform.credential_lifecycle import (  # noqa: F401
    issue_credential_for_owner,
    revoke_credential_for_owner,
    rotate_credential_for_owner,
    delete_credential_for_owner,
    update_credential_quota_for_owner,
)

