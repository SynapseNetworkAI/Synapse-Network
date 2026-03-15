from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Header

from src.api.schemas.pydantic_models import InferenceRequest
from src.services.buyer import forwarding_service
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
    return await forwarding_service.generate_response_v2(storage, request, x_service_id, x_credential, x_request_id)
