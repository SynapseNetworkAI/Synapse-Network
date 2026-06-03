from __future__ import annotations

from fastapi.testclient import TestClient

from src.app import app
from src.api import deps
from src.services.auth.service import AdminIdentity


def _admin(permissions: tuple[str, ...]) -> AdminIdentity:
    return AdminIdentity(
        admin_id="adm_llm",
        email="ops@synapse-network.ai",
        display_name="LLM Ops",
        role="super_admin",
        permissions=permissions,
    )


def test_provider_llm_config_lists_managed_vendors_without_secrets() -> None:
    app.dependency_overrides[deps.require_admin] = lambda: _admin(("dashboard:read",))
    client = TestClient(app)

    response = client.get("/api/admin/v1/provider-llm-config")

    app.dependency_overrides.clear()
    assert response.status_code == 200
    payload = response.json()["data"]
    assert len(payload["vendors"]) == 10
    assert len(payload["models"]) == 10
    assert payload["vendors"][0]["providerCode"] == "openai"
    assert payload["vendors"][0]["secretReference"] == "secret-manager:OPENAI_API_KEY"
    assert "apiKey" not in payload["vendors"][0]
    assert payload["models"][0]["supportsStreaming"] is False
    assert payload["pricingReviews"][0]["pricingStatus"] == "operator_review_required"
    assert payload["rolloutStates"][0]["prodOptIn"] is False


def test_provider_llm_rollout_request_blocks_prod_enable_before_pricing_review() -> None:
    app.dependency_overrides[deps.require_admin] = lambda: _admin(("approval:submit",))
    client = TestClient(app)

    response = client.post(
        "/api/admin/v1/provider-llm-config/rollout-requests",
        json={
            "serviceId": "svc_openai_gpt_4_1",
            "environment": "prod",
            "action": "prod_enable",
            "note": "try prod",
        },
    )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["serviceId"] == "svc_openai_gpt_4_1"
    assert payload["status"] == "blocked"
    assert payload["blockedReason"] == "operator_review_required"


def test_provider_llm_rollout_request_queues_staging_smoke() -> None:
    app.dependency_overrides[deps.require_admin] = lambda: _admin(("approval:submit",))
    client = TestClient(app)

    response = client.post(
        "/api/admin/v1/provider-llm-config/rollout-requests",
        json={
            "serviceId": "qwen-plus",
            "environment": "staging",
            "action": "smoke",
        },
    )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["serviceId"] == "svc_qwen_plus"
    assert payload["status"] == "queued"
    assert payload["blockedReason"] is None
