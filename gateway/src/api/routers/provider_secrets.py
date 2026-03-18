from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Header

from src.api.schemas.pydantic_models import CredentialIssueRequest
from src.services.platform import credential_service
from src.services.provider import provider_secret_service
from src.storage import BaseStorage, get_storage

router = APIRouter()

AuthorizationHeader = Annotated[Optional[str], Header(alias="Authorization")]
UserAddressHeader = Annotated[Optional[str], Header(alias="X-User-Address")]
StorageDep = Annotated[BaseStorage, Depends(get_storage)]


@router.get("/v1/secrets/provider/list")
async def list_provider_secrets(
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return {
        "status": "success",
        "secrets": provider_secret_service.list_provider_secrets_by_owner(
            storage, owner
        ),
    }


@router.post("/v1/secrets/provider/issue")
async def issue_provider_secret(
    req: CredentialIssueRequest,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return await provider_secret_service.issue_provider_secret_for_owner(
        storage, owner, req
    )


@router.delete("/v1/secrets/provider/{secret_id}")
async def revoke_provider_secret(
    secret_id: str,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return await provider_secret_service.revoke_provider_secret_for_owner(
        storage, owner, secret_id
    )
