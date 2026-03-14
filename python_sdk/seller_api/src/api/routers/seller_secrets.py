from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Header

from src.models.pydantic_models import CredentialIssueRequest
from src.services import credential_service, seller_secret_service
from src.storage import BaseStorage, get_storage

router = APIRouter()

AuthorizationHeader = Annotated[Optional[str], Header(alias="Authorization")]
UserAddressHeader = Annotated[Optional[str], Header(alias="X-User-Address")]
StorageDep = Annotated[BaseStorage, Depends(get_storage)]


@router.get("/v1/secrets/seller/list")
async def list_seller_secrets(
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return {"status": "success", "secrets": seller_secret_service.list_seller_secrets_by_owner(storage, owner)}


@router.post("/v1/secrets/seller/issue")
async def issue_seller_secret(
    req: CredentialIssueRequest,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return await seller_secret_service.issue_seller_secret_for_owner(storage, owner, req)


@router.delete("/v1/secrets/seller/{secret_id}")
async def revoke_seller_secret(
    secret_id: str,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    return await seller_secret_service.revoke_seller_secret_for_owner(storage, owner, secret_id)
