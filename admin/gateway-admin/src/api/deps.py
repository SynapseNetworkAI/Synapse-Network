from functools import lru_cache
from typing import Annotated

from fastapi import Depends, Header, Request

from src.core.config import get_settings
from src.core.errors import AuthenticationError, AuthorizationError
from src.services.adapters.gateway_client import GatewayAdapter
from src.services.approval.service import ApprovalService
from src.services.auth.service import AdminAuthService, AdminIdentity
from src.services.dashboard.service import DashboardService
from src.storage import InMemoryAdminStore, PostgresAdminStore
from src.storage.base import AdminStore

AuthorizationHeader = Annotated[str | None, Header(alias="Authorization")]
RequestIdHeader = Annotated[str | None, Header(alias="X-Request-Id")]


@lru_cache(maxsize=1)
def get_store() -> AdminStore:
    settings = get_settings()
    if settings.use_inmemory_store:
        return InMemoryAdminStore.seed_demo()
    return PostgresAdminStore.from_dsn(settings.admin_database_dsn)


@lru_cache(maxsize=1)
def get_auth_service() -> AdminAuthService:
    return AdminAuthService(get_store())


@lru_cache(maxsize=1)
def get_approval_service() -> ApprovalService:
    return ApprovalService(get_store())


@lru_cache(maxsize=1)
def get_gateway_adapter() -> GatewayAdapter:
    return GatewayAdapter()


@lru_cache(maxsize=1)
def get_dashboard_service() -> DashboardService:
    return DashboardService(get_gateway_adapter(), get_approval_service())


def get_request_id(request: Request, request_id: RequestIdHeader = None) -> str:
    request_state_id = getattr(request.state, "request_id", None)
    return request_state_id or request_id or "req_demo"


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
