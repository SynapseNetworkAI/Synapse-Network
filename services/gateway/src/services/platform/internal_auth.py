from __future__ import annotations

import asyncio
import hashlib
import time
from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException, Request

from src.core.common import normalize_wallet
from src.core.config import settings
from src.core.redis_client import get_redis_client

AuthorizationHeader = Annotated[str | None, Header(alias="Authorization")]

_fallback_replay_cache: dict[str, int] = {}
_fallback_replay_lock = asyncio.Lock()


@dataclass(frozen=True)
class InternalServicePrincipal:
    service_subject: str
    admin_wallet: str
    actor_admin_id: str
    actor_role: str
    request_id: str
    scope: str
    token_id: str


def _parse_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail={"code": "UNAUTHORIZED", "message": "Missing bearer token"},
        )
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(
            status_code=401,
            detail={"code": "UNAUTHORIZED", "message": "Invalid Authorization header"},
        )
    return token.strip()


def _body_sha256(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def _decode_internal_token(token: str) -> dict:
    try:
        return jwt.decode(
            token,
            settings.gateway_internal_jwt_secret,
            algorithms=["HS256"],
            audience=settings.gateway_internal_token_audience,
            issuer=settings.gateway_internal_token_issuer,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=401,
            detail={"code": "INTERNAL_TOKEN_INVALID", "message": "Invalid internal service token"},
        ) from exc


def _validate_service_subject(payload: dict) -> str:
    service_subject = str(payload.get("sub") or "").strip()
    if service_subject not in settings.gateway_internal_service_subjects:
        raise HTTPException(
            status_code=403,
            detail={"code": "FORBIDDEN", "message": "Internal service subject is not allowed"},
        )
    return service_subject


def _validate_admin_wallet(payload: dict) -> str:
    admin_wallet = normalize_wallet(str(payload.get("adminWallet") or ""))
    if not admin_wallet:
        raise HTTPException(
            status_code=401,
            detail={"code": "INTERNAL_TOKEN_INVALID", "message": "Internal token adminWallet is required"},
        )
    if admin_wallet not in settings.platform_fee_admin_wallets:
        raise HTTPException(
            status_code=403,
            detail={"code": "FORBIDDEN", "message": "Internal admin wallet is not allow-listed"},
        )
    return admin_wallet


def _extract_claim(value: str, claim_name: str) -> str:
    normalized = str(value or "").strip()
    if normalized:
        return normalized
    raise HTTPException(
        status_code=401,
        detail={"code": "INTERNAL_TOKEN_INVALID", "message": f"Internal token {claim_name} is required"},
    )


def _resolve_request_id(payload: dict, request: Request) -> str:
    return _extract_claim(
        str(payload.get("requestId") or request.headers.get("X-Request-Id") or ""),
        "requestId",
    )


async def _validate_body_digest(payload: dict, request: Request) -> None:
    body_sha256 = _extract_claim(str(payload.get("bodySha256") or ""), "bodySha256").lower()
    actual_body_sha256 = _body_sha256(await request.body())
    if body_sha256 != actual_body_sha256:
        raise HTTPException(
            status_code=401,
            detail={"code": "INTERNAL_TOKEN_INVALID", "message": "Internal token body digest mismatch"},
        )


def _resolve_token_ttl(payload: dict) -> int:
    exp = int(payload.get("exp") or 0)
    iat = int(payload.get("iat") or 0)
    return max(1, exp - min(iat or exp, exp))


async def _claim_internal_token_id(token_id: str, ttl_sec: int) -> None:
    if not token_id:
        raise HTTPException(
            status_code=401,
            detail={"code": "INTERNAL_TOKEN_INVALID", "message": "Internal token jti is required"},
        )
    now = int(time.time())
    redis_client = await get_redis_client()
    if redis_client is not None:
        redis_key = f"gateway:internal-auth:jti:{token_id}"
        claimed = await redis_client.set(redis_key, str(now), ex=max(1, ttl_sec), nx=True)
        if claimed:
            return
        raise HTTPException(
            status_code=409,
            detail={"code": "INTERNAL_TOKEN_REPLAYED", "message": "Internal token replay detected"},
        )

    async with _fallback_replay_lock:
        expired = [key for key, expiry in _fallback_replay_cache.items() if expiry <= now]
        for key in expired:
            _fallback_replay_cache.pop(key, None)
        if token_id in _fallback_replay_cache:
            raise HTTPException(
                status_code=409,
                detail={"code": "INTERNAL_TOKEN_REPLAYED", "message": "Internal token replay detected"},
            )
        _fallback_replay_cache[token_id] = now + max(1, ttl_sec)


async def require_internal_service_principal(
    request: Request,
    authorization: AuthorizationHeader = None,
) -> InternalServicePrincipal:
    token = _parse_bearer_token(authorization)
    payload = _decode_internal_token(token)
    service_subject = _validate_service_subject(payload)
    admin_wallet = _validate_admin_wallet(payload)
    scope = _extract_claim(str(payload.get("scope") or ""), "scope")
    actor_admin_id = _extract_claim(str(payload.get("actorAdminId") or ""), "actorAdminId")
    actor_role = _extract_claim(str(payload.get("actorRole") or ""), "actorRole")
    request_id = _resolve_request_id(payload, request)
    token_id = _extract_claim(str(payload.get("jti") or ""), "jti")
    await _validate_body_digest(payload, request)
    ttl_sec = _resolve_token_ttl(payload)
    await _claim_internal_token_id(token_id, ttl_sec)

    return InternalServicePrincipal(
        service_subject=service_subject,
        admin_wallet=admin_wallet,
        actor_admin_id=actor_admin_id,
        actor_role=actor_role,
        request_id=request_id,
        scope=scope,
        token_id=token_id,
    )


def require_internal_scope(expected_scope: str):
    def dependency(
        principal: Annotated[InternalServicePrincipal, Depends(require_internal_service_principal)],
    ) -> InternalServicePrincipal:
        if principal.scope != expected_scope:
            raise HTTPException(
                status_code=403,
                detail={"code": "FORBIDDEN", "message": f"Internal token scope {principal.scope} is not allowed"},
            )
        return principal

    return dependency
