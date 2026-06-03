from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Header

from src.api.schemas.pydantic_models import AgentInvokeRequest
from src.services.platform import oauth_service
from src.services.owner import forwarding_service
from src.services.owner import forwarding_validation
from src.storage import BaseStorage, get_storage

router = APIRouter()

ServiceIdHeader = Annotated[Optional[str], Header(alias="X-Service-Id")]
CredentialHeader = Annotated[Optional[str], Header(alias="X-Credential")]
AuthorizationHeader = Annotated[Optional[str], Header(alias="Authorization")]
RequestIdHeader = Annotated[Optional[str], Header(alias="X-Request-Id")]
StorageDep = Annotated[BaseStorage, Depends(get_storage)]


@router.get("/v1/agent/invocations/{invocation_id}")
async def get_agent_invocation_receipt(
    invocation_id: str,
    storage: StorageDep,
    x_credential: CredentialHeader = None,
    authorization: AuthorizationHeader = None,
):
    if not x_credential and authorization:
        credential = oauth_service.resolve_runtime_credential(
            storage,
            authorization,
            required_scope="synapse.receipts.read",
        )
        return forwarding_service.get_invocation_receipt_for_credential(
            storage,
            invocation_id,
            credential,
        )
    return forwarding_service.get_invocation_receipt_v1(
        storage, invocation_id, x_credential
    )


@router.post("/v1/agent/invoke")
async def agent_invoke(
    request: AgentInvokeRequest,
    storage: StorageDep,
    x_credential: CredentialHeader = None,
    authorization: AuthorizationHeader = None,
    x_request_id: RequestIdHeader = None,
):
    """Single-call invoke with price assertion.

    Pass ``costUsdc`` = the price the agent observed in discovery.
    Returns 422 PRICE_MISMATCH if the live price has changed.
    """
    if not x_credential and authorization:
        credential = oauth_service.resolve_runtime_credential(
            storage,
            authorization,
            required_scope="synapse.invocations.write",
        )
        trace_request_id = forwarding_validation.resolve_request_id(x_request_id)
        return await forwarding_service.invoke_with_credential_v1(
            storage,
            request,
            credential,
            trace_request_id,
        )
    return await forwarding_service.invoke_v1(
        storage, request, x_credential, x_request_id
    )
