from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Header, Query

from src.models.pydantic_models import CredentialIssueRequest, CredentialQuotaUpdateRequest
from src.services import credential_service
from src.storage import BaseStorage, get_storage

router = APIRouter()

AuthorizationHeader = Annotated[Optional[str], Header(alias="Authorization")]
UserAddressHeader = Annotated[Optional[str], Header(alias="X-User-Address")]
StorageDep = Annotated[BaseStorage, Depends(get_storage)]
AuditLimitQuery = Annotated[int, Query(ge=1, le=500)]


@router.get("/v2/secrets")
async def get_secrets(
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return {"status": "success", "secrets": credential_service.list_secrets_by_owner(storage, owner)}


@router.post("/v2/secrets")
async def create_secret(
    req: CredentialIssueRequest,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    created = await credential_service.issue_credential_for_owner(storage, owner, req)
    return {"status": "success", "secret": created.get("credential"), "ownerAddress": owner}


@router.delete("/v2/secrets/{secret_id}")
async def delete_secret(
    secret_id: str,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    await credential_service.revoke_credential_for_owner(
        storage,
        owner,
        secret_id,
        "SECRET_NOT_FOUND",
        not_found_message="Secret key not found",
        forbidden_message="Secret does not belong to current wallet",
        audit_action="SECRET_REVOKED",
    )
    return {"status": "success", "message": "Deleted"}


@router.post("/v1/credentials/issue")
async def issue_credential(
    req: CredentialIssueRequest,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return await credential_service.issue_credential_for_owner(storage, owner, req)


@router.get("/v1/credentials")
async def list_credentials(
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return {"status": "success", "credentials": credential_service.list_credentials_by_owner(storage, owner)}


@router.post("/v1/credentials/{credential_id}/revoke")
async def revoke_credential(
    credential_id: str,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return await credential_service.revoke_credential_for_owner(storage, owner, credential_id, "CREDENTIAL_NOT_FOUND")


@router.patch("/v1/credentials/{credential_id}/quota")
async def update_credential_quota(
    credential_id: str,
    req: CredentialQuotaUpdateRequest,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return await credential_service.update_credential_quota_for_owner(storage, owner, credential_id, req)


@router.get("/v1/audit-logs")
async def get_audit_logs(
    storage: StorageDep,
    limit: AuditLimitQuery = 100,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return {"status": "success", "logs": credential_service.read_audit_log(storage, owner, limit)}
