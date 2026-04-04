"""Step 6: 创建 Agent Credential + 列表验证 + 新接口 (active_only / status / patch)"""
import httpx
import pytest
from tests.e2e.conftest import GATEWAY_BASE, SESSION_ID


CRED_NAME = f"e2e-agent-{SESSION_ID}"


def test_issue_agent_credential(owner_headers, session_state):
    r = httpx.post(
        f"{GATEWAY_BASE}/api/v1/credentials/agent/issue",
        headers=owner_headers,
        json={
            "name": CRED_NAME,
            "maxCalls": 200,
            "creditLimit": 5.0,
            "rpm": 60,
        },
        timeout=15,
    )
    assert r.status_code == 200, (
        f"Credential issue failed ({r.status_code}): {r.text}"
    )
    body = r.json()
    token = (
        body.get("token")
        or (body.get("credential") or {}).get("token")
        or body.get("credential_token")
    )
    cred_id = (
        body.get("credential_id")
        or body.get("id")
        or (body.get("credential") or {}).get("id")
        or (body.get("credential") or {}).get("credential_id")
    )
    assert token, f"agent token missing from response: {body}"
    assert cred_id, f"credential_id missing from response: {body}"

    session_state["agent_token"] = token
    session_state["credential_id"] = cred_id


def test_list_credentials_contains_issued(owner_headers):
    r = httpx.get(
        f"{GATEWAY_BASE}/api/v1/credentials/agent/list",
        headers=owner_headers,
        timeout=15,
    )
    assert r.status_code == 200, f"List credentials failed: {r.text}"
    creds = r.json().get("credentials", [])
    names = [c.get("name") for c in creds]
    assert CRED_NAME in names, (
        f"Credential '{CRED_NAME}' not found in list: {names}"
    )


def test_list_credentials_active_only(owner_headers, session_state):
    """active_only=true 只返回有效凭据，且包含刚创建的凭据。"""
    r = httpx.get(
        f"{GATEWAY_BASE}/api/v1/credentials/agent/list",
        headers=owner_headers,
        params={"active_only": "true"},
        timeout=15,
    )
    assert r.status_code == 200, f"active_only list failed: {r.text}"
    body = r.json()
    creds = body.get("credentials", [])
    # All returned credentials must have status == active
    for c in creds:
        assert c.get("status") == "active", f"non-active credential in active_only list: {c}"
    names = [c.get("name") for c in creds]
    assert CRED_NAME in names, (
        f"Issued credential '{CRED_NAME}' missing from active_only list: {names}"
    )


def test_get_credential_status(owner_headers, session_state):
    """GET {id}/status returns valid=true for a fresh active credential."""
    cred_id = session_state.get("credential_id")
    assert cred_id, "credential_id not set — run test_issue_agent_credential first"

    r = httpx.get(
        f"{GATEWAY_BASE}/api/v1/credentials/agent/{cred_id}/status",
        headers=owner_headers,
        timeout=15,
    )
    assert r.status_code == 200, f"credential status failed ({r.status_code}): {r.text}"
    body = r.json()
    assert body.get("valid") is True, f"expected valid=true: {body}"
    assert body.get("credentialStatus") == "active", f"expected active status: {body}"
    assert body.get("isExpired") is False, f"expected isExpired=false: {body}"
    assert body.get("credentialId") == cred_id, f"credentialId mismatch: {body}"


def test_patch_credential_name_and_quota(owner_headers, session_state):
    """PATCH {id} can update name + maxCalls atomically."""
    cred_id = session_state.get("credential_id")
    assert cred_id, "credential_id not set"

    new_name = f"{CRED_NAME}-renamed"
    r = httpx.patch(
        f"{GATEWAY_BASE}/api/v1/credentials/agent/{cred_id}",
        headers=owner_headers,
        json={"name": new_name, "maxCalls": 500},
        timeout=15,
    )
    assert r.status_code == 200, f"PATCH credential failed ({r.status_code}): {r.text}"
    body = r.json()
    updated = body.get("credential", {})
    assert updated.get("name") == new_name, f"name not updated: {updated}"
    assert updated.get("maxCalls") == 500, f"maxCalls not updated: {updated}"


def test_active_only_reflects_patch(owner_headers, session_state):
    """After rename, active_only list returns updated name."""
    r = httpx.get(
        f"{GATEWAY_BASE}/api/v1/credentials/agent/list",
        headers=owner_headers,
        params={"active_only": "true"},
        timeout=15,
    )
    assert r.status_code == 200
    creds = r.json().get("credentials", [])
    new_name = f"{CRED_NAME}-renamed"
    names = [c.get("name") for c in creds]
    assert new_name in names, f"renamed credential '{new_name}' not in active_only list: {names}"


def test_agent_token_non_empty(session_state):
    token = session_state.get("agent_token")
    assert token and len(token) > 10, "agent_token not set by issue step"
