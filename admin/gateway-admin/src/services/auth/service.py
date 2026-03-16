from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from src.core.config import get_settings
from src.core.errors import AuthenticationError, BadRequestError
from src.domain import AdminActionAudit, AdminSession
from src.domain.enums import AdminSessionStatus, AdminUserStatus, AuditResultStatus, MfaFactorStatus, RoleBindingStatus
from src.storage.base import AdminStore

DASHBOARD_READ = "dashboard:read"
APPROVAL_READ = "approval:read"
APPROVAL_SUBMIT = "approval:submit"
APPROVAL_DECIDE = "approval:decide"
INVALID_ADMIN_TOKEN = "Invalid admin token"


@dataclass(frozen=True)
class AdminIdentity:
    admin_id: str
    email: str
    display_name: str
    role: str
    permissions: tuple[str, ...]


class AdminAuthService:
    def __init__(self, store: AdminStore) -> None:
        self._settings = get_settings()
        self._store = store

    def login(self, email: str, otp_code: str) -> tuple[str, AdminIdentity]:
        if not email.strip() or not otp_code.strip():
            raise BadRequestError("email and otpCode are required")
        user = self._store.identity.get_user_by_email(email)
        if user is None or user.status != AdminUserStatus.ACTIVE:
            raise AuthenticationError("Invalid admin credentials")
        if user.require_mfa:
            active_factors = [
                factor
                for factor in self._store.identity.list_mfa_factors(user.admin_id)
                if factor.status == MfaFactorStatus.ACTIVE
            ]
            if not active_factors:
                raise AuthenticationError("Admin MFA is not configured")
        session_id = uuid4().hex
        token = f"{self._settings.token_prefix}{session_id}"
        now = datetime.now(timezone.utc)
        session = AdminSession(
            session_id=session_id,
            admin_id=user.admin_id,
            token_jti=uuid4().hex,
            status=AdminSessionStatus.ACTIVE,
            mfa_verified_at=now,
            issued_at=now,
            last_seen_at=now,
            expires_at=now + timedelta(hours=1),
            created_at=now,
        )
        self._store.identity.create_session(session)
        self._store.identity.touch_last_login(user.admin_id)
        admin = self._build_identity(user.admin_id)
        self._store.audit.append_action(
            AdminActionAudit(
                action_type="admin.login.success",
                result_status=AuditResultStatus.SUCCESS,
                operator_id=admin.admin_id,
                operator_email=admin.email,
                operator_role=admin.role,
                session_id=session_id,
                resource_type="admin_session",
                resource_id=session_id,
                detail={"authSource": user.auth_source.value},
                created_at=now,
            )
        )
        return token, admin

    def get_current_admin(self, token: str) -> AdminIdentity:
        if not token.startswith(self._settings.token_prefix):
            raise AuthenticationError(INVALID_ADMIN_TOKEN)
        session_id = token.removeprefix(self._settings.token_prefix).strip()
        if not session_id:
            raise AuthenticationError(INVALID_ADMIN_TOKEN)
        session = self._store.identity.get_session_by_id(session_id)
        if session is None or session.status != AdminSessionStatus.ACTIVE:
            raise AuthenticationError(INVALID_ADMIN_TOKEN)
        if session.expires_at <= datetime.now(timezone.utc):
            raise AuthenticationError("Admin session expired")
        return self._build_identity(session.admin_id)

    def _build_identity(self, admin_id: str) -> AdminIdentity:
        user = self._store.identity.get_user_by_id(admin_id)
        if user is None or user.status != AdminUserStatus.ACTIVE:
            raise AuthenticationError("Admin account is not active")
        role_bindings = [
            binding
            for binding in self._store.authorization.list_role_bindings(admin_id)
            if binding.status == RoleBindingStatus.ACTIVE
        ]
        role = role_bindings[0].role_key if role_bindings else "platform_ops_admin"
        permissions: set[str] = set()
        for binding in role_bindings:
            for mapping in self._store.authorization.list_role_permissions(binding.role_key):
                permissions.add(mapping.permission_key)
        if not permissions:
            permissions.add(DASHBOARD_READ)
        return AdminIdentity(
            admin_id=user.admin_id,
            email=user.email,
            display_name=user.display_name,
            role=role,
            permissions=tuple(sorted(permissions)),
        )
