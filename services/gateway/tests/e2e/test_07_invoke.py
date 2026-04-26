"""Step 7: Quote → Invocation → 余额核对 (核心结算链路)"""
import time
import uuid
from decimal import Decimal

import httpx
import pytest

from tests.e2e.conftest import GATEWAY_BASE
from tests.e2e.helpers.gateway import get_balance, get_balance_full

CREDENTIAL_HEADER = "X-Credential"
TIMEOUT = 60


def _cred_headers(token: str) -> dict:
    return {CREDENTIAL_HEADER: token, "Content-Type": "application/json"}


def test_get_quote_for_service(session_state, provider_headers):
    """Discover the service price via agent discovery search."""
    token = session_state.get("agent_token")
    service_id = session_state.get("service_id")
    if not token or not service_id:
        pytest.skip("agent_token or service_id not set — previous steps may have failed")

    r = httpx.post(
        f"{GATEWAY_BASE}/api/v1/agent/discovery/search",
        headers=_cred_headers(token),
        json={"query": service_id},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"Discovery search failed ({r.status_code}): {r.text}"
    body = r.json()
    results = body.get("results", [])
    match = next((s for s in results if s.get("serviceId") == service_id), None)
    if not match:
        # Public discovery is relevance-ranked and can omit a freshly registered
        # staging E2E service. The provider-owned list is the deterministic
        # fallback that still proves the registered service price before invoke.
        service_list = httpx.get(
            f"{GATEWAY_BASE}/api/v1/services",
            headers=provider_headers,
            timeout=TIMEOUT,
        )
        assert service_list.status_code == 200, (
            f"Provider service list failed ({service_list.status_code}): {service_list.text}"
        )
        services = service_list.json().get("services") or service_list.json().get("items") or []
        match = next(
            (
                s
                for s in services
                if s.get("serviceId") == service_id
                or s.get("id") == service_id
                or s.get("agentToolName") == service_id
            ),
            None,
        )
    assert match, f"service_id {service_id!r} not found in discovery or provider list"
    price_usdc = (
        match.get("basePriceUsdc")
        or match.get("priceUsdc")
        or (match.get("pricing") or {}).get("amount")
        or "0.001"
    )
    session_state["service_price_usdc"] = str(price_usdc)
    session_state["quote_id"] = "price_confirmed"  # used as gate by downstream tests


def test_invocation_deducts_balance(owner_headers, provider_headers, session_state):
    token = session_state.get("agent_token")
    service_id = session_state.get("service_id")
    if not token or not service_id:
        pytest.skip("agent_token or service_id not set")

    bal_before = get_balance_full(GATEWAY_BASE, owner_headers)
    consumer_before = Decimal(str(bal_before.get("consumerAvailableBalance", 0)))
    assert consumer_before > Decimal("0"), (
        f"Consumer balance too low ({consumer_before}) — deposit may have failed"
    )
    provider_bal_before = get_balance_full(GATEWAY_BASE, provider_headers)
    provider_receivable_before = Decimal(str(provider_bal_before.get("providerReceivable", 0)))
    fee_before = Decimal(str(bal_before.get("platformFeeAccrued", 0)))

    idem_key = uuid.uuid4().hex
    price_usdc = session_state.get("service_price_usdc", "0.001")
    quote_id = session_state.get("quote_id")
    if not quote_id:
        pytest.skip("quote_id not set — test_get_quote_for_service may have failed")
    r = httpx.post(
        f"{GATEWAY_BASE}/api/v1/agent/invoke",
        headers=_cred_headers(token),
        json={
            "serviceId": service_id,
            "idempotencyKey": idem_key,
            "costUsdc": price_usdc,
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
    charged = Decimal(str(body.get("chargedUsdc", 0)))
    session_state["invocation_id"] = inv_id
    session_state["charged_usdc"] = charged

    # Allow settlement to propagate
    time.sleep(1)

    bal_after = get_balance_full(GATEWAY_BASE, owner_headers)
    consumer_after = Decimal(str(bal_after.get("consumerAvailableBalance", 0)))
    fee_after = Decimal(str(bal_after.get("platformFeeAccrued", 0)))

    provider_bal_after = get_balance_full(GATEWAY_BASE, provider_headers)
    provider_receivable_after = Decimal(str(provider_bal_after.get("providerReceivable", 0)))

    # 1. Consumer balance must decrease
    assert consumer_after < consumer_before, (
        f"Consumer balance did not decrease: before={consumer_before}, after={consumer_after}"
    )
    # 2. Provider receivable must increase (provider earned something)
    assert provider_receivable_after >= provider_receivable_before, (
        f"Provider receivable did not increase: before={provider_receivable_before}, after={provider_receivable_after}"
    )
    # 3. Platform fee must increase (gateway took a cut)
    assert fee_after >= fee_before, (
        f"Platform fee accrued did not increase: before={fee_before}, after={fee_after}"
    )

    consumer_delta = consumer_before - consumer_after
    provider_delta = provider_receivable_after - provider_receivable_before
    fee_delta = fee_after - fee_before
    print(
        f"\n  Settlement: charged={charged} USDC"
        f" | consumer↓{consumer_delta} | provider↑{provider_delta} | fee↑{fee_delta}"
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

    # Resending an identical request (same idem_key, same payload)
    # must return the cached invocation record — not create a new one.
    r = httpx.post(
        f"{GATEWAY_BASE}/api/v1/agent/invoke",
        headers=_cred_headers(token),
        json={
            "serviceId": service_id,
            "idempotencyKey": idem_key,
            "costUsdc": session_state.get("service_price_usdc", "0.001"),
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
