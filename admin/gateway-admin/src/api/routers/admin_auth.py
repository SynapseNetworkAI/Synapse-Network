from typing import Annotated

from fastapi import APIRouter, Depends

from src.api.deps import get_auth_service, get_request_id, require_admin
from src.api.schemas.auth import AdminProfile, LoginRequest, LoginResponse
from src.api.schemas.common import ApiResponse
from src.services.auth.service import AdminAuthService, AdminIdentity

router = APIRouter(prefix="/api/admin/v1/auth", tags=["admin-auth"])


@router.post("/login", response_model=ApiResponse)
def login(
    payload: LoginRequest,
    request_id: Annotated[str, Depends(get_request_id)],
    auth_service: Annotated[AdminAuthService, Depends(get_auth_service)],
):
    token, admin = auth_service.login(payload.email, payload.password, payload.otp_code)
    return ApiResponse(
        data=LoginResponse(
            access_token=token,
            admin=AdminProfile(
                admin_id=admin.admin_id,
                email=admin.email,
                display_name=admin.display_name,
                role=admin.role,
                permissions=list(admin.permissions),
            ),
        ),
        request_id=request_id,
    )


@router.get("/me", response_model=ApiResponse)
def me(
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
):
    return ApiResponse(
        data=AdminProfile(
            admin_id=admin.admin_id,
            email=admin.email,
            display_name=admin.display_name,
            role=admin.role,
            permissions=list(admin.permissions),
        ),
        request_id=request_id,
    )


@router.post("/logout", response_model=ApiResponse)
def logout(
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
):
    return ApiResponse(
        data={"adminId": admin.admin_id, "loggedOut": True},
        request_id=request_id,
    )
