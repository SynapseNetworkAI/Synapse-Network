import asyncio
from typing import Any, Dict, List
from uuid import uuid4

from fastapi import HTTPException

from src.api.schemas.pydantic_models import CredentialIssueRequest
from src.core.common import normalize_wallet
from src.domain.identity import RuntimeCredentialRecord
from src.services.platform import credential_service
from src.storage import BaseStorage
from src.utils.datetime_utils import now_dt_str, to_dt_str

provider_write_lock = asyncio.Lock()


def load_provider_secret_rows(storage: BaseStorage) -> List[RuntimeCredentialRecord]:
    return credential_service.load_runtime_credentials(storage, "provider")


def save_provider_secret_rows(
    storage: BaseStorage, rows: List[RuntimeCredentialRecord]
) -> None:
    normalized_rows = [
        row.model_copy(
            update={
                "owner": row.owner.model_copy(
                    update={
                        "owner_wallet": normalize_wallet(row.owner.owner_wallet),
                        "created_at": to_dt_str(row.owner.created_at, now_dt_str()),
                        "updated_at": to_dt_str(row.owner.updated_at, now_dt_str()),
                    }
                ),
                "agent": row.agent.model_copy(
                    update={
                        "runtime_label": "provider",
                        "created_at": to_dt_str(row.agent.created_at, now_dt_str()),
                        "updated_at": to_dt_str(row.agent.updated_at, now_dt_str()),
                    }
                ),
                "credential": row.credential.model_copy(
                    update={
                        "issued_at": to_dt_str(row.credential.issued_at, now_dt_str()),
                        "last_used_at": to_dt_str(row.credential.last_used_at, now_dt_str()),
                    }
                ),
                "policy": (
                    row.policy.model_copy(
                        update={
                            "created_at": to_dt_str(row.policy.created_at, now_dt_str()),
                            "updated_at": to_dt_str(row.policy.updated_at, now_dt_str()),
                        }
                    )
                    if row.policy is not None
                    else None
                ),
                "metadata": (
                    row.metadata.model_copy(
                        update={
                            "credential_type": "provider",
                            "owner_address": normalize_wallet(row.owner.owner_wallet),
                            "created_at": to_dt_str(row.metadata.created_at, now_dt_str()),
                            "updated_at": to_dt_str(row.metadata.updated_at, now_dt_str()),
                        }
                    )
                    if row.metadata is not None
                    else None
                ),
            }
        )
        for row in rows
    ]
    credential_service.save_runtime_credentials(storage, "provider", normalized_rows)


def list_provider_secrets_by_owner(
    storage: BaseStorage, owner_wallet: str
) -> List[Dict[str, Any]]:
    rows = load_provider_secret_rows(storage)
    result: List[Dict[str, Any]] = []
    for row in rows:
        if credential_service.credential_owner_wallet(row) != owner_wallet:
            continue
        if str(row.credential.status or "").strip().lower() == "revoked":
            continue
        if row.credential.revoked_at is not None:
            continue
        payload = credential_service._build_credential_response(row)
        result.append(
            {
                "id": payload["id"],
                "name": payload["name"],
                "ownerAddress": payload["ownerAddress"],
                "maskedKey": f"{row.credential.secret_prefix or 'agt_'}...",
                "status": payload["status"],
                "rpm": payload["rpm"],
                "creditLimit": payload["creditLimit"],
                "resetInterval": payload["resetInterval"],
                "expiration": payload["expiration"],
                "createdAt": payload["createdAt"],
                "updatedAt": payload["updatedAt"],
                "revokedAt": payload["revokedAt"],
            }
        )

    result.sort(
        key=lambda row: to_dt_str(row.get("createdAt"), "1970-01-01 00:00:00")
        or "1970-01-01 00:00:00",
        reverse=True,
    )
    return result


async def issue_provider_secret_for_owner(
    storage: BaseStorage, owner_wallet: str, req: CredentialIssueRequest
) -> Dict[str, Any]:
    now = credential_service.now_ts()
    now_str = now_dt_str()
    max_calls, rpm, credit_limit, reset_interval, expiration, expires_at = (
        credential_service._validate_issue_request(req, now)
    )

    plain_token = credential_service.issue_token()
    record = credential_service.build_runtime_credential_record(
        credential_service.CredentialRuntimeSeed(
            credential_type="provider",
            owner_wallet=owner_wallet,
            credential_id=str(uuid4()),
            display_name=(req.name or "Provider Secret Key").strip(),
            token_hash_value=credential_service.hash_token(plain_token),
            token_prefix_value=credential_service.token_prefix(plain_token),
            status="active",
            max_calls=max_calls,
            calls_used=0,
            rpm=rpm,
            credit_limit=credit_limit,
            reset_interval=reset_interval,
            expiration=expiration,
            created_at=now_str,
            updated_at=now_str,
            expires_at=expires_at,
            revoked_at=None,
        )
    )

    async with provider_write_lock:
        rows = load_provider_secret_rows(storage)
        rows.append(record)
        save_provider_secret_rows(storage, rows)

    response_payload = credential_service._build_credential_response(record)
    credential_service.append_audit_log(
        storage,
        "PROVIDER_SECRET_ISSUED",
        owner_wallet,
        {
            "secretId": record.credential.credential_id,
            "rpm": rpm,
            "creditLimit": response_payload["creditLimit"],
            "resetInterval": response_payload["resetInterval"],
            "expiration": response_payload["expiration"],
            "expiresAt": response_payload["expiresAt"],
        },
    )

    return {
        "status": "success",
        "secret": {
            "id": response_payload["id"],
            "name": response_payload["name"],
            "ownerAddress": owner_wallet,
            "secretKey": plain_token,
            "maskedKey": f"{record.credential.secret_prefix or 'agt_'}...",
            "status": response_payload["status"],
            "rpm": response_payload["rpm"],
            "creditLimit": response_payload["creditLimit"],
            "resetInterval": response_payload["resetInterval"],
            "expiration": response_payload["expiration"],
            "createdAt": response_payload["createdAt"],
        },
    }


async def revoke_provider_secret_for_owner(
    storage: BaseStorage, owner_wallet: str, secret_id: str
) -> Dict[str, Any]:
    now = credential_service.now_ts()

    async with provider_write_lock:
        rows = load_provider_secret_rows(storage)
        index = credential_service.find_runtime_credential_index(rows, secret_id)
        if index < 0:
            raise HTTPException(
                status_code=404,
                detail={"code": "SECRET_NOT_FOUND", "message": "Secret key not found"},
            )

        found = rows[index]
        if credential_service.credential_owner_wallet(found) != owner_wallet:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "FORBIDDEN",
                    "message": "Secret does not belong to current wallet",
                },
            )

        rows[index] = credential_service.clone_runtime_credential(
            found,
            status="revoked",
            updated_at=now_dt_str(),
            revoked_at=now,
        )
        save_provider_secret_rows(storage, rows)

    credential_service.append_audit_log(
        storage, "PROVIDER_SECRET_REVOKED", owner_wallet, {"secretId": secret_id}
    )
    return {"status": "success", "message": "Deleted"}