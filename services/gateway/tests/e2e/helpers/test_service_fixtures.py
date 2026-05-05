"""Tests for Gateway E2E canonical Provider catalog policy."""

from tests.e2e.helpers import service_fixtures


def test_default_e2e_service_is_paid_mock_cost():
    assert service_fixtures.DEFAULT_E2E_SERVICE_ID == "svc_synapse_mock_cost_1usdc"
    assert service_fixtures.configured_e2e_service_id() == (
        "svc_synapse_mock_cost_1usdc"
    )


def test_local_staging_service_creation_fallback_is_disabled(monkeypatch):
    monkeypatch.setenv("GATEWAY_E2E_ALLOW_SERVICE_CREATION", "true")
    assert service_fixtures.allow_service_creation() is False


def test_provider_catalog_ids_are_not_test_service_ids():
    for service_id in service_fixtures.CANONICAL_PROVIDER_SERVICE_IDS:
        assert service_fixtures.is_test_service_id(service_id) is False


def test_old_temp_service_prefixes_still_count_as_test_services():
    assert service_fixtures.is_test_service_id("svc_e2e_deadbeef") is True
    assert service_fixtures.is_test_service_id("apiref_test_deadbeef") is True
    assert service_fixtures.is_test_service_id("provider_onboard_deadbeef") is True


def test_canonical_invoke_payloads_cover_echo_and_mock_cost():
    echo = service_fixtures.canonical_invoke_payload("svc_synapse_echo")
    mock_cost = service_fixtures.canonical_invoke_payload(
        "svc_synapse_mock_cost_1usdc"
    )
    assert echo["source"] == "gateway-e2e"
    assert mock_cost["source"] == "gateway-e2e"


def test_missing_message_points_to_provider_onboarding():
    message = service_fixtures.canonical_missing_message("svc_synapse_echo")
    assert "Synapse-Network-Provider" in message
    assert "onboarding" in message
    assert "does not create fallback services" in message
