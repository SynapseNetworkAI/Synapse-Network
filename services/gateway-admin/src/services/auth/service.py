from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import logging
import secrets
from uuid import uuid4

from src.core.config import get_settings
from src.core.errors import AdminAccountLockedError, AuthenticationError, BadRequestError, MfaEnrollmentRequiredError
from src.core.security import verify_password
from src.core.totp import build_totp_otpauth_url, generate_totp_secret
from src.domain import AdminActionAudit, AdminSession
from src.domain import AdminMfaEnrollmentChallenge, AdminMfaFactor, AdminUser
from src.domain.enums import AdminSessionStatus, AdminUserStatus, AuditResultStatus, MfaEnrollmentChallengeStatus, MfaFactorStatus, MfaFactorType, RoleBindingStatus
from src.services.auth.google_authenticator import AdminGoogleAuthenticatorPolicy, build_google_authenticator_policy, verify_google_authenticator_code
from src.storage.base import AdminStore

DASHBOARD_READ = "dashboard:read"
APPROVAL_READ = "approval:read"
APPROVAL_SUBMIT = "approval:submit"
APPROVAL_DECIDE = "approval:decide"
INVALID_ADMIN_TOKEN = "Invalid admin token"  # noqa: S105 - user-facing auth error, not a secret.
ADMIN_NOT_ACTIVE = "Admin account is not active"
INVALID_ADMIN_CREDENTIALS = "Invalid admin credentials"
EMAIL_PASSWORD_REQUIRED = "email and password are required"  # noqa: S105 - user-facing validation message.
INVALID_GOOGLE_AUTHENTICATOR_CODE = "Invalid Google Authenticator code"
HIGH_RISK_GOOGLE_AUTHENTICATOR_CODE_REQUIRED = "Google Authenticator code is required for high-risk actions"
MULTIPLE_ACTIVE_GOOGLE_AUTHENTICATOR_FACTORS = "Multiple active Google Authenticator factors are configured"
FACTOR_ID_OTP_CODE_REQUIRED = "factorId and otpCode are required"
INVALID_MFA_ENROLLMENT_FACTOR = "Invalid MFA enrollment factor"
MFA_ENROLLMENT_FACTOR_NOT_PENDING = "MFA enrollment factor is no longer pending"
ADMIN_SESSION_EXPIRED = "Admin session expired"
ENROLLMENT_TOKEN_REQUIRED = "enrollmentToken is required"  # noqa: S105 - user-facing validation message.
INVALID_MFA_ENROLLMENT_TOKEN = "Invalid MFA enrollment token"  # noqa: S105 - user-facing auth error.
MFA_ENROLLMENT_TOKEN_EXPIRED = "MFA enrollment token expired"  # noqa: S105 - user-facing auth error.
MFA_ENROLLMENT_TOKEN_NOT_VALID = "MFA enrollment token is no longer valid"  # noqa: S105 - user-facing auth error.
LOGIN_TOTP_CODE_REQUIRED = "otpCode is required when login TOTP is enabled"
ADMIN_GOOGLE_AUTHENTICATOR_NOT_CONFIGURED = "Admin Google Authenticator is not configured"
ENROLLMENT_TOKEN_TTL_SEC = 600
ADMIN_ACCOUNT_LOCKED_MESSAGE = "Admin account is temporarily locked. Try later or contact an owner."
SHORT_EMAIL_LOCAL_PART_MAX = 2

logger = logging.getLogger(__name__)


def _totp_secret_is_configured(secret: str) -> bool:
    normalized = secret.strip()
    return bool(normalized) and normalized != "__BOOTSTRAP_TOTP_SECRET__"


@dataclass(frozen=True)
class MfaEnrollmentBeginResult:
    factor_id: str
    issuer: str
    account_name: str
    otpauth_url: str
    manual_entry_key: str
    expires_in: int


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

    def login(
        self,
        email: str,
        password: str,
        otp_code: str | None,
        *,
        client_ip: str | None = None,
        user_agent: str | None = None,
        request_id: str | None = None,
    ) -> tuple[str, AdminIdentity]:
        if not email.strip() or not password.strip():
            raise BadRequestError(EMAIL_PASSWORD_REQUIRED)
        user = self._store.identity.get_user_by_email(email)
        if user is None or user.status != AdminUserStatus.ACTIVE:
            raise AuthenticationError(INVALID_ADMIN_CREDENTIALS)
        self._reject_locked_user(user, client_ip=client_ip, user_agent=user_agent, request_id=request_id)
        if not verify_password(password, user.password_hash):
            self._record_login_failure(
                user,
                failure_stage="password",
                client_ip=client_ip,
                user_agent=user_agent,
                request_id=request_id,
            )
            raise AuthenticationError(INVALID_ADMIN_CREDENTIALS)
        self._ensure_mfa_enrollment(user, client_ip=client_ip, user_agent=user_agent, request_id=request_id)
        try:
            self._verify_login_otp(user, otp_code)
        except (AuthenticationError, BadRequestError):
            self._record_login_failure(
                user,
                failure_stage="otp",
                client_ip=client_ip,
                user_agent=user_agent,
                request_id=request_id,
            )
            raise
        return self._create_authenticated_session(
            user,
            client_ip=client_ip,
            user_agent=user_agent,
            request_id=request_id,
            audit_detail={"authSource": user.auth_source.value},
        )

    def get_security_policy(self) -> AdminGoogleAuthenticatorPolicy:
        return build_google_authenticator_policy()

    def begin_mfa_enrollment(self, enrollment_token: str) -> MfaEnrollmentBeginResult:
        challenge = self._get_valid_enrollment_challenge(enrollment_token)
        user = self._get_active_user(challenge.admin_id)
        now = datetime.now(timezone.utc)
        factor = self._get_or_create_pending_factor(user, challenge, now)
        expires_in = max(0, int((challenge.expires_at - now).total_seconds())) if challenge.expires_at else 0
        return MfaEnrollmentBeginResult(
            factor_id=factor.factor_id,
            issuer=self._settings.admin_google_authenticator_issuer,
            account_name=user.email,
            otpauth_url=build_totp_otpauth_url(
                issuer=self._settings.admin_google_authenticator_issuer,
                account_name=user.email,
                secret=str(factor.payload.get("totpSecret") or ""),
            ),
            manual_entry_key=str(factor.payload.get("totpSecret") or ""),
            expires_in=expires_in,
        )

    def verify_mfa_enrollment(
        self,
        enrollment_token: str,
        factor_id: str,
        otp_code: str,
        *,
        client_ip: str | None = None,
        user_agent: str | None = None,
        request_id: str | None = None,
    ) -> tuple[str, AdminIdentity]:
        if not factor_id.strip() or not otp_code.strip():
            raise BadRequestError(FACTOR_ID_OTP_CODE_REQUIRED)
        challenge = self._get_valid_enrollment_challenge(enrollment_token)
        if challenge.factor_id != factor_id:
            raise AuthenticationError(INVALID_MFA_ENROLLMENT_FACTOR)
        user = self._get_active_user(challenge.admin_id)
        factor = self._store.identity.get_mfa_factor_by_id(factor_id)
        if factor is None or factor.admin_id != user.admin_id or factor.factor_type != MfaFactorType.TOTP:
            raise AuthenticationError(INVALID_MFA_ENROLLMENT_FACTOR)
        if factor.status != MfaFactorStatus.PENDING:
            raise AuthenticationError(MFA_ENROLLMENT_FACTOR_NOT_PENDING)
        if not verify_google_authenticator_code(factor, otp_code):
            raise AuthenticationError(INVALID_GOOGLE_AUTHENTICATOR_CODE)
        self._store.identity.clear_login_failures(user.admin_id)
        now = datetime.now(timezone.utc)
        self._store.identity.upsert_mfa_factor(
            AdminMfaFactor(
                factor_id=factor.factor_id,
                admin_id=factor.admin_id,
                factor_type=factor.factor_type,
                factor_label=factor.factor_label,
                status=MfaFactorStatus.ACTIVE,
                secret_ref=factor.secret_ref,
                payload=factor.payload,
                last_verified_at=now,
                created_at=factor.created_at,
                updated_at=now,
                revoked_at=None,
            )
        )
        for other_factor in self._store.identity.list_mfa_factors(user.admin_id):
            if other_factor.factor_id == factor.factor_id:
                continue
            if other_factor.factor_type != MfaFactorType.TOTP:
                continue
            if other_factor.status not in {MfaFactorStatus.PENDING, MfaFactorStatus.ACTIVE}:
                continue
            self._store.identity.upsert_mfa_factor(self._revoked_totp_factor(other_factor, now))
        self._store.identity.upsert_mfa_enrollment_challenge(
            AdminMfaEnrollmentChallenge(
                challenge_id=challenge.challenge_id,
                admin_id=challenge.admin_id,
                challenge_token_hash=challenge.challenge_token_hash,
                status=MfaEnrollmentChallengeStatus.VERIFIED,
                factor_id=factor.factor_id,
                client_ip=challenge.client_ip,
                user_agent=challenge.user_agent,
                request_id=challenge.request_id,
                expires_at=challenge.expires_at,
                issued_at=challenge.issued_at,
                verified_at=now,
                created_at=challenge.created_at,
                updated_at=now,
            )
        )
        return self._create_authenticated_session(
            user,
            client_ip=client_ip or challenge.client_ip,
            user_agent=user_agent or challenge.user_agent,
            request_id=request_id or challenge.request_id,
            audit_detail={"authSource": user.auth_source.value, "mfaEnrollment": True},
        )

    def verify_high_risk_otp(self, admin_id: str, otp_code: str | None) -> None:
        user = self._store.identity.get_user_by_id(admin_id)
        if user is None or user.status != AdminUserStatus.ACTIVE:
            raise AuthenticationError(ADMIN_NOT_ACTIVE)
        policy = self.get_security_policy()
        if not policy.high_risk_totp_required or not user.require_mfa:
            return
        if not (otp_code or "").strip():
            raise AuthenticationError(HIGH_RISK_GOOGLE_AUTHENTICATOR_CODE_REQUIRED)
        factor = self._get_active_totp_factor(user)
        if not _totp_secret_is_configured(str(factor.payload.get("totpSecret") or "")):
            raise AuthenticationError(ADMIN_GOOGLE_AUTHENTICATOR_NOT_CONFIGURED)
        if not verify_google_authenticator_code(factor, otp_code or ""):
            raise AuthenticationError(INVALID_GOOGLE_AUTHENTICATOR_CODE)

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
            raise AuthenticationError(ADMIN_SESSION_EXPIRED)
        return session

    def _build_identity(self, admin_id: str) -> AdminIdentity:
        user = self._store.identity.get_user_by_id(admin_id)
        if user is None or user.status != AdminUserStatus.ACTIVE:
            raise AuthenticationError(ADMIN_NOT_ACTIVE)
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

    def _get_active_user(self, admin_id: str) -> AdminUser:
        user = self._store.identity.get_user_by_id(admin_id)
        if user is None or user.status != AdminUserStatus.ACTIVE:
            raise AuthenticationError(ADMIN_NOT_ACTIVE)
        return user

    def _reject_locked_user(
        self,
        user: AdminUser,
        *,
        client_ip: str | None,
        user_agent: str | None,
        request_id: str | None,
    ) -> None:
        now = datetime.now(timezone.utc)
        if not user.locked_until or user.locked_until <= now:
            return
        detail = {
            "emailHash": self._email_hash(user.email),
            "failureStage": "locked",
            "failedLoginAttempts": user.failed_login_attempts,
            "lockHours": self._settings.admin_login_lock_hours,
        }
        self._store.audit.append_action(
            AdminActionAudit(
                action_type="admin.login.blocked_locked",
                result_status=AuditResultStatus.DENIED,
                operator_id=user.admin_id,
                operator_email=user.email,
                operator_role=self._role_for_user(user.admin_id),
                request_id=request_id,
                resource_type="admin_user",
                resource_id=user.admin_id,
                detail=detail,
                client_ip=client_ip,
                user_agent=user_agent,
                created_at=now,
            )
        )
        logger.warning(
            "ADMIN_LOGIN_BLOCKED_LOCKED",
            extra={
                "event": "ADMIN_LOGIN_BLOCKED_LOCKED",
                "adminId": user.admin_id,
                "emailHash": detail["emailHash"],
                "failedLoginAttempts": user.failed_login_attempts,
            },
        )
        raise AdminAccountLockedError(ADMIN_ACCOUNT_LOCKED_MESSAGE)

    def _record_login_failure(
        self,
        user: AdminUser,
        *,
        failure_stage: str,
        client_ip: str | None,
        user_agent: str | None,
        request_id: str | None,
    ) -> None:
        now = datetime.now(timezone.utc)
        updated_user = self._store.identity.record_login_failure(user.admin_id, now) or user
        detail = {
            "emailHash": self._email_hash(user.email),
            "failureStage": failure_stage,
            "failedLoginAttempts": updated_user.failed_login_attempts,
            "lockThreshold": self._settings.admin_login_lock_threshold,
        }
        self._store.audit.append_action(
            AdminActionAudit(
                action_type="admin.login.failure",
                result_status=AuditResultStatus.FAILURE,
                operator_id=user.admin_id,
                operator_email=user.email,
                operator_role=self._role_for_user(user.admin_id),
                request_id=request_id,
                resource_type="admin_user",
                resource_id=user.admin_id,
                detail=detail,
                client_ip=client_ip,
                user_agent=user_agent,
                created_at=now,
            )
        )
        logger.warning(
            "ADMIN_LOGIN_FAILURE",
            extra={
                "event": "ADMIN_LOGIN_FAILURE",
                "adminId": user.admin_id,
                "emailHash": detail["emailHash"],
                "failureStage": failure_stage,
                "failedLoginAttempts": updated_user.failed_login_attempts,
            },
        )
        if updated_user.failed_login_attempts < self._settings.admin_login_lock_threshold:
            return
        locked_until = now + timedelta(hours=self._settings.admin_login_lock_hours)
        locked_user = self._store.identity.lock_user_until(user.admin_id, locked_until) or updated_user
        locked_detail = {
            "emailHash": self._email_hash(user.email),
            "failureStage": failure_stage,
            "failedLoginAttempts": locked_user.failed_login_attempts,
            "lockHours": self._settings.admin_login_lock_hours,
        }
        self._store.audit.append_action(
            AdminActionAudit(
                action_type="admin.login.locked",
                result_status=AuditResultStatus.DENIED,
                operator_id=user.admin_id,
                operator_email=user.email,
                operator_role=self._role_for_user(user.admin_id),
                request_id=request_id,
                resource_type="admin_user",
                resource_id=user.admin_id,
                detail=locked_detail,
                client_ip=client_ip,
                user_agent=user_agent,
                created_at=now,
            )
        )
        logger.warning(
            "ADMIN_ACCOUNT_LOCKED",
            extra={
                "event": "ADMIN_ACCOUNT_LOCKED",
                "adminId": user.admin_id,
                "emailHash": locked_detail["emailHash"],
                "failedLoginAttempts": locked_user.failed_login_attempts,
                "lockHours": self._settings.admin_login_lock_hours,
            },
        )

    def _create_authenticated_session(
        self,
        user: AdminUser,
        *,
        client_ip: str | None,
        user_agent: str | None,
        request_id: str | None,
        audit_detail: dict[str, object],
    ) -> tuple[str, AdminIdentity]:
        session_id = uuid4().hex
        token = f"{self._settings.token_prefix}{session_id}"
        now = datetime.now(timezone.utc)
        session = AdminSession(
            session_id=session_id,
            admin_id=user.admin_id,
            token_jti=uuid4().hex,
            status=AdminSessionStatus.ACTIVE,
            mfa_verified_at=now,
            client_ip=client_ip,
            user_agent=user_agent,
            issued_at=now,
            last_seen_at=now,
            expires_at=now + timedelta(seconds=self._settings.admin_session_ttl_sec),
            created_at=now,
        )
        self._store.identity.create_session(session)
        self._store.identity.clear_login_failures(user.admin_id)
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
                request_id=request_id,
                resource_type="admin_session",
                resource_id=session_id,
                detail=audit_detail,
                client_ip=client_ip,
                user_agent=user_agent,
                created_at=now,
            )
        )
        return token, admin

    def _role_for_user(self, admin_id: str) -> str:
        for binding in self._store.authorization.list_role_bindings(admin_id):
            if binding.status == RoleBindingStatus.ACTIVE:
                return binding.role_key
        return "unknown"

    def _ensure_mfa_enrollment(
        self,
        user: AdminUser,
        *,
        client_ip: str | None,
        user_agent: str | None,
        request_id: str | None,
    ) -> None:
        policy = self.get_security_policy()
        if not policy.login_totp_required:
            return
        if not user.require_mfa:
            return
        if self._has_active_totp_factor(user):
            return
        now = datetime.now(timezone.utc)
        for challenge in self._store.identity.list_mfa_enrollment_challenges(user.admin_id):
            if challenge.status != MfaEnrollmentChallengeStatus.ISSUED:
                continue
            self._store.identity.upsert_mfa_enrollment_challenge(
                AdminMfaEnrollmentChallenge(
                    challenge_id=challenge.challenge_id,
                    admin_id=challenge.admin_id,
                    challenge_token_hash=challenge.challenge_token_hash,
                    status=MfaEnrollmentChallengeStatus.CANCELLED,
                    factor_id=challenge.factor_id,
                    client_ip=challenge.client_ip,
                    user_agent=challenge.user_agent,
                    request_id=challenge.request_id,
                    expires_at=challenge.expires_at,
                    issued_at=challenge.issued_at,
                    verified_at=challenge.verified_at,
                    created_at=challenge.created_at,
                    updated_at=now,
                )
            )
        enrollment_token = secrets.token_urlsafe(32)
        challenge = AdminMfaEnrollmentChallenge(
            challenge_id=uuid4().hex,
            admin_id=user.admin_id,
            challenge_token_hash=self._hash_enrollment_token(enrollment_token),
            status=MfaEnrollmentChallengeStatus.ISSUED,
            client_ip=client_ip,
            user_agent=user_agent,
            request_id=request_id,
            expires_at=now + timedelta(seconds=ENROLLMENT_TOKEN_TTL_SEC),
            issued_at=now,
            created_at=now,
            updated_at=now,
        )
        self._store.identity.upsert_mfa_enrollment_challenge(challenge)
        raise MfaEnrollmentRequiredError(
            data={
                "enrollmentToken": enrollment_token,
                "expiresIn": ENROLLMENT_TOKEN_TTL_SEC,
                "maskedEmail": self._mask_email(user.email),
                "totpIssuer": self._settings.admin_google_authenticator_issuer,
            }
        )

    def _has_active_totp_factor(self, user: AdminUser) -> bool:
        for factor in self._store.identity.list_mfa_factors(user.admin_id):
            if factor.status != MfaFactorStatus.ACTIVE:
                continue
            if factor.factor_type != MfaFactorType.TOTP:
                continue
            if _totp_secret_is_configured(str(factor.payload.get("totpSecret") or "")):
                return True
        return False

    def _get_valid_enrollment_challenge(self, enrollment_token: str) -> AdminMfaEnrollmentChallenge:
        if not enrollment_token.strip():
            raise BadRequestError(ENROLLMENT_TOKEN_REQUIRED)
        token_hash = self._hash_enrollment_token(enrollment_token)
        challenge = self._store.identity.get_mfa_enrollment_challenge_by_token_hash(token_hash)
        if challenge is None:
            raise AuthenticationError(INVALID_MFA_ENROLLMENT_TOKEN)
        now = datetime.now(timezone.utc)
        if challenge.expires_at and challenge.expires_at <= now:
            self._store.identity.upsert_mfa_enrollment_challenge(
                AdminMfaEnrollmentChallenge(
                    challenge_id=challenge.challenge_id,
                    admin_id=challenge.admin_id,
                    challenge_token_hash=challenge.challenge_token_hash,
                    status=MfaEnrollmentChallengeStatus.EXPIRED,
                    factor_id=challenge.factor_id,
                    client_ip=challenge.client_ip,
                    user_agent=challenge.user_agent,
                    request_id=challenge.request_id,
                    expires_at=challenge.expires_at,
                    issued_at=challenge.issued_at,
                    verified_at=challenge.verified_at,
                    created_at=challenge.created_at,
                    updated_at=now,
                )
            )
            raise AuthenticationError(MFA_ENROLLMENT_TOKEN_EXPIRED)
        if challenge.status != MfaEnrollmentChallengeStatus.ISSUED:
            raise AuthenticationError(MFA_ENROLLMENT_TOKEN_NOT_VALID)
        return challenge

    def _get_or_create_pending_factor(
        self,
        user: AdminUser,
        challenge: AdminMfaEnrollmentChallenge,
        now: datetime,
    ) -> AdminMfaFactor:
        factor = self._store.identity.get_mfa_factor_by_id(challenge.factor_id) if challenge.factor_id else None
        if factor is None:
            factor = self._find_reusable_enrollment_factor(user)
        factor_id = factor.factor_id if factor else uuid4().hex
        created_at = factor.created_at if factor else now
        candidate_secret = str(factor.payload.get("totpSecret") or "").strip() if factor else ""
        existing_secret = candidate_secret if _totp_secret_is_configured(candidate_secret) else ""
        factor = self._store.identity.upsert_mfa_factor(
            AdminMfaFactor(
                factor_id=factor_id,
                admin_id=user.admin_id,
                factor_type=MfaFactorType.TOTP,
                factor_label=factor.factor_label if factor else "primary",
                status=MfaFactorStatus.PENDING,
                secret_ref=None,
                payload={"totpSecret": existing_secret or generate_totp_secret()},
                last_verified_at=None,
                created_at=created_at,
                updated_at=now,
                revoked_at=None,
            )
        )
        self._store.identity.upsert_mfa_enrollment_challenge(
            AdminMfaEnrollmentChallenge(
                challenge_id=challenge.challenge_id,
                admin_id=challenge.admin_id,
                challenge_token_hash=challenge.challenge_token_hash,
                status=challenge.status,
                factor_id=factor.factor_id,
                client_ip=challenge.client_ip,
                user_agent=challenge.user_agent,
                request_id=challenge.request_id,
                expires_at=challenge.expires_at,
                issued_at=challenge.issued_at,
                verified_at=challenge.verified_at,
                created_at=challenge.created_at,
                updated_at=now,
            )
        )
        return factor

    def _find_reusable_enrollment_factor(self, user: AdminUser) -> AdminMfaFactor | None:
        primary_candidate: AdminMfaFactor | None = None
        for candidate in self._store.identity.list_mfa_factors(user.admin_id):
            if candidate.factor_type != MfaFactorType.TOTP:
                continue
            if candidate.status != MfaFactorStatus.ACTIVE:
                return candidate
            if candidate.factor_label != "primary":
                continue
            if not _totp_secret_is_configured(str(candidate.payload.get("totpSecret") or "")):
                primary_candidate = candidate
        return primary_candidate

    def _hash_enrollment_token(self, token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def _mask_email(self, email: str) -> str:
        local_part, at, domain = email.partition("@")
        if not at:
            return "***"
        masked_local = (
            f"{local_part[:1]}***"
            if len(local_part) <= SHORT_EMAIL_LOCAL_PART_MAX
            else f"{local_part[:2]}***"
        )
        return f"{masked_local}@{domain}"

    def _email_hash(self, email: str) -> str:
        normalized = email.strip().lower()
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]

    def _verify_login_otp(self, user: AdminUser, otp_code: str | None) -> None:
        policy = self.get_security_policy()
        if not user.require_mfa:
            return
        if not policy.login_totp_required:
            return
        factor = self._get_active_totp_factor(user)
        if not (otp_code or "").strip():
            raise BadRequestError(LOGIN_TOTP_CODE_REQUIRED)
        if not _totp_secret_is_configured(str(factor.payload.get("totpSecret") or "")):
            raise AuthenticationError(ADMIN_GOOGLE_AUTHENTICATOR_NOT_CONFIGURED)
        if not verify_google_authenticator_code(factor, otp_code or ""):
            raise AuthenticationError(INVALID_GOOGLE_AUTHENTICATOR_CODE)

    def _get_active_totp_factor(self, user: AdminUser) -> AdminMfaFactor:
        active_factors: list[AdminMfaFactor] = []
        for factor in self._store.identity.list_mfa_factors(user.admin_id):
            if factor.status != MfaFactorStatus.ACTIVE:
                continue
            if factor.factor_type != MfaFactorType.TOTP:
                continue
            if _totp_secret_is_configured(str(factor.payload.get("totpSecret") or "")):
                active_factors.append(factor)
        if not active_factors:
            raise AuthenticationError(ADMIN_GOOGLE_AUTHENTICATOR_NOT_CONFIGURED)
        if len(active_factors) > 1:
            raise AuthenticationError(MULTIPLE_ACTIVE_GOOGLE_AUTHENTICATOR_FACTORS)
        return active_factors[0]

    def _revoked_totp_factor(self, factor: AdminMfaFactor, now: datetime) -> AdminMfaFactor:
        return AdminMfaFactor(
            factor_id=factor.factor_id,
            admin_id=factor.admin_id,
            factor_type=factor.factor_type,
            factor_label=factor.factor_label,
            status=MfaFactorStatus.REVOKED,
            secret_ref=factor.secret_ref,
            payload=factor.payload,
            last_verified_at=factor.last_verified_at,
            created_at=factor.created_at,
            updated_at=now,
            revoked_at=now,
        )
