from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from src.core.config import get_settings
from src.core.errors import AuthenticationError, BadRequestError
from src.core.security import verify_password
from src.domain import AdminActionAudit, AdminSession
from src.domain import AdminMfaFactor, AdminUser
from src.domain.enums import AdminSessionStatus, AdminUserStatus, AuditResultStatus, MfaFactorStatus, MfaFactorType, RoleBindingStatus
from src.services.auth.google_authenticator import AdminGoogleAuthenticatorPolicy, build_google_authenticator_policy, verify_google_authenticator_code
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

    def login(self, email: str, password: str, otp_code: str | None) -> tuple[str, AdminIdentity]:
        if not email.strip() or not password.strip():
            raise BadRequestError("email and password are required")
        user = self._store.identity.get_user_by_email(email)
        if user is None or user.status != AdminUserStatus.ACTIVE:
            raise AuthenticationError("Invalid admin credentials")
        if not verify_password(password, user.password_hash):
            raise AuthenticationError("Invalid admin credentials")
        self._verify_login_otp(user, otp_code)
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
            expires_at=now + timedelta(seconds=self._settings.admin_session_ttl_sec),
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

    def get_security_policy(self) -> AdminGoogleAuthenticatorPolicy:
        return build_google_authenticator_policy()

    def verify_high_risk_otp(self, admin_id: str, otp_code: str | None) -> None:
        user = self._store.identity.get_user_by_id(admin_id)
        if user is None or user.status != AdminUserStatus.ACTIVE:
            raise AuthenticationError("Admin account is not active")
        policy = self.get_security_policy()
        if not policy.high_risk_totp_required or not user.require_mfa:
            return
        if not (otp_code or "").strip():
            raise AuthenticationError("Google Authenticator code is required for high-risk actions")
        factor = self._get_active_totp_factor(user)
        if not verify_google_authenticator_code(factor, otp_code or ""):
            raise AuthenticationError("Invalid Google Authenticator code")

    def get_current_admin(self, token: str) -> AdminIdentity:
        session = self._get_active_session(token)
        return self._build_identity(session.admin_id)

    def logout(self, token: str) -> AdminIdentity:
        session = self._get_active_session(token)
        admin = self._build_identity(session.admin_id)
        self._store.identity.revoke_session(session.session_id)
        now = datetime.now(timezone.utc)
        self._store.audit.append_action(
            AdminActionAudit(
                action_type="admin.logout.success",
                result_status=AuditResultStatus.SUCCESS,
                operator_id=admin.admin_id,
                operator_email=admin.email,
                operator_role=admin.role,
                session_id=session.session_id,
                resource_type="admin_session",
                resource_id=session.session_id,
                detail={},
                created_at=now,
            )
        )
        return admin

    def _get_active_session(self, token: str) -> AdminSession:
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
        return session

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

    def _verify_login_otp(self, user: AdminUser, otp_code: str | None) -> None:
        policy = self.get_security_policy()
        if not user.require_mfa:
            return
        factor = self._get_active_totp_factor(user)
        if not policy.login_totp_required:
            return
        if not (otp_code or "").strip():
            raise BadRequestError("otpCode is required when login TOTP is enabled")
        if not verify_google_authenticator_code(factor, otp_code or ""):
            raise AuthenticationError("Invalid Google Authenticator code")

    def _get_active_totp_factor(self, user: AdminUser) -> AdminMfaFactor:
        for factor in self._store.identity.list_mfa_factors(user.admin_id):
            if factor.status != MfaFactorStatus.ACTIVE:
                continue
            if factor.factor_type != MfaFactorType.TOTP:
                continue
            if str(factor.payload.get("totpSecret") or "").strip():
                return factor
        raise AuthenticationError("Admin Google Authenticator is not configured")
