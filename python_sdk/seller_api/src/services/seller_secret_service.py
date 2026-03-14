import asyncio
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.models.pydantic_models import CredentialIssueRequest
from src.services import credential_service
from src.storage import BaseStorage

seller_write_lock = asyncio.Lock()
_SELLER_SECRETS_COLLECTION = "seller_secrets"
_LEGACY_SELLER_COLLECTIONS = ("provider_secrets", "credentials")


def _normalize_secret_rows(raw: Any) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    rows, extras = credential_service.normalize_credential_rows(raw)
    for row in rows:
        row["credentialType"] = "seller"
    return rows, extras


def save_seller_secret_rows(storage: BaseStorage, rows: List[Dict[str, Any]], extras: Optional[Dict[str, Any]] = None) -> None:
    for row in rows:
        row["credentialType"] = "seller"
    payload: Dict[str, Any] = {"credentials": rows, "updatedAt": credential_service.now_ts()}
    if extras:
        payload.update(extras)
    storage.save_collection(_SELLER_SECRETS_COLLECTION, payload)


def load_seller_secret_rows(storage: BaseStorage) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    primary = storage.get_collection(_SELLER_SECRETS_COLLECTION)
    rows, extras = _normalize_secret_rows(primary)
    if rows or extras:
        return rows, extras

    for legacy_collection in _LEGACY_SELLER_COLLECTIONS:
        legacy = storage.get_collection(legacy_collection)
        legacy_rows, legacy_extras = _normalize_secret_rows(legacy)
        if legacy_rows or legacy_extras:
            save_seller_secret_rows(storage, legacy_rows, legacy_extras)
            return legacy_rows, legacy_extras

    return [], {}


def list_seller_secrets_by_owner(storage: BaseStorage, owner_wallet: str) -> List[Dict[str, Any]]:
    rows, _ = load_seller_secret_rows(storage)
    result: List[Dict[str, Any]] = []
    for row in rows:
        if normalize_wallet(str(row.get("ownerAddress", ""))) != owner_wallet:
            continue
        result.append(
            {
                "id": row.get("id"),
                "name": row.get("name"),
                "ownerAddress": row.get("ownerAddress"),
                "maskedKey": f"{row.get('tokenPrefix', 'agt_')}...",
                "status": row.get("status"),
                "rpm": row.get("rpm"),
                "creditLimit": row.get("creditLimit"),
                "resetInterval": row.get("resetInterval"),
                "expiration": row.get("expiration"),
                "createdAt": row.get("createdAt"),
                "updatedAt": row.get("updatedAt"),
                "revokedAt": row.get("revokedAt"),
            }
        )

    result.sort(key=lambda x: int(x.get("createdAt") or 0), reverse=True)
    return result


async def issue_seller_secret_for_owner(storage: BaseStorage, owner_wallet: str, req: CredentialIssueRequest) -> Dict[str, Any]:
    now = credential_service.now_ts()
    max_calls, rpm, credit_limit, reset_interval, expiration, expires_at = credential_service._validate_issue_request(req, now)

    plain_token = credential_service.issue_token()
    record = {
        "id": str(uuid4()),
        "credentialType": "seller",
        "ownerAddress": owner_wallet,
        "name": (req.name or "Provider Secret Key").strip(),
        "tokenHash": credential_service.hash_token(plain_token),
        "tokenPrefix": credential_service.token_prefix(plain_token),
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

    async with seller_write_lock:
        rows, extras = load_seller_secret_rows(storage)
        rows.append(record)
        save_seller_secret_rows(storage, rows, extras)

    credential_service.append_audit_log(
        storage,
        "SELLER_SECRET_ISSUED",
        owner_wallet,
        {
            "secretId": record["id"],
            "rpm": rpm,
            "creditLimit": record["creditLimit"],
            "resetInterval": record["resetInterval"],
            "expiration": record["expiration"],
            "expiresAt": expires_at,
        },
    )

    return {
        "status": "success",
        "secret": {
            "id": record["id"],
            "name": record["name"],
            "ownerAddress": owner_wallet,
            "secretKey": plain_token,
            "maskedKey": f"{record.get('tokenPrefix', 'agt_')}...",
            "status": record["status"],
            "rpm": record["rpm"],
            "creditLimit": record["creditLimit"],
            "resetInterval": record["resetInterval"],
            "expiration": record["expiration"],
            "createdAt": record["createdAt"],
        },
    }


async def revoke_seller_secret_for_owner(storage: BaseStorage, owner_wallet: str, secret_id: str) -> Dict[str, Any]:
    now = credential_service.now_ts()

    async with seller_write_lock:
        rows, extras = load_seller_secret_rows(storage)
        index = next((i for i, row in enumerate(rows) if str(row.get("id")) == secret_id), -1)
        if index < 0:
            raise HTTPException(status_code=404, detail={"code": "SECRET_NOT_FOUND", "message": "Secret key not found"})

        found = rows[index]
        if normalize_wallet(str(found.get("ownerAddress", ""))) != owner_wallet:
            raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "Secret does not belong to current wallet"})

        found["status"] = "revoked"
        found["updatedAt"] = now
        found["revokedAt"] = now
        rows[index] = found
        save_seller_secret_rows(storage, rows, extras)

    credential_service.append_audit_log(storage, "SELLER_SECRET_REVOKED", owner_wallet, {"secretId": secret_id})
    return {"status": "success", "message": "Deleted"}
