"""Step 5b: verify Provider onboarding prerequisite without mutating services."""
from tests.e2e.conftest import GATEWAY_BASE
from tests.e2e.helpers.gateway import list_services
from tests.e2e.helpers.service_fixtures import (
    CANONICAL_FREE_SERVICE_ID,
    CANONICAL_PAID_SERVICE_ID,
    canonical_missing_message,
    discover_service,
)


def _matches_service(row: dict, service_id: str) -> bool:
    return service_id in {
        str(row.get("serviceId") or ""),
        str(row.get("service_id") or ""),
        str(row.get("id") or ""),
        str(row.get("agentToolName") or ""),
    }


def test_provider_onboarding_prerequisite_smoke_services_discoverable():
    """Gateway E2E consumes services registered by Synapse-Network-Provider."""
    for service_id in (CANONICAL_FREE_SERVICE_ID, CANONICAL_PAID_SERVICE_ID):
        row = discover_service(GATEWAY_BASE, service_id, timeout=15)
        assert row, canonical_missing_message(service_id)


def test_provider_onboarding_prerequisite_smoke_services_owned_by_provider(
    provider_headers,
):
    services = list_services(GATEWAY_BASE, provider_headers)
    for service_id in (CANONICAL_FREE_SERVICE_ID, CANONICAL_PAID_SERVICE_ID):
        assert any(_matches_service(row, service_id) for row in services), (
            f"{service_id} is not visible in the configured provider owner list. "
            "Run Synapse-Network-Provider onboarding `ensure` against this "
            "local/staging Gateway before running Gateway E2E."
        )
