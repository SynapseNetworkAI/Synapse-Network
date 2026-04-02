from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query

from src.api.deps import get_admin_user_service, get_request_id, require_admin
from src.api.schemas.admin_user import (
    AdminPermissionCatalogItem,
    AdminPermissionCatalogResponse,
    AdminRoleCatalogItem,
    AdminRoleCatalogResponse,
    AdminUserListResponse,
    AdminUserSummary,
    CreateAdminRoleRequest,
    CreateAdminRoleResponse,
    CreateAdminUserRequest,
    CreateAdminUserResponse,
    DeleteAdminUserResponse,
    DeleteAdminRoleResponse,
    UpdateAdminUserRequest,
    UpdateAdminUserResponse,
    UpdateAdminRoleRequest,
    UpdateAdminRoleResponse,
)
from src.api.schemas.common import ApiResponse
from src.services.admin_user.service import AdminUserService
from src.services.auth.service import AdminIdentity

router = APIRouter(prefix="/api/admin/v1/users", tags=["admin-users"])


@router.get("", response_model=ApiResponse)
def list_admin_users(
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
    admin_user_service: Annotated[AdminUserService, Depends(get_admin_user_service)],
    status: str | None = None,
    search: str | None = None,
    role_key: Annotated[str | None, Query(alias="roleKey")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
):
    payload = admin_user_service.list_users(operator=admin, status=status, limit=limit, search=search, role_key=role_key)
    return ApiResponse(
        data=AdminUserListResponse(
            items=[AdminUserSummary(**item) for item in payload["items"]],
            next_cursor=payload["nextCursor"],
        ),
        request_id=request_id,
    )


@router.get("/roles", response_model=ApiResponse)
def list_admin_roles(
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
    admin_user_service: Annotated[AdminUserService, Depends(get_admin_user_service)],
):
    payload = admin_user_service.list_roles(operator=admin)
    return ApiResponse(
        data=AdminRoleCatalogResponse(items=[AdminRoleCatalogItem(**item) for item in payload["items"]]),
        request_id=request_id,
    )


@router.get("/permissions", response_model=ApiResponse)
def list_admin_permissions(
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
    admin_user_service: Annotated[AdminUserService, Depends(get_admin_user_service)],
):
    payload = admin_user_service.list_permissions(operator=admin)
    return ApiResponse(
        data=AdminPermissionCatalogResponse(items=[AdminPermissionCatalogItem(**item) for item in payload["items"]]),
        request_id=request_id,
    )


@router.post("/roles", response_model=ApiResponse)
def create_admin_role(
    payload: CreateAdminRoleRequest,
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
    admin_user_service: Annotated[AdminUserService, Depends(get_admin_user_service)],
):
    created = admin_user_service.create_role(payload.model_dump(by_alias=True), operator=admin)
    return ApiResponse(data=CreateAdminRoleResponse(role=AdminRoleCatalogItem(**created["role"])), request_id=request_id)


@router.patch("/roles/{role_key}", response_model=ApiResponse)
def update_admin_role(
    payload: UpdateAdminRoleRequest,
    role_key: str,
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
    admin_user_service: Annotated[AdminUserService, Depends(get_admin_user_service)],
):
    updated = admin_user_service.update_role(role_key=role_key, payload=payload.model_dump(by_alias=True), operator=admin)
    return ApiResponse(data=UpdateAdminRoleResponse(role=AdminRoleCatalogItem(**updated["role"])), request_id=request_id)


@router.delete("/roles/{role_key}", response_model=ApiResponse)
def delete_admin_role(
    role_key: str,
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
    admin_user_service: Annotated[AdminUserService, Depends(get_admin_user_service)],
):
    deleted = admin_user_service.disable_role(role_key=role_key, operator=admin)
    return ApiResponse(data=DeleteAdminRoleResponse(**deleted), request_id=request_id)


@router.post("", response_model=ApiResponse)
def create_admin_user(
    payload: CreateAdminUserRequest,
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
    admin_user_service: Annotated[AdminUserService, Depends(get_admin_user_service)],
):
    created = admin_user_service.create_user(payload.model_dump(by_alias=True), operator=admin)
    return ApiResponse(data=CreateAdminUserResponse(admin=AdminUserSummary(**created["admin"])), request_id=request_id)


@router.patch("/{admin_id}", response_model=ApiResponse)
def update_admin_user(
    payload: UpdateAdminUserRequest,
    admin_id: Annotated[str, Path(alias="admin_id")],
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
    admin_user_service: Annotated[AdminUserService, Depends(get_admin_user_service)],
):
    updated = admin_user_service.update_user(admin_id=admin_id, payload=payload.model_dump(by_alias=True), operator=admin)
    return ApiResponse(data=UpdateAdminUserResponse(admin=AdminUserSummary(**updated["admin"])), request_id=request_id)


@router.delete("/{admin_id}", response_model=ApiResponse)
def delete_admin_user(
    admin_id: Annotated[str, Path(alias="admin_id")],
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
    admin_user_service: Annotated[AdminUserService, Depends(get_admin_user_service)],
):
    deleted = admin_user_service.disable_user(admin_id=admin_id, operator=admin)
    return ApiResponse(data=DeleteAdminUserResponse(**deleted), request_id=request_id)