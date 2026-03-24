from __future__ import annotations

import hashlib
import hmac
import json

from fastapi import HTTPException, Request

from app.core.config import get_settings


def _payload_digest(body: bytes) -> str:
    try:
        payload = json.loads(body.decode("utf-8") or "{}")
    except Exception:
        payload = body.decode("utf-8", errors="ignore")
    canonical = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _expected_signature(service_id: str, signed_at: str, body: bytes) -> str:
    settings = get_settings()
    canonical = f"{service_id}.{signed_at}.{_payload_digest(body)}"
    secret = settings.gateway_provider_signature_secret.encode("utf-8")
    return hmac.new(secret, canonical.encode("utf-8"), hashlib.sha256).hexdigest()


async def require_gateway_signature(request: Request, service_id: str) -> None:
    settings = get_settings()
    if not settings.gateway_provider_signature_enabled:
        return

    signed_service_id = str(request.headers.get("X-Synapse-Service-Id") or "").strip()
    signed_at = str(request.headers.get("X-Synapse-Signed-At") or "").strip()
    signature = str(request.headers.get("X-Synapse-Signature") or "").strip()

    if signed_service_id != service_id or not signed_at or not signature:
        raise HTTPException(
            status_code=401,
            detail={
                "code": "GATEWAY_SIGNATURE_REQUIRED",
                "message": "Gateway-signed provider invocation headers are required",
            },
        )

    body = await request.body()
    expected = _expected_signature(service_id, signed_at, body)
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(
            status_code=401,
            detail={
                "code": "GATEWAY_SIGNATURE_INVALID",
                "message": "Gateway-signed provider invocation headers are invalid",
            },
        )
