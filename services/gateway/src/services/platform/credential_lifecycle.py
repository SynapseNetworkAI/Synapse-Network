"""Credential lifecycle: issue, revoke, rotate, delete, and update quota."""
from __future__ import annotations

from typing import Any, Optional
from uuid import uuid4

from fastapi import HTTPException

from src.api.schemas.pydantic_models import (
    CredentialIssueRequest,
    CredentialQuotaUpdateRequest,
    CredentialUpdateRequest,
)
from src.domain.identity import CredentialPatch, RuntimeCredentialRecord
from src.services.platform.credential_service import (
    CredentialServiceResponse,
    CredentialRuntimeSeed,
    _build_credential_response,
    append_audit_log,
    build_runtime_credential_record,
    clone_runtime_credential,
    credential_owner_wallet,
    find_runtime_credential_index,
    hash_token,
    issue_token,
    load_credential_rows,
    now_dt_str,
    now_ts,
    resolve_reset_interval,
    resolve_ttl_seconds,
    token_prefix,
    write_lock,
)
from src.storage import BaseStorage

MAX_AGENT_CREDENTIALS_PER_OWNER = 5


def _owner_agent_credential_count(
    rows: list[RuntimeCredentialRecord], owner_wallet: str
) -> int:
    return sum(
        1
        for row in rows
        if credential_owner_wallet(row) == owner_wallet
        and str(row.credential.status or "") == "active"
    )


def _validate_issue_request(
    req: CredentialIssueRequest, now: int
) -> tuple[int, int, Optional[float], str, Optional[int], int]:
    expires_at = now + resolve_ttl_seconds(req.expiresInSec)
    max_calls = int(req.maxCalls or 1000000)
    rpm = int(req.rpm or 600)
    credit_limit = float(req.creditLimit) if req.creditLimit is not None else None
    reset_interval = resolve_reset_interval(req.resetInterval)
    expiration = int(req.expiration) if req.expiration else None

    if max_calls <= 0:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_MAX_CALLS",
                "message": "maxCalls must be positive",
            },
        )
    if rpm <= 0:
        raise HTTPException(
            status_code=400,
            detail={"code": "INVALID_RPM", "message": "rpm must be positive"},
        )
    if credit_limit is not None and credit_limit <= 0:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_CREDIT_LIMIT",
                "message": "creditLimit must be positive",
            },
        )
    if expiration is not None and expiration <= now:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_EXPIRATION",
                "message": "expiration must be in the future",
            },
        )

    return max_calls, rpm, credit_limit, reset_interval, expiration, expires_at


def _raise_write_conflict() -> None:
    raise HTTPException(
        status_code=409,
        detail={
            "code": "CREDENTIAL_UPDATE_CONFLICT",
            "message": "Credential changed concurrently; refresh and retry.",
        },
    )


async def issue_credential_for_owner(
    storage: BaseStorage, owner_wallet: str, req: CredentialIssueRequest
) -> CredentialServiceResponse:
    now = now_ts()
    now_str = now_dt_str()
    max_calls, rpm, credit_limit, reset_interval, expiration, expires_at = (
        _validate_issue_request(req, now)
    )

    plain_token = issue_token()
    record = build_runtime_credential_record(
        CredentialRuntimeSeed(
            credential_type="agent",
            owner_wallet=owner_wallet,
            credential_id=str(uuid4()),
            display_name=(req.name or "My Secret Key").strip(),
            token_hash_value=hash_token(plain_token),
            token_prefix_value=token_prefix(plain_token),
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

    async with write_lock:
        rows = load_credential_rows(storage)
        if (
            _owner_agent_credential_count(rows, owner_wallet)
            >= MAX_AGENT_CREDENTIALS_PER_OWNER
        ):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "AGENT_CREDENTIAL_LIMIT_REACHED",
                    "message": (
                        f"Owner can create up to {MAX_AGENT_CREDENTIALS_PER_OWNER} "
                        "agent credentials"
                    ),
                },
            )
        storage.get_data_manager().system.credential_auth.create_runtime_credential(record)

    response_payload = _build_credential_response(record)
    append_audit_log(
        storage,
        "CREDENTIAL_ISSUED",
        owner_wallet,
        {
            "credentialId": record.credential.credential_id,
            "maxCalls": max_calls,
            "rpm": rpm,
            "creditLimit": response_payload["creditLimit"],
            "resetInterval": response_payload["resetInterval"],
            "expiration": response_payload["expiration"],
            "expiresAt": response_payload["expiresAt"],
        },
    )

    return CredentialServiceResponse(
        {
            "status": "success",
            "credential": {**response_payload, "token": plain_token},
        }
    )


async def revoke_credential_for_owner(
    storage: BaseStorage,
    owner_wallet: str,
    credential_id: str,
    not_found_code: str,
    not_found_message: str = "Credential not found",
    forbidden_message: str = "Credential does not belong to current wallet",
    audit_action: str = "CREDENTIAL_REVOKED",
) -> CredentialServiceResponse:
    now = now_ts()

    async with write_lock:
        rows = load_credential_rows(storage)
        index = find_runtime_credential_index(rows, credential_id)
        if index < 0:
            raise HTTPException(
                status_code=404,
                detail={"code": not_found_code, "message": not_found_message},
            )

        found = rows[index]
        if credential_owner_wallet(found) != owner_wallet:
            raise HTTPException(
                status_code=403,
                detail={"code": "FORBIDDEN", "message": forbidden_message},
            )

        updated = clone_runtime_credential(
            found,
            CredentialPatch(status="revoked", updated_at=now_dt_str(), revoked_at=now),
        )
        if not storage.get_data_manager().system.credential_auth.revoke_runtime_credential(
            credential_id,
            owner_wallet,
            now,
        ):
            _raise_write_conflict()

    append_audit_log(
        storage, audit_action, owner_wallet, {"credentialId": credential_id}
    )
    return CredentialServiceResponse(
        {"status": "success", "credential": _build_credential_response(updated)}
    )


async def rotate_credential_for_owner(
    storage: BaseStorage,
    owner_wallet: str,
    credential_id: str,
    audit_action: str = "CREDENTIAL_REGENERATED",
) -> CredentialServiceResponse:
    now = now_ts()
    now_str = now_dt_str()
    plain_token = issue_token()
    new_secret_hash = hash_token(plain_token)
    new_secret_prefix = token_prefix(plain_token)

    async with write_lock:
        rows = load_credential_rows(storage)
        index = find_runtime_credential_index(rows, credential_id)
        if index < 0:
            raise HTTPException(
                status_code=404,
                detail={
                    "code": "CREDENTIAL_NOT_FOUND",
                    "message": "Credential not found",
                },
            )

        found = rows[index]
        if credential_owner_wallet(found) != owner_wallet:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "FORBIDDEN",
                    "message": "Credential does not belong to current wallet",
                },
            )

        updated = clone_runtime_credential(
            found,
            CredentialPatch(
                secret_hash=new_secret_hash,
                secret_prefix=new_secret_prefix,
                status="active",
                issued_at=now_str,
                updated_at=now_str,
                clear_revoked_at=True,
            ),
        )
        if not storage.get_data_manager().system.credential_auth.rotate_runtime_credential(
            credential_id,
            owner_wallet,
            new_secret_hash,
            new_secret_prefix,
            now,
        ):
            _raise_write_conflict()

    response_payload = _build_credential_response(updated)
    append_audit_log(
        storage,
        audit_action,
        owner_wallet,
        {
            "credentialId": credential_id,
            "previousStatus": found.credential.status,
            "status": updated.credential.status,
            "expiresAt": response_payload["expiresAt"],
        },
    )
    return CredentialServiceResponse(
        {
            "status": "success",
            "credential": {**response_payload, "token": plain_token},
        }
    )


async def delete_credential_for_owner(
    storage: BaseStorage,
    owner_wallet: str,
    credential_id: str,
    audit_action: str = "CREDENTIAL_DELETED",
) -> CredentialServiceResponse:
    now = now_ts()

    async with write_lock:
        rows = load_credential_rows(storage)
        index = find_runtime_credential_index(rows, credential_id)
        if index < 0:
            raise HTTPException(
                status_code=404,
                detail={
                    "code": "CREDENTIAL_NOT_FOUND",
                    "message": "Credential not found",
                },
            )

        found = rows[index]
        if credential_owner_wallet(found) != owner_wallet:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "FORBIDDEN",
                    "message": "Credential does not belong to current wallet",
                },
            )

        # Runtime credentials can be referenced by quotes, invocations, and audit rows.
        # Deleting those rows breaks finance history and can violate FK constraints, so
        # "delete from workspace" is implemented as a terminal revoke with delete audit.
        updated = clone_runtime_credential(
            found,
            CredentialPatch(status="revoked", updated_at=now_dt_str(), revoked_at=now),
        )
        if not storage.get_data_manager().system.credential_auth.revoke_runtime_credential(
            credential_id,
            owner_wallet,
            now,
        ):
            _raise_write_conflict()
        deleted_payload = _build_credential_response(updated)

    append_audit_log(
        storage,
        audit_action,
        owner_wallet,
        {
            "credentialId": credential_id,
            "name": deleted_payload["name"],
            "status": deleted_payload["status"],
            "tokenPrefix": deleted_payload["tokenPrefix"],
        },
    )
    return CredentialServiceResponse({"status": "success", "credential": deleted_payload})


def _update_if_present(
    record: RuntimeCredentialRecord,
    field: str,
    value: Any,
    now: int,
) -> RuntimeCredentialRecord:
    if value is None:
        return record

    if field == "resetInterval":
        normalized_value = resolve_reset_interval(value)
        return clone_runtime_credential(
            record,
            CredentialPatch(reset_interval=normalized_value, updated_at=now_dt_str()),
        )

    if field in {"maxCalls", "rpm", "expiresAt", "expiration"}:
        value = int(value)
    if field == "creditLimit":
        value = round(float(value), 6)

    error_map = {
        "maxCalls": (value <= 0, "INVALID_MAX_CALLS", "maxCalls must be positive"),
        "rpm": (value <= 0, "INVALID_RPM", "rpm must be positive"),
        "expiresAt": (value <= now, "INVALID_EXPIRES_AT", "expiresAt must be in the future"),
        "creditLimit": (value <= 0, "INVALID_CREDIT_LIMIT", "creditLimit must be positive"),
        "expiration": (value <= now, "INVALID_EXPIRATION", "expiration must be in the future"),
    }
    if field in error_map:
        should_raise, code, message = error_map[field]
        if should_raise:
            raise HTTPException(status_code=400, detail={"code": code, "message": message})

    field_to_kwarg: dict[str, str] = {
        "maxCalls": "max_calls",
        "rpm": "rpm",
        "expiresAt": "expires_at",
        "creditLimit": "credit_limit",
        "expiration": "expiration",
    }
    return clone_runtime_credential(record, CredentialPatch(updated_at=now_dt_str(), **{field_to_kwarg[field]: value}))


async def update_credential_quota_for_owner(
    storage: BaseStorage,
    owner_wallet: str,
    credential_id: str,
    req: CredentialQuotaUpdateRequest,
) -> CredentialServiceResponse:
    now = now_ts()

    async with write_lock:
        rows = load_credential_rows(storage)
        index = find_runtime_credential_index(rows, credential_id)
        if index < 0:
            raise HTTPException(
                status_code=404,
                detail={
                    "code": "CREDENTIAL_NOT_FOUND",
                    "message": "Credential not found",
                },
            )

        found = rows[index]
        if credential_owner_wallet(found) != owner_wallet:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "FORBIDDEN",
                    "message": "Credential does not belong to current wallet",
                },
            )

        updated = found
        for field, value in {
            "maxCalls": req.maxCalls,
            "rpm": req.rpm,
            "expiresAt": req.expiresAt,
            "creditLimit": req.creditLimit,
            "resetInterval": req.resetInterval,
            "expiration": req.expiration,
        }.items():
            updated = _update_if_present(updated, field, value, now)

        storage.get_data_manager().system.credential_auth.update_runtime_credential_policy(
            updated
        )

    append_audit_log(
        storage,
        "CREDENTIAL_QUOTA_UPDATED",
        owner_wallet,
        {"credentialId": credential_id},
    )
    return CredentialServiceResponse(
        {"status": "success", "credential": _build_credential_response(updated)}
    )


async def update_credential_for_owner(
    storage: BaseStorage,
    owner_wallet: str,
    credential_id: str,
    req: CredentialUpdateRequest,
) -> CredentialServiceResponse:
    """Full credential update: name + all quota fields."""
    now = now_ts()

    async with write_lock:
        rows = load_credential_rows(storage)
        index = find_runtime_credential_index(rows, credential_id)
        if index < 0:
            raise HTTPException(
                status_code=404,
                detail={"code": "CREDENTIAL_NOT_FOUND", "message": "Credential not found"},
            )

        found = rows[index]
        if credential_owner_wallet(found) != owner_wallet:
            raise HTTPException(
                status_code=403,
                detail={"code": "FORBIDDEN", "message": "Credential does not belong to current wallet"},
            )

        # Build quota patch using existing helper
        quota_req = CredentialQuotaUpdateRequest(
            maxCalls=req.maxCalls,
            rpm=req.rpm,
            expiresAt=req.expiresAt,
            creditLimit=req.creditLimit,
            resetInterval=req.resetInterval,
            expiration=req.expiration,
        )
        updated = found
        for field, value in {
            "maxCalls": quota_req.maxCalls,
            "rpm": quota_req.rpm,
            "expiresAt": quota_req.expiresAt,
            "creditLimit": quota_req.creditLimit,
            "resetInterval": quota_req.resetInterval,
            "expiration": quota_req.expiration,
        }.items():
            updated = _update_if_present(updated, field, value, now)

        # Apply name update on top of quota changes
        if req.name is not None:
            name_stripped = req.name.strip()
            if name_stripped:
                updated = updated.model_copy(
                    update={
                        "agent": updated.agent.model_copy(update={"name": name_stripped}),
                        "metadata": updated.metadata.model_copy(update={"name": name_stripped})
                        if updated.metadata is not None
                        else updated.metadata,
                    }
                )

        storage.get_data_manager().system.credential_auth.update_runtime_credential_policy(
            updated
        )
        storage.get_data_manager().system.credential_auth.update_runtime_credential_metadata(
            updated
        )

    append_audit_log(
        storage,
        "CREDENTIAL_UPDATED",
        owner_wallet,
        {"credentialId": credential_id},
    )
    return CredentialServiceResponse(
        {"status": "success", "credential": _build_credential_response(updated)}
    )
