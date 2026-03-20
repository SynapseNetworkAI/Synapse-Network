from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from src.api.deps import get_admin_token, get_auth_service, get_request_id, require_admin
from src.api.schemas.auth import AdminAuthSecurityPolicy, AdminProfile, LoginRequest, LoginResponse
from src.api.schemas.common import ApiResponse
from src.core.config import get_settings
from src.core.csrf import build_admin_csrf_token
from src.services.auth.service import AdminAuthService, AdminIdentity

router = APIRouter(prefix="/api/admin/v1/auth", tags=["admin-auth"])
settings = get_settings()


def _build_security_policy(auth_service: AdminAuthService) -> AdminAuthSecurityPolicy:
    policy = auth_service.get_security_policy()
    return AdminAuthSecurityPolicy(
        login_totp_required=policy.login_totp_required,
        high_risk_totp_required=policy.high_risk_totp_required,
        totp_issuer=policy.issuer,
    )


def _set_admin_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.admin_session_cookie_name,
        value=token,
        max_age=settings.admin_session_ttl_sec,
        httponly=True,
        secure=settings.admin_session_cookie_secure,
        samesite=settings.admin_session_cookie_samesite,
        path="/",
        domain=settings.admin_session_cookie_domain,
    )


def _clear_admin_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.admin_session_cookie_name,
        path="/",
        domain=settings.admin_session_cookie_domain,
        secure=settings.admin_session_cookie_secure,
        samesite=settings.admin_session_cookie_samesite,
        httponly=True,
    )


@router.post("/login", response_model=ApiResponse)
def login(
    payload: LoginRequest,
    response: Response,
    request_id: Annotated[str, Depends(get_request_id)],
    auth_service: Annotated[AdminAuthService, Depends(get_auth_service)],
):
    token, admin = auth_service.login(payload.email, payload.password, payload.otp_code)
    _set_admin_session_cookie(response, token)
    csrf_token = build_admin_csrf_token(token)
    return ApiResponse(
        data=LoginResponse(
            expires_in=settings.admin_session_ttl_sec,
            csrf_token=csrf_token,
            admin=AdminProfile(
                admin_id=admin.admin_id,
                email=admin.email,
                display_name=admin.display_name,
                role=admin.role,
                permissions=list(admin.permissions),
            ),
            security=_build_security_policy(auth_service),
        ),
        request_id=request_id,
    )


@router.get("/policy", response_model=ApiResponse)
def auth_policy(
    request_id: Annotated[str, Depends(get_request_id)],
    auth_service: Annotated[AdminAuthService, Depends(get_auth_service)],
):
    return ApiResponse(data=_build_security_policy(auth_service), request_id=request_id)


@router.get("/me", response_model=ApiResponse)
def me(
    request: Request,
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    request_id: Annotated[str, Depends(get_request_id)],
    auth_service: Annotated[AdminAuthService, Depends(get_auth_service)],
):
    token = get_admin_token(request)
    return ApiResponse(
        data=LoginResponse(
            expires_in=settings.admin_session_ttl_sec,
            csrf_token=build_admin_csrf_token(token),
            admin=AdminProfile(
                admin_id=admin.admin_id,
                email=admin.email,
                display_name=admin.display_name,
                role=admin.role,
                permissions=list(admin.permissions),
            ),
            security=_build_security_policy(auth_service),
        ),
        request_id=request_id,
    )


@router.post("/logout", response_model=ApiResponse)
def logout(
    request: Request,
    response: Response,
    admin: Annotated[AdminIdentity, Depends(require_admin)],
    auth_service: Annotated[AdminAuthService, Depends(get_auth_service)],
    request_id: Annotated[str, Depends(get_request_id)],
):
    token = get_admin_token(request)
    auth_service.logout(token)
    _clear_admin_session_cookie(response)
    return ApiResponse(
        data={"adminId": admin.admin_id, "loggedOut": True},
        request_id=request_id,
    )
