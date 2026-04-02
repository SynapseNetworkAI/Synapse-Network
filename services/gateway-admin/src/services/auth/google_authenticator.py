from dataclasses import dataclass

from src.core.config import get_settings
from src.core.totp import verify_totp_code
from src.domain import AdminMfaFactor


@dataclass(frozen=True)
class AdminGoogleAuthenticatorPolicy:
    login_totp_required: bool
    high_risk_totp_required: bool
    issuer: str


def build_google_authenticator_policy() -> AdminGoogleAuthenticatorPolicy:
    settings = get_settings()
    return AdminGoogleAuthenticatorPolicy(
        login_totp_required=settings.admin_google_authenticator_login_enabled,
        high_risk_totp_required=settings.admin_google_authenticator_high_risk_enabled,
        issuer=settings.admin_google_authenticator_issuer,
    )


def verify_google_authenticator_code(factor: AdminMfaFactor, code: str) -> bool:
    secret = str(factor.payload.get("totpSecret") or "").strip()
    if not secret:
        return False
    settings = get_settings()
    return verify_totp_code(
        secret,
        code,
        window=settings.admin_google_authenticator_window,
    )