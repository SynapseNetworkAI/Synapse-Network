"""Step 8: 清理 — 撤销凭据 + 状态断言"""
import httpx
import pytest
from tests.e2e.conftest import GATEWAY_BASE
from tests.e2e.helpers.service_fixtures import canonical_invoke_payload


def test_revoke_credential(owner_headers, session_state):
    cred_id = session_state.get("credential_id")
    if not cred_id:
        pytest.skip("credential_id not set — credential step may have failed")

    r = httpx.post(
        f"{GATEWAY_BASE}/api/v1/credentials/agent/{cred_id}/revoke",
        headers=owner_headers,
        timeout=15,
    )
    assert r.status_code == 200, (
        f"Revoke credential failed ({r.status_code}): {r.text}"
    )
    session_state["credential_revoked"] = True


def test_revoked_credential_is_rejected(session_state):
    token = session_state.get("agent_token")
    service_id = session_state.get("service_id")
    if not session_state.get("credential_revoked") or not token or not service_id:
        pytest.skip("Credential not revoked or missing agent_token/service_id")

    r = httpx.post(
        f"{GATEWAY_BASE}/api/v1/agent/invoke",
        headers={"X-Credential": token, "Content-Type": "application/json"},
        json={
            "serviceId": service_id,
            "idempotencyKey": "revoke-test-key",
            "costUsdc": "1.000000",
            "payload": {"body": canonical_invoke_payload(service_id)},
            "responseMode": "sync",
        },
        timeout=15,
    )
    assert r.status_code in (401, 403), (
        f"Revoked credential should be rejected, got {r.status_code}: {r.text}"
    )


def test_chain_complete(session_state):
    """Final assertion: verify all major steps completed."""
    assert session_state.get("deposit_tx_hash"), "deposit_tx_hash missing"
    assert session_state.get("service_id"), "service_id missing"
    assert session_state.get("agent_token"), "agent_token missing"
    if session_state.get("invoke_skipped_reason"):
        pytest.skip(session_state["invoke_skipped_reason"])
    assert session_state.get("invocation_id"), "invocation_id missing"
    assert session_state.get("credential_revoked"), "credential not revoked"
    print(
        "\n✅ Full chain completed:\n"
        f"  deposit tx   : {session_state['deposit_tx_hash']}\n"
        f"  service id   : {session_state['service_id']}\n"
        f"  invocation id: {session_state['invocation_id']}\n"
    )
