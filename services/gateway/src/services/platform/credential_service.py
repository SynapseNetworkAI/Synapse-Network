import asyncio
import hashlib
import json
import os
import secrets
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
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
    AgentCredentialRecord,
    AgentProfileRecord,
    BudgetPolicyRecord,
    CredentialPatch,
    OwnerAccountRecord,
    RuntimeCredentialRecord,
)
from src.domain.runtime_state import CredentialMetadataState
from src.storage import BaseStorage
from src.utils.datetime_utils import now_dt_str, to_dt_str, to_epoch_seconds

write_lock = asyncio.Lock()


@dataclass(frozen=True)
class CredentialRuntimeSeed:
    credential_type: str
    owner_wallet: str
    credential_id: str
    display_name: str
    token_hash_value: str
    token_prefix_value: str
    status: str
    max_calls: int
    calls_used: int
    rpm: int
    credit_limit: Optional[float]
    reset_interval: str
    expiration: Optional[int]
    created_at: str
    updated_at: str
    expires_at: int
    revoked_at: Optional[int]


def _owner_id(wallet: str) -> str:
    return f"owner:{str(wallet or '').lower()}"


def _agent_id(credential_type: str, wallet: str) -> str:
    return f"agent:{str(credential_type or '').lower()}:{str(wallet or '').lower()}"


def _policy_id(credential_id: str) -> str:
    return f"policy:{credential_id}"


def _dt_str_to_epoch(value: Optional[str]) -> int:
    return to_epoch_seconds(value, default=0)


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


def _metadata_state(record: RuntimeCredentialRecord) -> CredentialMetadataState:
    if record.metadata is not None:
        return record.metadata
    return CredentialMetadataState(
        credential_type=credential_runtime_type(record),
        owner_address=credential_owner_wallet(record),
        name=credential_name(record),
        max_calls=0,
        calls_used=0,
        reset_interval="daily",
        expiration=None,
        created_at=record.credential.issued_at,
        updated_at=record.credential.last_used_at,
    )


def _policy_state(record: RuntimeCredentialRecord) -> BudgetPolicyRecord:
    if record.policy is not None:
        return record.policy
    credential_id = str(record.credential.credential_id)
    return BudgetPolicyRecord(
        policy_id=_policy_id(credential_id),
        credential_id=credential_id,
        lifetime_cap_usdc=Decimal("0"),
        daily_cap_usdc=Decimal("0"),
        per_invocation_cap_usdc=Decimal("0"),
        rpm_limit=0,
        qps_limit=0,
        allowed_service_tags=[],
        allowed_service_ids=[],
        blocked_service_ids=[],
        created_at=record.credential.issued_at,
        updated_at=record.credential.last_used_at,
    )


def build_runtime_credential_record(seed: CredentialRuntimeSeed) -> RuntimeCredentialRecord:
    normalized_type = str(seed.credential_type or "").lower()
    normalized_owner = normalize_wallet(seed.owner_wallet)
    owner_id = _owner_id(normalized_owner)
    agent_id = _agent_id(normalized_type, normalized_owner)
    credit_limit_decimal = (
        Decimal(str(round(seed.credit_limit, 6)))
        if seed.credit_limit is not None
        else Decimal("0")
    )

    return RuntimeCredentialRecord(
        owner=OwnerAccountRecord(
            owner_id=owner_id,
            owner_wallet=normalized_owner,
            status="active",
            default_currency="USDC",
            created_at=seed.created_at,
            updated_at=seed.updated_at,
        ),
        agent=AgentProfileRecord(
            agent_id=agent_id,
            owner_id=owner_id,
            name=f"{normalized_type}-runtime",
            purpose=f"{normalized_type} runtime credential holder",
            status="active",
            runtime_label=normalized_type,
            created_at=seed.created_at,
            updated_at=seed.updated_at,
        ),
        credential=AgentCredentialRecord(
            credential_id=seed.credential_id,
            agent_id=agent_id,
            secret_hash=seed.token_hash_value,
            secret_prefix=seed.token_prefix_value,
            status=seed.status,
            issued_at=seed.created_at,
            expires_at=to_dt_str(seed.expires_at),
            revoked_at=str(seed.revoked_at) if seed.revoked_at is not None else None,
            last_used_at=seed.updated_at,
        ),
        policy=BudgetPolicyRecord(
            policy_id=_policy_id(seed.credential_id),
            credential_id=seed.credential_id,
            lifetime_cap_usdc=credit_limit_decimal,
            daily_cap_usdc=credit_limit_decimal,
            per_invocation_cap_usdc=credit_limit_decimal,
            rpm_limit=seed.rpm,
            qps_limit=max(0, seed.rpm),
            allowed_service_tags=[],
            allowed_service_ids=[],
            blocked_service_ids=[],
            created_at=seed.created_at,
            updated_at=seed.updated_at,
        ),
        metadata=CredentialMetadataState(
            credential_type=normalized_type,
            owner_address=normalized_owner,
            name=seed.display_name,
            max_calls=seed.max_calls,
            calls_used=seed.calls_used,
            reset_interval=seed.reset_interval,
            expiration=seed.expiration,
            created_at=seed.created_at,
            updated_at=seed.updated_at,
        ),
    )


def clone_runtime_credential(
    record: RuntimeCredentialRecord,
    patch: CredentialPatch,
) -> RuntimeCredentialRecord:
    metadata = _metadata_state(record)
    policy = _policy_state(record)
    effective_updated_at = to_dt_str(patch.updated_at, now_dt_str())
    effective_calls_used = patch.calls_used if patch.calls_used is not None else int(metadata.calls_used or 0)
    effective_max_calls = patch.max_calls if patch.max_calls is not None else int(metadata.max_calls or 0)
    effective_reset_interval = patch.reset_interval if patch.reset_interval is not None else str(metadata.reset_interval or "daily")
    effective_expiration = patch.expiration if patch.expiration is not None else metadata.expiration
    effective_credit_limit = (
        Decimal(str(round(patch.credit_limit, 6))) if patch.credit_limit is not None else policy.lifetime_cap_usdc
    )
    effective_rpm = patch.rpm if patch.rpm is not None else policy.rpm_limit
    effective_expires_at = patch.expires_at if patch.expires_at is not None else _dt_str_to_epoch(record.credential.expires_at)

    return record.model_copy(
        update={
            "owner": record.owner.model_copy(update={"updated_at": effective_updated_at}),
            "agent": record.agent.model_copy(update={"updated_at": effective_updated_at}),
            "credential": record.credential.model_copy(
                update={
                    "secret_hash": patch.secret_hash or record.credential.secret_hash,
                    "secret_prefix": patch.secret_prefix or record.credential.secret_prefix,
                    "status": patch.status or record.credential.status,
                    "issued_at": patch.issued_at or record.credential.issued_at,
                    "expires_at": to_dt_str(effective_expires_at),
                    "revoked_at": None
                    if patch.clear_revoked_at
                    else (str(patch.revoked_at) if patch.revoked_at is not None else record.credential.revoked_at),
                    "last_used_at": effective_updated_at,
                }
            ),
            "policy": policy.model_copy(
                update={
                    "lifetime_cap_usdc": effective_credit_limit,
                    "daily_cap_usdc": effective_credit_limit,
                    "per_invocation_cap_usdc": effective_credit_limit,
                    "rpm_limit": int(effective_rpm),
                    "qps_limit": max(0, int(effective_rpm)),
                    "updated_at": effective_updated_at,
                }
            ),
            "metadata": metadata.model_copy(
                update={
                    "calls_used": effective_calls_used,
                    "max_calls": effective_max_calls,
                    "reset_interval": effective_reset_interval,
                    "expiration": effective_expiration,
                    "updated_at": effective_updated_at,
                }
            ),
        }
    )


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


def _build_credential_response(record: RuntimeCredentialRecord) -> Dict[str, Any]:
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
    action: str, details: Dict[str, Any]
) -> Dict[str, Any]:
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
    storage: BaseStorage, action: str, owner_wallet: str, details: Dict[str, Any]
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
) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
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
) -> List[Dict[str, Any]]:
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
) -> List[Dict[str, Any]]:
    rows = load_credential_rows(storage)
    result: List[Dict[str, Any]] = []
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

