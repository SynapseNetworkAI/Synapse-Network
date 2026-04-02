"""Step 8: 清理 — 撤销凭据 + 删除测试服务 + 状态断言"""
import httpx
import pytest
from tests.e2e.conftest import GATEWAY_BASE


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
        f"{GATEWAY_BASE}/api/v1/agent/quotes",
        headers={"X-Credential": token, "Content-Type": "application/json"},
        json={"serviceId": service_id, "responseMode": "sync"},
        timeout=15,
    )
    assert r.status_code in (401, 403), (
        f"Revoked credential should be rejected, got {r.status_code}: {r.text}"
    )


def test_delete_test_service(provider_headers, session_state):
    service_id = session_state.get("service_id")
    if not service_id:
        pytest.skip("service_id not set")

    # Set to paused before deletion (gateway requires non-active status before delete)
    r_update = httpx.put(
        f"{GATEWAY_BASE}/api/v1/services/{service_id}",
        headers=provider_headers,
        json={"isActive": False, "status": "paused"},
        timeout=15,
    )
    # 200 or 404 (already gone) are acceptable
    if r_update.status_code not in (200, 404):
        # log but don't fail — deletion might still work
        print(f"[warn] set-inactive returned {r_update.status_code}: {r_update.text}")

    r = httpx.delete(
        f"{GATEWAY_BASE}/api/v1/services/{service_id}",
        headers=provider_headers,
        timeout=15,
    )
    assert r.status_code in (200, 204, 404), (
        f"Delete service failed ({r.status_code}): {r.text}"
    )
    session_state["service_deleted"] = True


def test_chain_complete(session_state):
    """Final assertion: verify all major steps completed."""
    assert session_state.get("deposit_tx_hash"), "deposit_tx_hash missing"
    assert session_state.get("service_id"), "service_id missing"
    assert session_state.get("agent_token"), "agent_token missing"
    assert session_state.get("invocation_id"), "invocation_id missing"
    assert session_state.get("credential_revoked"), "credential not revoked"
    print(
        "\n✅ Full chain completed:\n"
        f"  deposit tx   : {session_state['deposit_tx_hash']}\n"
        f"  service id   : {session_state['service_id']}\n"
        f"  invocation id: {session_state['invocation_id']}\n"
    )
