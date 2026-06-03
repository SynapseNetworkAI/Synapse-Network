from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from src.api.deps import get_provider_llm_config_service, get_request_id, require_permission
from src.api.schemas.common import ApiResponse
from src.api.schemas.provider_llm_config import (
    LlmRolloutRequestCreate,
    LlmRolloutRequestResponse,
    ProviderLlmConfigSnapshotResponse,
)
from src.services.auth.service import AdminIdentity
from src.services.provider_llm_config import ProviderLlmConfigService

router = APIRouter(prefix="/api/admin/v1/provider-llm-config", tags=["admin-provider-llm-config"])


@router.get("", response_model=ApiResponse)
def get_provider_llm_config(
    admin: Annotated[AdminIdentity, Depends(require_permission("dashboard:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    service: Annotated[ProviderLlmConfigService, Depends(get_provider_llm_config_service)],
):
    _ = admin
    payload = ProviderLlmConfigSnapshotResponse.from_snapshot(service.snapshot())
    return ApiResponse(data=payload.model_dump(by_alias=True), request_id=request_id)


@router.post("/rollout-requests", response_model=ApiResponse)
def create_provider_llm_rollout_request(
    payload: LlmRolloutRequestCreate,
    admin: Annotated[AdminIdentity, Depends(require_permission("approval:submit"))],
    request_id: Annotated[str, Depends(get_request_id)],
    service: Annotated[ProviderLlmConfigService, Depends(get_provider_llm_config_service)],
):
    try:
        request = service.create_rollout_request(
            actor=admin,
            service_id=payload.service_id,
            environment=payload.environment,
            action=payload.action,
            note=payload.note,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail={"code": str(exc), "message": "LLM service is not in the managed catalog"},
        ) from exc
    response = LlmRolloutRequestResponse.from_request(request)
    return ApiResponse(data=response.model_dump(by_alias=True), request_id=request_id)
