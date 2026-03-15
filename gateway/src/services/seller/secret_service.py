import asyncio
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.models.pydantic_models import CredentialIssueRequest
from src.domain.storage_entities import CredentialRow
from src.services.platform import credential_service
from src.storage import BaseStorage
from src.utils.datetime_utils import now_dt_str, to_dt_str

seller_write_lock = asyncio.Lock()
_SELLER_SECRETS_COLLECTION = "seller_secrets"
_LEGACY_SELLER_COLLECTIONS = ("provider_secrets", "credentials")


def _row_as_dict(row: Any) -> Dict[str, Any]:
    if isinstance(row, dict):
        return dict(row)
    if hasattr(row, "model_dump"):
        return row.model_dump(by_alias=True, mode="json")
    return {}


def _normalize_secret_rows(raw: Any) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    rows, extras = credential_service.normalize_credential_rows(raw)
    for row in rows:
        row["credentialType"] = "seller"
    return rows, extras


def save_seller_secret_rows(storage: BaseStorage, rows: List[Dict[str, Any]], extras: Optional[Dict[str, Any]] = None) -> None:
    for row in rows:
        row["credentialType"] = "seller"
        row["createdAt"] = to_dt_str(row.get("createdAt"), now_dt_str())
        row["updatedAt"] = to_dt_str(row.get("updatedAt"), now_dt_str())
    payload: Dict[str, Any] = {"credentials": rows, "updatedAt": credential_service.now_ts()}
    if extras:
        payload.update(extras)
    _ = payload
    typed_rows = [CredentialRow.model_validate(row) for row in rows if isinstance(row, dict)]
    storage.get_data_manager().system.credential_auth.write_credential_rows("seller", typed_rows)


def load_seller_secret_rows(storage: BaseStorage) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    primary_entities = storage.get_data_manager().system.credential_auth.read_credential_rows("seller")
    primary_rows = [_row_as_dict(row) for row in primary_entities]
    primary_rows = [row for row in primary_rows if row]
    primary = {"credentials": primary_rows, "updatedAt": 0}
    rows, extras = _normalize_secret_rows(primary)
    if rows or extras:
        return rows, extras

    for legacy_collection in _LEGACY_SELLER_COLLECTIONS:
        _ = legacy_collection
        legacy_entities = storage.get_data_manager().system.credential_auth.read_credential_rows("seller")
        legacy_rows_raw = [_row_as_dict(row) for row in legacy_entities]
        legacy_rows_raw = [row for row in legacy_rows_raw if row]
        legacy = {"credentials": legacy_rows_raw, "updatedAt": 0}
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
        status = str(row.get("status") or "").strip().lower()
        # Revoked keys are logically deleted and should not be listed as active secrets.
        if status == "revoked" or row.get("revokedAt") is not None:
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

    result.sort(key=lambda x: to_dt_str(x.get("createdAt"), "1970-01-01 00:00:00") or "1970-01-01 00:00:00", reverse=True)
    return result


async def issue_seller_secret_for_owner(storage: BaseStorage, owner_wallet: str, req: CredentialIssueRequest) -> Dict[str, Any]:
    now_ts = credential_service.now_ts()
    now = now_dt_str()
    max_calls, rpm, credit_limit, reset_interval, expiration, expires_at = credential_service._validate_issue_request(req, now_ts)

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
        found["updatedAt"] = now_dt_str()
        found["revokedAt"] = now
        rows[index] = found
        save_seller_secret_rows(storage, rows, extras)

    credential_service.append_audit_log(storage, "SELLER_SECRET_REVOKED", owner_wallet, {"secretId": secret_id})
    return {"status": "success", "message": "Deleted"}
