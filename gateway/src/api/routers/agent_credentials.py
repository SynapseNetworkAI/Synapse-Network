from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Header, Query

from src.api.schemas.pydantic_models import (
    CredentialIssueRequest,
    CredentialQuotaUpdateRequest,
)
from src.services.platform import credential_service
from src.storage import BaseStorage, get_storage

router = APIRouter()

AuthorizationHeader = Annotated[Optional[str], Header(alias="Authorization")]
UserAddressHeader = Annotated[Optional[str], Header(alias="X-User-Address")]
StorageDep = Annotated[BaseStorage, Depends(get_storage)]
AuditLimitQuery = Annotated[int, Query(ge=1, le=500)]


@router.post("/v1/credentials/agent/issue")
async def issue_agent_credential(
    req: CredentialIssueRequest,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return await credential_service.issue_credential_for_owner(storage, owner, req)


@router.get("/v1/credentials/agent/list")
async def list_agent_credentials(
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return {
        "status": "success",
        "credentials": credential_service.list_credentials_by_owner(storage, owner),
    }


@router.post("/v1/credentials/agent/{credential_id}/revoke")
async def revoke_agent_credential(
    credential_id: str,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return await credential_service.revoke_credential_for_owner(
        storage, owner, credential_id, "CREDENTIAL_NOT_FOUND"
    )


@router.post("/v1/credentials/agent/{credential_id}/rotate")
async def rotate_agent_credential(
    credential_id: str,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return await credential_service.rotate_credential_for_owner(
        storage, owner, credential_id
    )


@router.patch("/v1/credentials/agent/{credential_id}/quota")
async def update_agent_credential_quota(
    credential_id: str,
    req: CredentialQuotaUpdateRequest,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return await credential_service.update_credential_quota_for_owner(
        storage, owner, credential_id, req
    )


@router.get("/v1/credentials/agent/audit-logs")
async def get_agent_audit_logs(
    storage: StorageDep,
    limit: AuditLimitQuery = 100,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return {
        "status": "success",
        "logs": credential_service.read_audit_log(storage, owner, limit),
    }
