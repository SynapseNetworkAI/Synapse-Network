from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from src.api.deps import get_admin_token, get_auth_service, get_request_id, require_admin
from src.api.schemas.auth import (
    AdminAuthSecurityPolicy,
    AdminProfile,
    LoginRequest,
    LoginResponse,
    MfaEnrollBeginRequest,
    MfaEnrollBeginResponse,
    MfaEnrollVerifyRequest,
)
from src.api.schemas.common import ApiResponse
from src.core.config import get_settings
from src.core.csrf import build_admin_csrf_token
from src.services.auth.service import AdminAuthService, AdminIdentity

router = APIRouter(prefix="/api/admin/v1/auth", tags=["admin-auth"])
settings = get_settings()


def _request_client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _request_user_agent(request: Request) -> str | None:
    value = request.headers.get("user-agent")
    return value.strip() if value else None


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
    request: Request,
    response: Response,
    request_id: Annotated[str, Depends(get_request_id)],
    auth_service: Annotated[AdminAuthService, Depends(get_auth_service)],
):
    token, admin = auth_service.login(
        payload.email,
        payload.password,
        payload.otp_code,
        client_ip=_request_client_ip(request),
        user_agent=_request_user_agent(request),
        request_id=request_id,
    )
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


@router.post("/mfa/enroll/begin", response_model=ApiResponse)
def begin_mfa_enrollment(
    payload: MfaEnrollBeginRequest,
    request: Request,
    request_id: Annotated[str, Depends(get_request_id)],
    auth_service: Annotated[AdminAuthService, Depends(get_auth_service)],
):
    result = auth_service.begin_mfa_enrollment(
        payload.enrollment_token,
        client_ip=_request_client_ip(request),
        user_agent=_request_user_agent(request),
    )
    return ApiResponse(
        data=MfaEnrollBeginResponse(
            factorId=result.factor_id,
            issuer=result.issuer,
            accountName=result.account_name,
            otpauthUrl=result.otpauth_url,
            manualEntryKey=result.manual_entry_key,
            expiresIn=result.expires_in,
        ),
        request_id=request_id,
    )


@router.post("/mfa/enroll/verify", response_model=ApiResponse)
def verify_mfa_enrollment(
    payload: MfaEnrollVerifyRequest,
    request: Request,
    response: Response,
    request_id: Annotated[str, Depends(get_request_id)],
    auth_service: Annotated[AdminAuthService, Depends(get_auth_service)],
):
    token, admin = auth_service.verify_mfa_enrollment(
        payload.enrollment_token,
        payload.factor_id,
        payload.otp_code,
        client_ip=_request_client_ip(request),
        user_agent=_request_user_agent(request),
        request_id=request_id,
    )
    _set_admin_session_cookie(response, token)
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
