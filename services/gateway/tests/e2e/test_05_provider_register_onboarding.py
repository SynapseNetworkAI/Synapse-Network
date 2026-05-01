"""Step 5b: Fresh provider onboarding registers a service and verifies success."""
from tests.e2e.conftest import GATEWAY_BASE, SESSION_ID, track_test_service_id
from tests.e2e.helpers.db import seed_service_health
from tests.e2e.helpers.gateway import list_services, register_service


ONBOARDING_SERVICE_ID = f"provider_onboard_{SESSION_ID}"


def test_fresh_provider_registers_service(
    fresh_provider_headers,
    fresh_provider_account,
    mock_service_url,
    session_state,
):
    body = register_service(
        GATEWAY_BASE,
        fresh_provider_headers,
        {
            "serviceId": ONBOARDING_SERVICE_ID,
            "agentToolName": ONBOARDING_SERVICE_ID,
            "serviceName": f"Fresh Provider OCR {SESSION_ID}",
            "role": "Provider",
            "status": "active",
            "isActive": True,
            "pricing": {"amount": "0.002", "currency": "USDC"},
            "summary": "Fresh-wallet provider onboarding e2e service.",
            "tags": ["e2e", "provider", "onboarding"],
            "auth": {"type": "gateway_signed"},
            "invoke": {
                "method": "POST",
                "targets": [{"url": mock_service_url}],
                "request": {
                    "body": {
                        "type": "object",
                        "properties": {"prompt": {"type": "string"}},
                    }
                },
                "response": {
                    "body": {
                        "type": "object",
                        "properties": {"result": {"type": "string"}},
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
            "providerProfile": {
                "displayName": f"Fresh Provider {SESSION_ID}",
            },
            "payoutAccount": {
                "payoutAddress": fresh_provider_account.address.lower(),
                "chainId": 31337,
                "settlementCurrency": "USDC",
            },
            "governance": {
                "termsAccepted": True,
                "riskAcknowledged": True,
                "note": "fresh provider onboarding e2e",
            },
        },
    )
    assert body.get("status") == "success", f"unexpected register response: {body}"
    service_id = body.get("serviceId") or body.get("id")
    assert service_id == ONBOARDING_SERVICE_ID, (
        f"service id mismatch: expected {ONBOARDING_SERVICE_ID}, got {body}"
    )

    session_state["fresh_provider_service_id"] = service_id
    session_state["fresh_provider_service_url"] = mock_service_url
    track_test_service_id(service_id)
    seed_service_health(service_id, mock_service_url)


def test_fresh_provider_service_visible_in_owner_list(
    fresh_provider_headers,
    fresh_provider_account,
    session_state,
):
    service_id = session_state.get("fresh_provider_service_id")
    assert service_id, "fresh_provider_service_id missing from previous step"

    services = list_services(GATEWAY_BASE, fresh_provider_headers)
    matched = [
        row
        for row in services
        if row.get("serviceId") == service_id
        or row.get("agentToolName") == service_id
    ]
    assert matched, f"service {service_id} not found in provider list: {services}"

    service = matched[0]
    assert service.get("ownerAddress") == fresh_provider_account.address.lower()
    assert service.get("serviceName") == f"Fresh Provider OCR {SESSION_ID}"
