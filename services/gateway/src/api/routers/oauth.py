from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel, ConfigDict, Field

from src.services.platform import credential_service, oauth_service
from src.storage import BaseStorage, get_storage

router = APIRouter()

AuthorizationHeader = Annotated[Optional[str], Header(alias="Authorization")]
UserAddressHeader = Annotated[Optional[str], Header(alias="X-User-Address")]
StorageDep = Annotated[BaseStorage, Depends(get_storage)]


class OAuthAuthorizeApproveRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    client_id: str = Field(alias="client_id")
    redirect_uri: str = Field(alias="redirect_uri")
    response_type: str = Field(alias="response_type")
    scope: str = Field(default=oauth_service.DEFAULT_READ_SCOPES)
    state: Optional[str] = None
    code_challenge: str = Field(alias="code_challenge")
    code_challenge_method: str = Field(alias="code_challenge_method")
    resource: Optional[str] = None
    credential_id: str = Field(alias="credentialId")


@router.get("/.well-known/oauth-authorization-server")
async def oauth_authorization_server_metadata():
    return oauth_service.authorization_server_metadata()


@router.get("/.well-known/jwks.json")
async def oauth_jwks_metadata():
    return oauth_service.jwks_metadata()


@router.post("/oauth/authorize/approve")
async def approve_oauth_authorization(
    req: OAuthAuthorizeApproveRequest,
    storage: StorageDep,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    redirect_url = oauth_service.create_authorization_code(
        storage,
        owner,
        oauth_service.OAuthAuthorizeRequest(
            client_id=req.client_id,
            redirect_uri=req.redirect_uri,
            response_type=req.response_type,
            scope=req.scope,
            state=req.state,
            code_challenge=req.code_challenge,
            code_challenge_method=req.code_challenge_method,
            resource=req.resource,
            credential_id=req.credential_id,
        ),
    )
    return {"status": "success", "redirectUrl": redirect_url}


@router.post("/oauth/token")
async def exchange_oauth_token(request: Request, storage: StorageDep):
    form = oauth_service.parse_urlencoded_form(await request.body())
    return oauth_service.exchange_token(storage, form).to_response_dict()


@router.post("/oauth/revoke")
async def revoke_oauth_token(request: Request, storage: StorageDep):
    form = oauth_service.parse_urlencoded_form(await request.body())
    return oauth_service.revoke_token(storage, form)
