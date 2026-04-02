"""Step 6: 创建 Agent Credential + 列表验证"""
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
    # token may be at body["token"] or body["credential"]["token"] etc.
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


def test_agent_token_non_empty(session_state):
    token = session_state.get("agent_token")
    assert token and len(token) > 10, "agent_token not set by issue step"
