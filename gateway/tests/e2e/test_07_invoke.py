"""Step 7: Quote → Invocation → 余额核对 (核心结算链路)"""
import time
import uuid
from decimal import Decimal

import httpx
import pytest

from tests.e2e.conftest import GATEWAY_BASE
from tests.e2e.helpers.gateway import get_balance

CREDENTIAL_HEADER = "X-Credential"
TIMEOUT = 60


def _cred_headers(token: str) -> dict:
    return {CREDENTIAL_HEADER: token, "Content-Type": "application/json"}


def test_get_quote_for_service(session_state):
    token = session_state.get("agent_token")
    service_id = session_state.get("service_id")
    if not token or not service_id:
        pytest.skip("agent_token or service_id not set — previous steps may have failed")

    r = httpx.post(
        f"{GATEWAY_BASE}/api/v1/agent/quotes",
        headers=_cred_headers(token),
        json={"serviceId": service_id, "responseMode": "sync"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"Quote failed ({r.status_code}): {r.text}"
    body = r.json()
    quote_id = body.get("quoteId") or body.get("id") or body.get("quote_id")
    assert quote_id, f"quoteId missing from quote response: {body}"
    session_state["quote_id"] = quote_id


def test_invocation_deducts_balance(owner_headers, session_state):
    token = session_state.get("agent_token")
    service_id = session_state.get("service_id")
    if not token or not service_id:
        pytest.skip("agent_token or service_id not set")

    balance_before = get_balance(GATEWAY_BASE, owner_headers)
    assert balance_before > Decimal("0"), (
        f"Balance too low ({balance_before}) — deposit may have failed"
    )

    idem_key = uuid.uuid4().hex
    quote_id = session_state.get("quote_id")
    if not quote_id:
        pytest.skip("quote_id not set — test_get_quote_for_service may have failed")
    r = httpx.post(
        f"{GATEWAY_BASE}/api/v1/agent/invocations",
        headers=_cred_headers(token),
        json={
            "quoteId": quote_id,
            "idempotencyKey": idem_key,
            "serviceId": service_id,
            "payload": {"prompt": "e2e automated test invocation"},
            "responseMode": "sync",
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"Invocation failed ({r.status_code}): {r.text}"
    body = r.json()
    inv_id = (
        body.get("invocationId")
        or body.get("id")
        or body.get("invocation_id")
    )
    session_state["invocation_id"] = inv_id

    # Allow settlement to propagate
    time.sleep(1)
    balance_after = get_balance(GATEWAY_BASE, owner_headers)
    assert balance_after <= balance_before, (
        f"Balance did not decrease after invocation: before={balance_before}, after={balance_after}"
    )
    session_state["invocation_idem_key"] = idem_key


def test_invocation_receipt_reachable(session_state):
    token = session_state.get("agent_token")
    inv_id = session_state.get("invocation_id")
    if not token or not inv_id:
        pytest.skip("invocation_id not set — invocation test may have failed")

    r = httpx.get(
        f"{GATEWAY_BASE}/api/v1/agent/invocations/{inv_id}",
        headers=_cred_headers(token),
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"Receipt fetch failed ({r.status_code}): {r.text}"
    receipt = r.json()
    status = (
        receipt.get("status")
        or receipt.get("invocationStatus")
        or receipt.get("finalStatus")
    )
    assert status in ("completed", "success", "accepted", "billed", "fulfilled", "SUCCEEDED"), (
        f"Unexpected invocation status: {status} in {receipt}"
    )


def test_idempotent_invocation_same_id(session_state):
    """Same idempotencyKey with same payload must return the same invocationId (cached result)."""
    token = session_state.get("agent_token")
    service_id = session_state.get("service_id")
    idem_key = session_state.get("invocation_idem_key")
    quote_id = session_state.get("quote_id")
    if not all([token, service_id, idem_key, quote_id]):
        pytest.skip("Prerequisites not set")

    # Resending an identical request (same quoteId, same idem_key, same payload)
    # must return the cached invocation record — not create a new one.
    r = httpx.post(
        f"{GATEWAY_BASE}/api/v1/agent/invocations",
        headers=_cred_headers(token),
        json={
            "quoteId": quote_id,
            "idempotencyKey": idem_key,
            "serviceId": service_id,
            "payload": {"prompt": "e2e automated test invocation"},
            "responseMode": "sync",
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"Idempotent invocation failed: {r.text}"
    body = r.json()
    returned_id = (
        body.get("invocationId")
        or body.get("id")
        or body.get("invocation_id")
    )
    assert returned_id == session_state["invocation_id"], (
        f"Idempotent invocation returned different ID: {returned_id} != {session_state['invocation_id']}"
    )
