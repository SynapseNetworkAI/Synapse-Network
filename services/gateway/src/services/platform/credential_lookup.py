from __future__ import annotations

from typing import Optional

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.domain.identity import RuntimeCredentialRecord
from src.services.platform import credential_service


def resolve_active_credential_by_id(
    storage,
    credential_id: str,
    owner_wallet: Optional[str] = None,
    credential_type: str = "agent",
) -> RuntimeCredentialRecord:
    rows = credential_service.load_runtime_credentials(storage, credential_type)
    normalized_owner = normalize_wallet(owner_wallet or "")
    found = next(
        (
            row
            for row in rows
            if str(row.credential.credential_id or "") == str(credential_id or "")
        ),
        None,
    )
    if found is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "CREDENTIAL_NOT_FOUND", "message": "Credential not found"},
        )
    if normalized_owner and credential_service.credential_owner_wallet(found) != normalized_owner:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "CREDENTIAL_FORBIDDEN",
                "message": "Credential does not belong to this owner",
            },
        )
    if str(found.credential.status or "") != "active":
        raise HTTPException(
            status_code=401,
            detail={"code": "CREDENTIAL_INACTIVE", "message": "Credential is inactive"},
        )

    now = credential_service.now_ts()
    expires_at = credential_service._dt_str_to_epoch(found.credential.expires_at)
    expiration = found.metadata.expiration if found.metadata is not None else None
    if (expires_at and expires_at <= now) or (expiration and int(expiration) <= now):
        raise HTTPException(
            status_code=401,
            detail={"code": "CREDENTIAL_EXPIRED", "message": "Credential has expired"},
        )
    return found
