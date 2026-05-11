from __future__ import annotations

import base64
import hashlib
import os
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from src.core.config import get_settings
from src.core.totp_secret_constants import (
    BOOTSTRAP_TOTP_MARKER,
    DEFAULT_LOCAL_TOTP_ENCRYPTION_KEY,
    INLINE_FERNET_SECRET_REF_PREFIX,
    MASKED_SECRET_SHORT_LEN,
)
from src.domain import AdminMfaFactor


def normalize_totp_secret(secret: str) -> str:
    return secret.strip().upper()


def is_totp_secret_configured(secret: str) -> bool:
    normalized = normalize_totp_secret(secret)
    return bool(normalized) and normalized != BOOTSTRAP_TOTP_MARKER


def totp_secret_fingerprint(secret: str) -> str | None:
    normalized = normalize_totp_secret(secret)
    if not is_totp_secret_configured(normalized):
        return None
    return hashlib.md5(normalized.encode("utf-8")).hexdigest()  # noqa: S324 - non-cryptographic uniqueness fingerprint only.


def masked_totp_secret(secret: str) -> str:
    normalized = normalize_totp_secret(secret)
    if not normalized:
        return ""
    if len(normalized) <= MASKED_SECRET_SHORT_LEN:
        return f"{normalized[:2]}***{normalized[-2:]}"
    return f"{normalized[:4]}***{normalized[-4:]}"


def totp_secret_store_key(raw_key: str | None = None) -> str:
    if raw_key and raw_key.strip():
        return raw_key.strip()

    env_candidate = os.environ.get("ADMIN_TOTP_SECRET_ENCRYPTION_KEY", "").strip()
    if env_candidate:
        return env_candidate

    settings = get_settings()
    candidate = settings.admin_totp_secret_encryption_key.strip()
    if candidate:
        return candidate
    return DEFAULT_LOCAL_TOTP_ENCRYPTION_KEY


def build_inline_totp_secret_ref(secret: str, *, encryption_key: str | None = None) -> str:
    normalized = normalize_totp_secret(secret)
    if not normalized:
        raise ValueError("missing_totp_secret")
    key = totp_secret_store_key(encryption_key)
    token = Fernet(key.encode("utf-8")).encrypt(normalized.encode("utf-8")).decode("utf-8")
    return f"{INLINE_FERNET_SECRET_REF_PREFIX}{token}"


def payload_totp_metadata(secret: str, *, migrated: bool = False) -> dict[str, Any]:
    normalized = normalize_totp_secret(secret)
    payload: dict[str, Any] = {
        "secretStorage": "secret_ref",
        "maskedSecret": masked_totp_secret(normalized),
    }
    if migrated:
        payload["migratedFromPayloadJson"] = True
    return payload


def decrypt_inline_totp_secret_ref(secret_ref: str, *, encryption_key: str | None = None) -> str:
    if not secret_ref.startswith(INLINE_FERNET_SECRET_REF_PREFIX):
        raise ValueError("unsupported_totp_secret_ref")
    token = secret_ref.removeprefix(INLINE_FERNET_SECRET_REF_PREFIX).strip()
    key = totp_secret_store_key(encryption_key)
    plaintext = Fernet(key.encode("utf-8")).decrypt(token.encode("utf-8")).decode("utf-8")
    return normalize_totp_secret(plaintext)


def factor_totp_secret(factor: AdminMfaFactor, *, encryption_key: str | None = None) -> str:
    if factor.secret_ref and factor.secret_ref.startswith(INLINE_FERNET_SECRET_REF_PREFIX):
        try:
            return decrypt_inline_totp_secret_ref(factor.secret_ref, encryption_key=encryption_key)
        except (InvalidToken, ValueError, TypeError, base64.binascii.Error):
            return ""
    legacy_secret = str(factor.payload.get("totpSecret") or "")
    return normalize_totp_secret(legacy_secret)
