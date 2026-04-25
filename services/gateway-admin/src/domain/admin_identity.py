from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from src.domain.enums import AdminSessionStatus, AdminUserStatus, AuthSource, MfaEnrollmentChallengeStatus, MfaFactorStatus, MfaFactorType


@dataclass(slots=True, frozen=True)
class AdminUser:
    admin_id: str
    email: str
    display_name: str
    status: AdminUserStatus = AdminUserStatus.ACTIVE
    auth_source: AuthSource = AuthSource.BOOTSTRAP
    sso_subject: str | None = None
    password_hash: str | None = None
    require_mfa: bool = True
    last_login_at: datetime | None = None
    failed_login_attempts: int = 0
    last_failed_login_at: datetime | None = None
    locked_until: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    disabled_at: datetime | None = None


@dataclass(slots=True, frozen=True)
class AdminMfaFactor:
    factor_id: str
    admin_id: str
    factor_type: MfaFactorType
    factor_label: str
    status: MfaFactorStatus = MfaFactorStatus.PENDING
    secret_ref: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    last_verified_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    revoked_at: datetime | None = None


@dataclass(slots=True, frozen=True)
class AdminSession:
    session_id: str
    admin_id: str
    token_jti: str
    expires_at: datetime
    refresh_token_hash: str | None = None
    status: AdminSessionStatus = AdminSessionStatus.ACTIVE
    mfa_verified_at: datetime | None = None
    client_ip: str | None = None
    user_agent: str | None = None
    issued_at: datetime | None = None
    last_seen_at: datetime | None = None
    revoked_at: datetime | None = None
    created_at: datetime | None = None


@dataclass(slots=True, frozen=True)
class AdminMfaEnrollmentChallenge:
    challenge_id: str
    admin_id: str
    challenge_token_hash: str
    status: MfaEnrollmentChallengeStatus = MfaEnrollmentChallengeStatus.ISSUED
    factor_id: str | None = None
    client_ip: str | None = None
    user_agent: str | None = None
    request_id: str | None = None
    expires_at: datetime | None = None
    issued_at: datetime | None = None
    verified_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
