from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Header

from src.models.pydantic_models import InferenceRequest
from src.services import forwarding_service
from src.storage import BaseStorage, get_storage

router = APIRouter()

ServiceIdHeader = Annotated[Optional[str], Header(alias="X-Service-Id")]
CredentialHeader = Annotated[Optional[str], Header(alias="X-Credential")]
StorageDep = Annotated[BaseStorage, Depends(get_storage)]


@router.post("/v1/gateway/generate")
async def generate_response_v2(
    request: InferenceRequest,
    storage: StorageDep,
    x_service_id: ServiceIdHeader = None,
    x_credential: CredentialHeader = None,
):
    return await forwarding_service.generate_response_v2(storage, request, x_service_id, x_credential)
