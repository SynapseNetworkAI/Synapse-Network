"""Step 5: verify Synapse-Network-Provider catalog services are ready.

Gateway local/staging E2E must not register temporary provider services. The
Provider repo owns onboarding, and these tests only assert that the already
registered catalog is discoverable and owned by the configured provider.
"""
import httpx
from decimal import Decimal

from tests.e2e.conftest import GATEWAY_BASE
from tests.e2e.helpers.gateway import list_services
from tests.e2e.helpers.service_fixtures import (
    CANONICAL_FREE_SERVICE_ID,
    CANONICAL_PAID_SERVICE_ID,
    CANONICAL_PROVIDER_SERVICE_IDS,
    canonical_missing_message,
    discover_service,
    service_price_usdc,
)


def _service_ids(rows: list[dict]) -> set[str]:
    ids: set[str] = set()
    for row in rows:
        ids.update(
            str(value)
            for value in (
                row.get("serviceId"),
                row.get("service_id"),
                row.get("id"),
                row.get("agentToolName"),
            )
            if value
        )
    return ids


def test_provider_catalog_services_are_discoverable(session_state):
    missing: list[str] = []
    for service_id in CANONICAL_PROVIDER_SERVICE_IDS:
        row = discover_service(GATEWAY_BASE, service_id, timeout=15)
        if not row:
            missing.append(service_id)
            continue
        assert str(row).lower().find("archived") == -1, (
            f"canonical service {service_id} appears archived: {row}"
        )

    assert not missing, canonical_missing_message(", ".join(missing))
    session_state["service_id"] = CANONICAL_PAID_SERVICE_ID
    session_state["free_smoke_service_id"] = CANONICAL_FREE_SERVICE_ID
    session_state["catalog_service_ids"] = list(CANONICAL_PROVIDER_SERVICE_IDS)


def test_paid_mock_cost_service_has_one_usdc_price():
    row = discover_service(GATEWAY_BASE, CANONICAL_PAID_SERVICE_ID, timeout=15)
    assert row, canonical_missing_message(CANONICAL_PAID_SERVICE_ID)
    assert Decimal(service_price_usdc(row, default="0")) == Decimal("1"), (
        f"unexpected mock-cost price: {row}"
    )


def test_free_echo_service_is_available_for_smoke_invokes():
    row = discover_service(GATEWAY_BASE, CANONICAL_FREE_SERVICE_ID, timeout=15)
    assert row, canonical_missing_message(CANONICAL_FREE_SERVICE_ID)
    assert Decimal(service_price_usdc(row, default="0")) == Decimal("0"), (
        f"unexpected echo price: {row}"
    )


def test_provider_catalog_visible_in_provider_owner_list(provider_headers):
    services = list_services(GATEWAY_BASE, provider_headers)
    actual_ids = _service_ids(services)
    missing = sorted(set(CANONICAL_PROVIDER_SERVICE_IDS) - actual_ids)
    assert not missing, (
        "Synapse-Network-Provider catalog services are missing from the "
        f"configured provider owner list: {missing}. Run Provider onboarding "
        "`ensure` for the same local/staging environment."
    )


def test_service_registration_endpoint_is_not_exercised_by_e2e(provider_headers):
    """Read-only smoke check replacing the historical registration E2E."""
    r = httpx.get(f"{GATEWAY_BASE}/api/v1/services", headers=provider_headers, timeout=15)
    assert r.status_code == 200, f"provider service list failed: {r.status_code} {r.text}"
