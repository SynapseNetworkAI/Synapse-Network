"""First-party OAuth bridge for hosted MCP clients."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import parse_qs, urlencode, urlparse

import jwt  # type: ignore[import-untyped]  # quality-disable-reason: PyJWT ships without complete type stubs in the gateway venv.
from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.config import settings
from src.domain.identity import RuntimeCredentialRecord
from src.services.platform import credential_lookup, credential_service
from src.storage import BaseStorage

READ_SCOPES = {"synapse.discovery.read", "synapse.receipts.read"}
WRITE_SCOPES = {"synapse.invocations.write"}
SYSTEM_SCOPES = {"offline_access"}
ALLOWED_SCOPES = READ_SCOPES | WRITE_SCOPES | SYSTEM_SCOPES

DEFAULT_READ_SCOPES = "synapse.discovery.read synapse.receipts.read offline_access"
ACCESS_TOKEN_USE = "synapse_mcp_access"


def oauth_issuer() -> str:
    return _env_str("SYNAPSE_OAUTH_ISSUER", "https://www.synapse-network.ai").rstrip("/")


def oauth_mcp_resource() -> str:
    return _env_str("SYNAPSE_OAUTH_MCP_RESOURCE", "https://mcp.synapse-network.ai/mcp").rstrip("/")


def oauth_jwt_secret() -> str:
    return _env_str("SYNAPSE_OAUTH_JWT_SECRET", settings.jwt_secret)


def oauth_access_token_ttl_sec() -> int:
    return max(60, _env_int("SYNAPSE_OAUTH_ACCESS_TOKEN_TTL_SEC", 900))


def oauth_refresh_token_ttl_sec() -> int:
    return max(3600, _env_int("SYNAPSE_OAUTH_REFRESH_TOKEN_TTL_SEC", 30 * 24 * 60 * 60))


def oauth_authorization_code_ttl_sec() -> int:
    return max(60, _env_int("SYNAPSE_OAUTH_AUTHORIZATION_CODE_TTL_SEC", 300))


def oauth_allowed_client_ids() -> set[str]:
    return _env_csv("SYNAPSE_OAUTH_ALLOWED_CLIENT_IDS", "chatgpt-custom-mcp,chatgpt")


def oauth_allowed_redirect_hosts() -> set[str]:
    return _env_csv("SYNAPSE_OAUTH_ALLOWED_REDIRECT_HOSTS", "chatgpt.com,chat.openai.com")


@dataclass(frozen=True)
class OAuthAuthorizeRequest:
    client_id: str
    redirect_uri: str
    response_type: str
    scope: str
    state: Optional[str]
    code_challenge: str
    code_challenge_method: str
    resource: Optional[str]
    credential_id: str


@dataclass(frozen=True)
class OAuthTokenResponse:
    access_token: str
    token_type: str
    expires_in: int
    scope: str
    refresh_token: Optional[str] = None

    def to_response_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "access_token": self.access_token,
            "token_type": self.token_type,
            "expires_in": self.expires_in,
            "scope": self.scope,
        }
        if self.refresh_token:
            payload["refresh_token"] = self.refresh_token
        return payload


def authorization_server_metadata() -> dict[str, Any]:
    issuer = oauth_issuer()
    return {
        "issuer": issuer,
        "authorization_endpoint": f"{issuer}/oauth/authorize",
        "token_endpoint": f"{issuer}/oauth/token",
        "revocation_endpoint": f"{issuer}/oauth/revoke",
        "jwks_uri": f"{issuer}/.well-known/jwks.json",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": sorted(ALLOWED_SCOPES),
        "resource_documentation": oauth_mcp_resource(),
    }


def jwks_metadata() -> dict[str, Any]:
    # Access tokens are first-party HS256 JWTs validated by Synapse resource
    # servers with the configured shared secret. ChatGPT does not consume JWKS
    # for connector calls, but the endpoint exists for OAuth metadata discovery.
    return {"keys": []}


def parse_urlencoded_form(body: bytes) -> dict[str, str]:
    parsed = parse_qs(body.decode("utf-8"), keep_blank_values=True)
    return {key: values[-1] for key, values in parsed.items() if values}


def create_authorization_code(
    storage: BaseStorage,
    owner_wallet: str,
    request: OAuthAuthorizeRequest,
) -> str:
    _validate_authorize_request(request)
    owner = normalize_wallet(owner_wallet)
    credential = credential_lookup.resolve_active_credential_by_id(
        storage,
        request.credential_id,
        owner,
    )
    scopes = _parse_scopes(request.scope)
    now = _now()
    code = f"syn_code_{secrets.token_urlsafe(32)}"
    payload = {
        "status": "active",
        "clientId": request.client_id,
        "redirectUri": request.redirect_uri,
        "ownerWallet": owner,
        "credentialId": credential.credential.credential_id,
        "scope": sorted(scopes),
        "resource": _resource(request.resource),
        "codeChallenge": request.code_challenge,
        "codeChallengeMethod": request.code_challenge_method,
        "createdAt": now,
        "expiresAt": now + oauth_authorization_code_ttl_sec(),
    }
    _write_state(storage, _code_key(code), payload)
    return _redirect_with_code(request.redirect_uri, code, request.state)


def exchange_token(storage: BaseStorage, form: dict[str, str]) -> OAuthTokenResponse:
    grant_type = str(form.get("grant_type") or "").strip()
    if grant_type == "authorization_code":
        return _exchange_authorization_code(storage, form)
    if grant_type == "refresh_token":
        return _exchange_refresh_token(storage, form)
    raise HTTPException(
        status_code=400,
        detail={"error": "unsupported_grant_type", "error_description": "Unsupported grant_type"},
    )


def revoke_token(storage: BaseStorage, form: dict[str, str]) -> dict[str, str]:
    token = str(form.get("token") or "").strip()
    if not token:
        return {"status": "ok"}
    refresh_key = _refresh_key(token)
    refresh_state = _read_state(storage, refresh_key)
    if refresh_state:
        refresh_state["status"] = "revoked"
        refresh_state["revokedAt"] = _now()
        _write_state(storage, refresh_key, refresh_state)
        return {"status": "ok"}
    try:
        payload = jwt.decode(
            token,
            oauth_jwt_secret(),
            algorithms=["HS256"],
            audience=oauth_mcp_resource(),
            issuer=oauth_issuer(),
        )
    except Exception:
        return {"status": "ok"}
    jti = str(payload.get("jti") or "")
    if jti:
        _write_state(storage, _access_revoke_key(jti), {"status": "revoked", "revokedAt": _now()})
    return {"status": "ok"}


def resolve_runtime_credential(
    storage: BaseStorage,
    authorization_header: Optional[str],
    *,
    required_scope: Optional[str] = None,
) -> RuntimeCredentialRecord:
    token = credential_service.parse_authorization(authorization_header)
    try:
        payload = jwt.decode(
            token,
            oauth_jwt_secret(),
            algorithms=["HS256"],
            audience=oauth_mcp_resource(),
            issuer=oauth_issuer(),
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=401,
            detail={"code": "OAUTH_TOKEN_EXPIRED", "message": "OAuth access token expired"},
        ) from None
    except Exception:
        raise HTTPException(
            status_code=401,
            detail={"code": "OAUTH_TOKEN_INVALID", "message": "OAuth access token is invalid"},
        ) from None

    if str(payload.get("token_use") or "") != ACCESS_TOKEN_USE:
        raise HTTPException(
            status_code=401,
            detail={"code": "OAUTH_TOKEN_INVALID", "message": "OAuth token use is invalid"},
        )
    jti = str(payload.get("jti") or "")
    if jti and _read_state(storage, _access_revoke_key(jti)).get("status") == "revoked":
        raise HTTPException(
            status_code=401,
            detail={"code": "OAUTH_TOKEN_REVOKED", "message": "OAuth access token was revoked"},
        )
    scopes = _parse_scopes(str(payload.get("scope") or ""))
    if required_scope and required_scope not in scopes:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "OAUTH_SCOPE_REQUIRED",
                "message": f"OAuth token is missing required scope: {required_scope}",
            },
        )
    owner = normalize_wallet(str(payload.get("sub") or ""))
    credential_id = str(payload.get("credential_id") or "")
    return credential_lookup.resolve_active_credential_by_id(storage, credential_id, owner)


def _exchange_authorization_code(storage: BaseStorage, form: dict[str, str]) -> OAuthTokenResponse:
    code = str(form.get("code") or "").strip()
    state = _read_state(storage, _code_key(code))
    now = _now()
    if not code or not state or state.get("status") != "active" or int(state.get("expiresAt") or 0) <= now:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_grant", "error_description": "Authorization code is invalid or expired"},
        )
    client_id = str(form.get("client_id") or "").strip()
    redirect_uri = str(form.get("redirect_uri") or "").strip()
    if client_id != str(state.get("clientId") or "") or redirect_uri != str(state.get("redirectUri") or ""):
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_grant", "error_description": "Authorization code client binding mismatch"},
        )
    _validate_pkce(str(form.get("code_verifier") or ""), str(state.get("codeChallenge") or ""))
    state["status"] = "used"
    state["usedAt"] = now
    _write_state(storage, _code_key(code), state)
    return _issue_token_pair(storage, state)


def _exchange_refresh_token(storage: BaseStorage, form: dict[str, str]) -> OAuthTokenResponse:
    refresh_token = str(form.get("refresh_token") or "").strip()
    state = _read_state(storage, _refresh_key(refresh_token))
    now = _now()
    if not refresh_token or not state or state.get("status") != "active" or int(state.get("expiresAt") or 0) <= now:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_grant", "error_description": "Refresh token is invalid or expired"},
        )
    state["status"] = "rotated"
    state["rotatedAt"] = now
    _write_state(storage, _refresh_key(refresh_token), state)
    return _issue_token_pair(storage, state, rotate_refresh=True)


def _issue_token_pair(
    storage: BaseStorage,
    grant_state: dict[str, Any],
    *,
    rotate_refresh: bool = False,
) -> OAuthTokenResponse:
    now = _now()
    scopes = [str(scope) for scope in grant_state.get("scope", [])]
    access_ttl = oauth_access_token_ttl_sec()
    jti = secrets.token_urlsafe(18)
    access_payload = {
        "iss": oauth_issuer(),
        "sub": grant_state["ownerWallet"],
        "aud": grant_state["resource"],
        "iat": now,
        "nbf": now,
        "exp": now + access_ttl,
        "jti": jti,
        "client_id": grant_state["clientId"],
        "credential_id": grant_state["credentialId"],
        "scope": " ".join(scopes),
        "token_use": ACCESS_TOKEN_USE,
    }
    access_token = jwt.encode(access_payload, oauth_jwt_secret(), algorithm="HS256")
    refresh_token = None
    if rotate_refresh or "offline_access" in scopes:
        refresh_token = f"syn_rt_{secrets.token_urlsafe(48)}"
        _write_state(
            storage,
            _refresh_key(refresh_token),
            {
                "status": "active",
                "clientId": grant_state["clientId"],
                "ownerWallet": grant_state["ownerWallet"],
                "credentialId": grant_state["credentialId"],
                "scope": scopes,
                "resource": grant_state["resource"],
                "createdAt": now,
                "expiresAt": now + oauth_refresh_token_ttl_sec(),
            },
        )
    return OAuthTokenResponse(
        access_token=access_token,
        token_type="Bearer",
        expires_in=access_ttl,
        scope=" ".join(scopes),
        refresh_token=refresh_token,
    )


def _validate_authorize_request(request: OAuthAuthorizeRequest) -> None:
    if request.response_type != "code":
        raise HTTPException(status_code=400, detail={"code": "INVALID_RESPONSE_TYPE", "message": "Only code is supported"})
    if request.code_challenge_method != "S256" or not request.code_challenge:
        raise HTTPException(status_code=400, detail={"code": "PKCE_REQUIRED", "message": "PKCE S256 is required"})
    _validate_client_id(request.client_id)
    _validate_redirect_uri(request.redirect_uri)
    _parse_scopes(request.scope)
    _resource(request.resource)


def _validate_client_id(client_id: str) -> None:
    value = str(client_id or "").strip()
    if value in oauth_allowed_client_ids():
        return
    parsed = urlparse(value)
    if parsed.scheme == "https" and _host_allowed(parsed.hostname or ""):
        return
    raise HTTPException(status_code=400, detail={"code": "INVALID_CLIENT", "message": "OAuth client is not allowed"})


def _validate_redirect_uri(redirect_uri: str) -> None:
    parsed = urlparse(str(redirect_uri or ""))
    if parsed.scheme != "https" or not _host_allowed(parsed.hostname or ""):
        raise HTTPException(
            status_code=400,
            detail={"code": "INVALID_REDIRECT_URI", "message": "OAuth redirect URI is not allowed"},
        )


def _host_allowed(hostname: str) -> bool:
    host = hostname.lower()
    return any(
        host == allowed_host or host.endswith(f".{allowed_host}")
        for allowed_host in oauth_allowed_redirect_hosts()
    )


def _validate_pkce(code_verifier: str, expected_challenge: str) -> None:
    if not code_verifier:
        raise HTTPException(status_code=400, detail={"error": "invalid_request", "error_description": "code_verifier is required"})
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    actual = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    if not hmac.compare_digest(actual, expected_challenge):
        raise HTTPException(status_code=400, detail={"error": "invalid_grant", "error_description": "PKCE verification failed"})


def _parse_scopes(raw_scope: str) -> set[str]:
    scopes = {item for item in str(raw_scope or DEFAULT_READ_SCOPES).split() if item}
    invalid = scopes - ALLOWED_SCOPES
    if invalid:
        raise HTTPException(status_code=400, detail={"code": "INVALID_SCOPE", "message": f"Unsupported scope: {sorted(invalid)[0]}"})
    return scopes


def _resource(raw_resource: Optional[str]) -> str:
    expected = oauth_mcp_resource()
    resource = str(raw_resource or expected).strip().rstrip("/")
    if resource != expected:
        raise HTTPException(status_code=400, detail={"code": "INVALID_RESOURCE", "message": "OAuth token resource is not allowed"})
    return resource


def _redirect_with_code(redirect_uri: str, code: str, state: Optional[str]) -> str:
    query = {"code": code}
    if state:
        query["state"] = state
    separator = "&" if "?" in redirect_uri else "?"
    return f"{redirect_uri}{separator}{urlencode(query)}"


def _read_state(storage: BaseStorage, key: str) -> dict[str, Any]:
    return dict(storage.get_data_manager().system.gateway_state.read_runtime_state(key) or {})


def _write_state(storage: BaseStorage, key: str, payload: dict[str, Any]) -> None:
    storage.get_data_manager().system.gateway_state.write_runtime_state(key, payload)


def _code_key(code: str) -> str:
    return f"oauth:code:{_hash_secret(code)}"


def _refresh_key(refresh_token: str) -> str:
    return f"oauth:refresh:{_hash_secret(refresh_token)}"


def _access_revoke_key(jti: str) -> str:
    return f"oauth:access-revoke:{jti}"


def _hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _now() -> int:
    return int(time.time())


def _env_str(name: str, default: str) -> str:
    return (os.getenv(name, default).strip() or default).strip()


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)).strip())
    except Exception:
        return default


def _env_csv(name: str, default: str) -> set[str]:
    raw = os.getenv(name, default)
    return {item.strip().lower() for item in raw.split(",") if item.strip()}
