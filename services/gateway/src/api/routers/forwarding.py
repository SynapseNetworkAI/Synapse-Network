from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Header

from src.api.schemas.pydantic_models import (
    AgentInvokeRequest,
    InferenceRequest,
)
from src.services.owner import forwarding_service
from src.storage import BaseStorage, get_storage

router = APIRouter()

ServiceIdHeader = Annotated[Optional[str], Header(alias="X-Service-Id")]
CredentialHeader = Annotated[Optional[str], Header(alias="X-Credential")]
RequestIdHeader = Annotated[Optional[str], Header(alias="X-Request-Id")]
StorageDep = Annotated[BaseStorage, Depends(get_storage)]


@router.post("/v1/gateway/generate")
async def generate_response_v2(
    request: InferenceRequest,
    storage: StorageDep,
    x_service_id: ServiceIdHeader = None,
    x_credential: CredentialHeader = None,
    x_request_id: RequestIdHeader = None,
):
    return await forwarding_service.generate_response_v2(
        storage, request, x_service_id, x_credential, x_request_id
    )


@router.get("/v1/agent/invocations/{invocation_id}")
async def get_agent_invocation_receipt(
    invocation_id: str,
    storage: StorageDep,
    x_credential: CredentialHeader = None,
):
    return forwarding_service.get_invocation_receipt_v1(
        storage, invocation_id, x_credential
    )


@router.post("/v1/agent/invoke")
async def agent_invoke(
    request: AgentInvokeRequest,
    storage: StorageDep,
    x_credential: CredentialHeader = None,
    x_request_id: RequestIdHeader = None,
):
    """Single-call invoke with price assertion.

    Pass ``costUsdc`` = the price the agent observed in discovery.
    Returns 422 PRICE_MISMATCH if the live price has changed.
    """
    return await forwarding_service.invoke_v1(
        storage, request, x_credential, x_request_id
    )
