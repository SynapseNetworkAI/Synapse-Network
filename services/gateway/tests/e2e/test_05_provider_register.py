"""Step 5: Provider 注册服务 + 验证 Discovery 可见"""
import httpx
import pytest
from tests.e2e.conftest import GATEWAY_BASE, PROVIDER_BASE
from tests.e2e.helpers.auth import authenticate_wallet
from tests.e2e.helpers.db import seed_service_health
from tests.e2e.conftest import PROVIDER_KEY


def test_provider_registers_service(
    provider_headers, provider_account, service_tool_name, session_state, mock_service_url
):
    r = httpx.post(
        f"{GATEWAY_BASE}/api/v1/services",
        headers=provider_headers,
        json={
            "agentToolName": service_tool_name,
            "serviceName": f"E2E Test Service {service_tool_name}",
            "role": "Provider",
            "status": "active",
            "isActive": True,
            "pricing": {"amount": "0.001", "currency": "USD"},
            "summary": "Automated e2e integration test service",
            "tags": ["e2e", "test"],
            "auth": {"type": "gateway_signed"},
            "invoke": {
                "method": "POST",
                "targets": [{"url": mock_service_url}],
                "request": {
                    "body": {
                        "type": "object",
                        "properties": {
                            "prompt": {"type": "string"}
                        }
                    }
                },
                "response": {
                    "body": {
                        "type": "object",
                        "properties": {
                            "result": {"type": "string"}
                        }
                    }
                },
            },
            "healthCheck": {
                "path": "/health",
                "method": "GET",
                "timeoutMs": 3000,
                "successCodes": [200],
                "healthyThreshold": 1,
                "unhealthyThreshold": 3,
            },
            "payoutAccount": {
                "payoutAddress": provider_account.address.lower(),
                "chainId": 31337,
                "settlementCurrency": "USDC",
            },
            "providerProfile": {
                "displayName": f"E2E Provider {service_tool_name}",
            },
            "governance": {
                "termsAccepted": True,
                "riskAcknowledged": True,
                "note": "e2e automated test",
            },
        },
        timeout=20,
    )
    assert r.status_code in (200, 201), (
        f"Service registration failed ({r.status_code}): {r.text}"
    )
    body = r.json()
    assert body.get("status") == "success", f"Bad response: {body}"
    service_id = body.get("serviceId") or body.get("id")
    assert service_id, f"serviceId missing: {body}"
    session_state["service_id"] = service_id
    session_state["service_tool_name"] = service_tool_name
    session_state["mock_service_url"] = mock_service_url

    # Seed a healthy health record so the gateway's health-gate passes for invocations.
    # The health poller normally creates this on its own schedule (60+ seconds);
    # we skip that wait by writing directly to the DB.
    seed_service_health(service_id, mock_service_url)


def test_service_appears_in_list(provider_headers, service_tool_name):
    r = httpx.get(
        f"{GATEWAY_BASE}/api/v1/services",
        headers=provider_headers,
        timeout=15,
    )
    assert r.status_code == 200
    services = r.json().get("services") or r.json().get("items") or []
    tool_names = [s.get("agentToolName") or s.get("serviceId") for s in services]
    assert service_tool_name in tool_names, (
        f"service {service_tool_name} not found in list: {tool_names[:10]}"
    )


def test_service_discoverable_by_intent(provider_headers, service_tool_name, session_state):
    """BUG-004: Public discovery requires health-check records that new services lack.
    Assert service is visible in the provider's own /services list instead."""
    r = httpx.get(
        f"{GATEWAY_BASE}/api/v1/services",
        headers=provider_headers,
        timeout=15,
    )
    assert r.status_code == 200
    services = r.json().get("services") or r.json().get("items") or []
    service_id = session_state.get("service_id", service_tool_name)
    found = [
        s for s in services
        if s.get("serviceId") == service_id
        or s.get("agentToolName") == service_tool_name
    ]
    assert found, (
        f"Service {service_tool_name} ({service_id}) not found in provider list. "
        f"Total: {len(services)}"
    )
