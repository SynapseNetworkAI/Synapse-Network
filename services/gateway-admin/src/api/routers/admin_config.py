from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query

from src.api.deps import get_admin_config_service, get_request_id, require_admin, require_high_risk_permission
from src.api.schemas.admin_config import (
    AdminMenuConfigItemModel,
    AdminMenuConfigMetaModel,
    AdminMenuConfigResponse,
    CreateAdminMenuConfigItemRequest,
    UpdateAdminMenuConfigItemRequest,
)
from src.api.schemas.common import ApiResponse
from src.services.admin_config.service import AdminConfigService
from src.services.auth.service import AdminIdentity

router = APIRouter(prefix="/api/admin/v1/config", tags=["admin-config"])


def _build_response(payload: dict) -> AdminMenuConfigResponse:
    return AdminMenuConfigResponse(
        items=[AdminMenuConfigItemModel(**item) for item in payload["items"]],
        meta=AdminMenuConfigMetaModel(**payload["meta"]),
    )


@router.get("/menu-items", response_model=ApiResponse)
def list_menu_items(
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
    admin_config_service: Annotated[AdminConfigService, Depends(get_admin_config_service)],
    stage: Annotated[str, Query()] = "draft",
):
    payload = admin_config_service.list_menu_items(operator=admin, stage=stage)
    return ApiResponse(data=_build_response(payload), request_id=request_id)


@router.get("/menu-items/visible", response_model=ApiResponse)
def list_visible_menu_items(
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
    admin_config_service: Annotated[AdminConfigService, Depends(get_admin_config_service)],
):
    payload = admin_config_service.list_visible_menu_items(operator=admin)
    return ApiResponse(data=_build_response(payload), request_id=request_id)


@router.post("/menu-items", response_model=ApiResponse)
def create_menu_item(
    payload: CreateAdminMenuConfigItemRequest,
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
    admin_config_service: Annotated[AdminConfigService, Depends(get_admin_config_service)],
):
    created = admin_config_service.create_menu_item(operator=admin, payload=payload.model_dump(by_alias=True))
    return ApiResponse(data=_build_response(created), request_id=request_id)


@router.patch("/menu-items/{item_id}", response_model=ApiResponse)
def update_menu_item(
    payload: UpdateAdminMenuConfigItemRequest,
    item_id: Annotated[str, Path(alias="item_id")],
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
    admin_config_service: Annotated[AdminConfigService, Depends(get_admin_config_service)],
):
    updated = admin_config_service.update_menu_item(operator=admin, item_id=item_id, payload=payload.model_dump(by_alias=True))
    return ApiResponse(data=_build_response(updated), request_id=request_id)


@router.delete("/menu-items/{item_id}", response_model=ApiResponse)
def delete_menu_item(
    item_id: Annotated[str, Path(alias="item_id")],
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
    admin_config_service: Annotated[AdminConfigService, Depends(get_admin_config_service)],
):
    deleted = admin_config_service.delete_menu_item(operator=admin, item_id=item_id)
    return ApiResponse(data=_build_response(deleted), request_id=request_id)


@router.post("/menu-items/publish", response_model=ApiResponse)
def publish_menu_config(
    admin: Annotated[AdminIdentity, Depends(require_high_risk_permission("dashboard:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    admin_config_service: Annotated[AdminConfigService, Depends(get_admin_config_service)],
):
    published = admin_config_service.publish_menu_config(operator=admin)
    return ApiResponse(data=_build_response(published), request_id=request_id)