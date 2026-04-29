from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Header, Query

from src.api.schemas.pydantic_models import (
    CredentialIssueRequest,
    CredentialQuotaUpdateRequest,
    CredentialUpdateRequest,
)
from src.services.platform import credential_service
from src.storage import BaseStorage, get_storage

router = APIRouter()

AuthorizationHeader = Annotated[Optional[str], Header(alias="Authorization")]
UserAddressHeader = Annotated[Optional[str], Header(alias="X-User-Address")]
StorageDep = Annotated[BaseStorage, Depends(get_storage)]
AuditLimitQuery = Annotated[int, Query(ge=1, le=500)]
ActiveOnlyQuery = Annotated[bool, Query(alias="active_only")]


def _service_response(payload: credential_service.CredentialServiceResponse):
    return payload.to_response_dict()


@router.post("/v1/credentials/agent/issue")
async def issue_agent_credential(
    req: CredentialIssueRequest,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return _service_response(await credential_service.issue_credential_for_owner(storage, owner, req))


@router.get("/v1/credentials/agent/list")
async def list_agent_credentials(
    storage: StorageDep,
    active_only: ActiveOnlyQuery = False,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    if active_only:
        creds = credential_service.list_credentials_by_owner_active(storage, owner)
    else:
        creds = credential_service.list_credentials_by_owner(storage, owner)
    return {
        "status": "success",
        "credentials": creds,
    }


@router.post("/v1/credentials/agent/{credential_id}/revoke")
async def revoke_agent_credential(
    credential_id: str,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return _service_response(
        await credential_service.revoke_credential_for_owner(
            storage, owner, credential_id, "CREDENTIAL_NOT_FOUND"
        )
    )


@router.post("/v1/credentials/agent/{credential_id}/rotate")
async def rotate_agent_credential(
    credential_id: str,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return _service_response(
        await credential_service.rotate_credential_for_owner(
            storage, owner, credential_id
        )
    )


async def _delete_agent_credential_for_owner(
    credential_id: str,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return _service_response(
        await credential_service.delete_credential_for_owner(
            storage, owner, credential_id
        )
    )


@router.delete("/v1/credentials/agent/{credential_id}")
async def delete_agent_credential(
    credential_id: str,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    return await _delete_agent_credential_for_owner(
        credential_id,
        storage,
        authorization,
        x_user_address,
    )


@router.post("/v1/credentials/agent/{credential_id}/delete")
async def delete_agent_credential_legacy(
    credential_id: str,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    return await _delete_agent_credential_for_owner(
        credential_id,
        storage,
        authorization,
        x_user_address,
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
    return _service_response(
        await credential_service.update_credential_quota_for_owner(
            storage, owner, credential_id, req
        )
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


@router.get("/v1/credentials/agent/{credential_id}/status")
async def get_agent_credential_status(
    credential_id: str,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return _service_response(
        credential_service.get_credential_status_for_owner(storage, owner, credential_id)
    )


@router.patch("/v1/credentials/agent/{credential_id}")
async def update_agent_credential(
    credential_id: str,
    req: CredentialUpdateRequest,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return _service_response(
        await credential_service.update_credential_for_owner(storage, owner, credential_id, req)
    )
