import binascii
from dataclasses import dataclass

from src.core.config import get_settings
from src.core.totp import verify_totp_code
from src.core.totp_secret_store import factor_totp_secret
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
    secret = factor_totp_secret(factor).strip()
    if not secret:
        return False
    settings = get_settings()
    try:
        return verify_totp_code(
            secret,
            code,
            window=settings.admin_google_authenticator_window,
        )
    except (binascii.Error, ValueError):
        # Invalid stored TOTP material must fail closed, not turn auth into a 500.
        return False
