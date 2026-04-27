from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any
from urllib.parse import urlencode

from src.core.common import normalize_wallet
from src.core.config import settings


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def create_email_verification_token(*, owner_wallet: str, email: str) -> str:
    """Create a compact signed token without storing raw verification state."""

    payload = {
        "owner": normalize_wallet(owner_wallet),
        "email": str(email or "").strip().lower(),
        "exp": int(time.time()) + int(settings.email_verification_ttl_sec),
    }
    payload_part = _b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = hmac.new(
        settings.auth_secret.encode("utf-8"),
        payload_part.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return f"{payload_part}.{_b64url_encode(signature)}"


def verify_email_verification_token(token: str) -> dict[str, Any] | None:
    try:
        payload_part, signature_part = str(token or "").split(".", 1)
        expected = hmac.new(
            settings.auth_secret.encode("utf-8"),
            payload_part.encode("ascii"),
            hashlib.sha256,
        ).digest()
        actual = _b64url_decode(signature_part)
        if not hmac.compare_digest(actual, expected):
            return None
        payload = json.loads(_b64url_decode(payload_part).decode("utf-8"))
    except Exception:
        return None
    if int(payload.get("exp") or 0) < int(time.time()):
        return None
    owner = normalize_wallet(payload.get("owner") or "")
    email = str(payload.get("email") or "").strip().lower()
    if not owner or not email:
        return None
    return {"owner": owner, "email": email}


def build_email_verification_url(*, owner_wallet: str, email: str) -> str:
    token = create_email_verification_token(owner_wallet=owner_wallet, email=email)
    base = settings.public_gateway_base_url or ""
    path = "/api/v1/auth/email/verify"
    query = urlencode({"v": token})
    return f"{base}{path}?{query}" if base else f"{path}?{query}"
