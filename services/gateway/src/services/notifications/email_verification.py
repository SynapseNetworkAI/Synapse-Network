from __future__ import annotations

import hashlib
import hmac
import secrets

from src.core.common import normalize_wallet
from src.core.config import settings

EMAIL_VERIFICATION_CODE_DIGITS = 6


def create_email_verification_code() -> str:
    """Return a zero-padded numeric code suitable for email copy/paste."""

    upper_bound = 10**EMAIL_VERIFICATION_CODE_DIGITS
    return f"{secrets.randbelow(upper_bound):0{EMAIL_VERIFICATION_CODE_DIGITS}d}"


def hash_email_verification_code(
    *,
    owner_wallet: str,
    email: str,
    code: str,
) -> str:
    normalized_owner = normalize_wallet(owner_wallet)
    normalized_email = str(email or "").strip().lower()
    normalized_code = "".join(ch for ch in str(code or "").strip() if ch.isdigit())
    payload = f"{normalized_owner}|{normalized_email}|{normalized_code}".encode("utf-8")
    return hmac.new(
        settings.auth_secret.encode("utf-8"),
        payload,
        hashlib.sha256,
    ).hexdigest()


def is_valid_email_verification_code_shape(code: str) -> bool:
    normalized_code = str(code or "").strip()
    return (
        len(normalized_code) == EMAIL_VERIFICATION_CODE_DIGITS
        and normalized_code.isdigit()
    )
