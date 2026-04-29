import asyncio
from typing import Any, List
from uuid import uuid4

from fastapi import HTTPException

from src.api.schemas.pydantic_models import CredentialIssueRequest
from src.domain.identity import RuntimeCredentialRecord
from src.services.platform import credential_lifecycle, credential_service
from src.storage import BaseStorage
from src.utils.datetime_utils import now_dt_str, to_dt_str

provider_write_lock = asyncio.Lock()


def load_provider_secret_rows(storage: BaseStorage) -> List[RuntimeCredentialRecord]:
    return credential_service.load_runtime_credentials(storage, "provider")


def list_provider_secrets_by_owner(
    storage: BaseStorage, owner_wallet: str
) -> List[dict[str, Any]]:
    rows = load_provider_secret_rows(storage)
    result: List[dict[str, Any]] = []
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
) -> credential_service.CredentialServiceResponse:
    now = credential_service.now_ts()
    now_str = now_dt_str()
    max_calls, rpm, credit_limit, reset_interval, expiration, expires_at = (
        credential_lifecycle._validate_issue_request(req, now)
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
        storage.get_data_manager().system.credential_auth.create_runtime_credential(record)

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

    return credential_service.CredentialServiceResponse(
        {
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
    )


async def revoke_provider_secret_for_owner(
    storage: BaseStorage, owner_wallet: str, secret_id: str
) -> credential_service.CredentialServiceResponse:
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

        if not storage.get_data_manager().system.credential_auth.revoke_runtime_credential(
            secret_id,
            owner_wallet,
            now,
        ):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "SECRET_UPDATE_CONFLICT",
                    "message": "Secret changed concurrently; refresh and retry.",
                },
            )

    credential_service.append_audit_log(
        storage, "PROVIDER_SECRET_REVOKED", owner_wallet, {"secretId": secret_id}
    )
    return credential_service.CredentialServiceResponse(
        {"status": "success", "message": "Deleted"}
    )
