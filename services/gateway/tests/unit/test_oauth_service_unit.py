from __future__ import annotations

import base64
import hashlib
from types import SimpleNamespace

import jwt  # type: ignore[import-untyped]  # quality-disable-reason: PyJWT ships without complete type stubs in the gateway venv.
import pytest
from fastapi import HTTPException

from src.services.platform import credential_service, oauth_service
from src.services.platform.credential_builders import (
    CredentialRuntimeSeed,
    build_runtime_credential_record,
)
from src.utils.datetime_utils import now_dt_str


class _RuntimeStateRepo:
    def __init__(self) -> None:
        self.rows: dict[str, dict] = {}

    def read_runtime_state(self, state_key: str):
        return dict(self.rows.get(state_key, {}))

    def write_runtime_state(self, state_key: str, payload: dict) -> None:
        self.rows[state_key] = dict(payload)


class _CredentialAuthRepo:
    def __init__(self, rows) -> None:
        self.rows = list(rows)

    def read_credential_rows(self, credential_type: str):
        if credential_type != "agent":
            return []
        return list(self.rows)


class _FakeStorage:
    def __init__(self, credential_rows) -> None:
        self.runtime_state = _RuntimeStateRepo()
        self.credential_auth = _CredentialAuthRepo(credential_rows)

    def get_data_manager(self):
        return SimpleNamespace(
            system=SimpleNamespace(
                gateway_state=self.runtime_state,
                credential_auth=self.credential_auth,
            )
        )


def _pkce_pair() -> tuple[str, str]:
    verifier = "test-verifier-with-enough-length"
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode("ascii")).digest()
    ).decode("ascii").rstrip("=")
    return verifier, challenge


def _credential(owner: str = "0xabc"):
    now = credential_service.now_ts()
    return build_runtime_credential_record(
        CredentialRuntimeSeed(
            credential_type="agent",
            owner_wallet=owner,
            credential_id="cred-chatgpt",
            display_name="ChatGPT Remote MCP",
            token_hash_value=credential_service.hash_token("agt_secret"),
            token_prefix_value="agt_secret",
            status="active",
            max_calls=200,
            calls_used=0,
            rpm=60,
            credit_limit=5.0,
            reset_interval="daily",
            expiration=None,
            created_at=now_dt_str(),
            updated_at=now_dt_str(),
            expires_at=now + 3600,
            revoked_at=None,
        )
    )


@pytest.fixture()
def oauth_settings(monkeypatch):
    monkeypatch.setenv("SYNAPSE_OAUTH_ISSUER", "https://www.synapse-network.ai")
    monkeypatch.setenv("SYNAPSE_OAUTH_MCP_RESOURCE", "https://mcp.synapse-network.ai/mcp")
    monkeypatch.setenv("SYNAPSE_OAUTH_ALLOWED_REDIRECT_HOSTS", "chatgpt.com")
    monkeypatch.setenv("SYNAPSE_OAUTH_ALLOWED_CLIENT_IDS", "chatgpt-custom-mcp")
    monkeypatch.setenv("SYNAPSE_OAUTH_AUTHORIZATION_CODE_TTL_SEC", "300")
    monkeypatch.setenv("SYNAPSE_OAUTH_ACCESS_TOKEN_TTL_SEC", "900")
    monkeypatch.setenv("SYNAPSE_OAUTH_REFRESH_TOKEN_TTL_SEC", "3600")
    monkeypatch.setenv("SYNAPSE_OAUTH_JWT_SECRET", "unit-test-oauth-secret-with-32-bytes")


def _authorize_request(challenge: str) -> oauth_service.OAuthAuthorizeRequest:
    return oauth_service.OAuthAuthorizeRequest(
        client_id="chatgpt-custom-mcp",
        redirect_uri="https://chatgpt.com/oauth/callback",
        response_type="code",
        scope="synapse.discovery.read synapse.receipts.read offline_access",
        state="state-1",
        code_challenge=challenge,
        code_challenge_method="S256",
        resource="https://mcp.synapse-network.ai/mcp",
        credential_id="cred-chatgpt",
    )


def _codex_authorize_request(challenge: str, redirect_uri: str) -> oauth_service.OAuthAuthorizeRequest:
    return oauth_service.OAuthAuthorizeRequest(
        client_id="codex",
        redirect_uri=redirect_uri,
        response_type="code",
        scope="synapse.discovery.read synapse.receipts.read offline_access",
        state="state-codex",
        code_challenge=challenge,
        code_challenge_method="S256",
        resource="https://mcp.synapse-network.ai/mcp",
        credential_id="cred-chatgpt",
    )


def test_oauth_code_exchange_and_runtime_resolution(oauth_settings) -> None:
    storage = _FakeStorage([_credential()])
    verifier, challenge = _pkce_pair()
    redirect_url = oauth_service.create_authorization_code(
        storage,
        "0xabc",
        _authorize_request(challenge),
    )
    code = redirect_url.split("code=", 1)[1].split("&", 1)[0]

    token_response = oauth_service.exchange_token(
        storage,
        {
            "grant_type": "authorization_code",
            "client_id": "chatgpt-custom-mcp",
            "redirect_uri": "https://chatgpt.com/oauth/callback",
            "code": code,
            "code_verifier": verifier,
        },
    )

    decoded = jwt.decode(
        token_response.access_token,
        oauth_service.oauth_jwt_secret(),
        algorithms=["HS256"],
        audience=oauth_service.oauth_mcp_resource(),
        issuer=oauth_service.oauth_issuer(),
    )
    assert decoded["credential_id"] == "cred-chatgpt"
    assert decoded["token_use"] == "synapse_mcp_access"
    assert token_response.refresh_token

    credential = oauth_service.resolve_runtime_credential(
        storage,
        f"Bearer {token_response.access_token}",
        required_scope="synapse.receipts.read",
    )
    assert credential.credential.credential_id == "cred-chatgpt"

    with pytest.raises(HTTPException) as reused:
        oauth_service.exchange_token(
            storage,
            {
                "grant_type": "authorization_code",
                "client_id": "chatgpt-custom-mcp",
                "redirect_uri": "https://chatgpt.com/oauth/callback",
                "code": code,
                "code_verifier": verifier,
            },
        )
    assert reused.value.status_code == 400


def test_oauth_defaults_allow_codex_local_callback(monkeypatch) -> None:
    monkeypatch.setenv("SYNAPSE_OAUTH_ISSUER", "https://www.synapse-network.ai")
    monkeypatch.setenv("SYNAPSE_OAUTH_MCP_RESOURCE", "https://mcp.synapse-network.ai/mcp")
    monkeypatch.delenv("SYNAPSE_OAUTH_ALLOWED_REDIRECT_HOSTS", raising=False)
    monkeypatch.delenv("SYNAPSE_OAUTH_ALLOWED_CLIENT_IDS", raising=False)
    monkeypatch.setenv("SYNAPSE_OAUTH_JWT_SECRET", "unit-test-oauth-secret-with-32-bytes")
    storage = _FakeStorage([_credential()])
    _, challenge = _pkce_pair()

    redirect_url = oauth_service.create_authorization_code(
        storage,
        "0xabc",
        _codex_authorize_request(challenge, "http://127.0.0.1:4321/callback"),
    )

    assert redirect_url.startswith("http://127.0.0.1:4321/callback?code=syn_code_")


def test_oauth_defaults_reject_untrusted_codex_redirect(monkeypatch) -> None:
    monkeypatch.setenv("SYNAPSE_OAUTH_ISSUER", "https://www.synapse-network.ai")
    monkeypatch.setenv("SYNAPSE_OAUTH_MCP_RESOURCE", "https://mcp.synapse-network.ai/mcp")
    monkeypatch.delenv("SYNAPSE_OAUTH_ALLOWED_REDIRECT_HOSTS", raising=False)
    monkeypatch.delenv("SYNAPSE_OAUTH_ALLOWED_CLIENT_IDS", raising=False)
    storage = _FakeStorage([_credential()])
    _, challenge = _pkce_pair()

    with pytest.raises(HTTPException) as rejected:
        oauth_service.create_authorization_code(
            storage,
            "0xabc",
            _codex_authorize_request(challenge, "https://evil.example/callback"),
        )

    assert rejected.value.status_code == 400


def test_oauth_scope_gate_and_refresh_rotation(oauth_settings) -> None:
    storage = _FakeStorage([_credential()])
    verifier, challenge = _pkce_pair()
    redirect_url = oauth_service.create_authorization_code(
        storage,
        "0xabc",
        _authorize_request(challenge),
    )
    code = redirect_url.split("code=", 1)[1].split("&", 1)[0]
    token_response = oauth_service.exchange_token(
        storage,
        {
            "grant_type": "authorization_code",
            "client_id": "chatgpt-custom-mcp",
            "redirect_uri": "https://chatgpt.com/oauth/callback",
            "code": code,
            "code_verifier": verifier,
        },
    )

    with pytest.raises(HTTPException) as missing_scope:
        oauth_service.resolve_runtime_credential(
            storage,
            f"Bearer {token_response.access_token}",
            required_scope="synapse.invocations.write",
        )
    assert missing_scope.value.status_code == 403

    rotated = oauth_service.exchange_token(
        storage,
        {
            "grant_type": "refresh_token",
            "refresh_token": token_response.refresh_token or "",
        },
    )
    assert rotated.refresh_token
    assert rotated.refresh_token != token_response.refresh_token

    with pytest.raises(HTTPException) as old_refresh:
        oauth_service.exchange_token(
            storage,
            {
                "grant_type": "refresh_token",
                "refresh_token": token_response.refresh_token or "",
            },
        )
    assert old_refresh.value.status_code == 400
