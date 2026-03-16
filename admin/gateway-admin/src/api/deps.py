from typing import Annotated

from fastapi import Depends, Header, Request

from src.core.errors import AuthenticationError, AuthorizationError
from src.services.adapters.gateway_client import GatewayAdapter
from src.services.approval.service import ApprovalService
from src.services.auth.service import AdminAuthService, AdminIdentity
from src.services.dashboard.service import DashboardService

AuthorizationHeader = Annotated[str | None, Header(alias="Authorization")]
RequestIdHeader = Annotated[str | None, Header(alias="X-Request-Id")]

_auth_service = AdminAuthService()
_approval_service = ApprovalService()
_gateway_adapter = GatewayAdapter()
_dashboard_service = DashboardService(_gateway_adapter, _approval_service)


def get_request_id(request: Request, request_id: RequestIdHeader = None) -> str:
    request_state_id = getattr(request.state, "request_id", None)
    return request_state_id or request_id or "req_demo"


def get_auth_service() -> AdminAuthService:
    return _auth_service


def get_approval_service() -> ApprovalService:
    return _approval_service


def get_dashboard_service() -> DashboardService:
    return _dashboard_service


def require_admin(
    authorization: AuthorizationHeader = None,
    auth_service: Annotated[AdminAuthService, Depends(get_auth_service)] = None,
) -> AdminIdentity:
    if not authorization:
        raise AuthenticationError("Missing Authorization header")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise AuthenticationError("Invalid Authorization header")
    return auth_service.get_current_admin(token)


def require_permission(permission: str):
    def dependency(
        admin: Annotated[AdminIdentity, Depends(require_admin)],
    ) -> AdminIdentity:
        if permission not in admin.permissions:
            raise AuthorizationError(f"Missing permission: {permission}")
        return admin

    return dependency
