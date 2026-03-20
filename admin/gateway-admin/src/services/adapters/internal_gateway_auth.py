from __future__ import annotations

import hashlib
import json
import time
from typing import Any
from uuid import uuid4

import jwt

from src.services.auth.service import AdminIdentity


def payload_digest(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def build_internal_service_token(
    *,
    jwt_secret: str,
    issuer: str,
    audience: str,
    service_subject: str,
    admin_wallet: str,
    scope: str,
    request_id: str,
    body_sha256: str,
    actor: AdminIdentity,
    ttl_sec: int = 120,
) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "iss": issuer,
            "aud": audience,
            "sub": service_subject,
            "adminWallet": admin_wallet,
            "scope": scope,
            "requestId": request_id,
            "bodySha256": body_sha256,
            "actorAdminId": actor.admin_id,
            "actorRole": actor.role,
            "iat": now,
            "exp": now + ttl_sec,
            "jti": uuid4().hex,
        },
        jwt_secret,
        algorithm="HS256",
    )
