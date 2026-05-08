import asyncio
import base64
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import importlib
import logging
from types import SimpleNamespace

from fastapi.testclient import TestClient
import pytest
from uuid import uuid4

from src.app import app
from src.api import deps
from src.api.routers import ops_webhooks
from src.api.routers import forum_support as forum_support_router
from src.core.config import Settings, get_settings
from src.core.metrics import MetricsRegistry
from src.core.totp import generate_totp_code, generate_totp_secret
from src.core.security import hash_password
from src.domain import AdminMfaFactor, AdminUser
from src.domain.enums import AdminUserStatus, MfaFactorStatus, MfaFactorType
from src.services.adapters import (
    HttpProviderWithdrawReviewAdapter,
    InMemoryGatewayExecutionAdapter,
    InMemoryProviderWithdrawReviewAdapter,
    ProviderWithdrawReviewError,
)
from src.services.admin_config.service import AdminConfigService
from src.services.admin_user.service import AdminUserService
from src.services.approval.service import ApprovalService
from src.services.audit.service import AuditService
from src.services.auth.service import AdminAuthService, AdminIdentity
from src.services.dashboard.service import DashboardService
from src.services.execution import ExecutionService
from src.services.finance_admin import ProviderWithdrawReviewService
from src.services.ops import lark_alerts
from src.storage.analytics import (
    InMemoryGatewayDashboardProjectionRepository,
    InMemoryProviderWithdrawReviewRepository,
    PostgresProviderWithdrawReviewRepository,
    ProviderWithdrawReviewItem,
)
from src.storage import InMemoryAdminStore

PLACEHOLDER_PASSWORD = "phase1-" + "placeholder"
BOOTSTRAP_TOTP_SECRET = "__BOOTSTRAP_TOTP_SECRET__"


class FakeAnalyticsDashboardRepository:
    def get_overview(self, window: str) -> dict:
        return {
            "window": window,
            "overallStatus": "monitoring",
            "cards": [
                {"key": "gmv_usdc", "label": "GMV USDC", "value": 42.0, "unit": "USDC", "tone": "green", "detail": "test analytics fixture"},
                {"key": "analytics_health", "label": "Analytics Health", "value": "monitoring", "unit": "status", "tone": "orange", "detail": "test analytics fixture"},
            ],
            "alerts": [],
        }

    def get_consumer_funnel(self, window: str) -> dict:
        return {
            "window": window,
            "steps": [
                {"eventName": "page_viewed", "label": "page viewed", "users": 10, "events": 12, "conversionRate": 1.0, "dropoffRate": 0.0},
                {"eventName": "wallet_connected", "label": "wallet connected", "users": 8, "events": 8, "conversionRate": 0.8, "dropoffRate": 0.2},
                {"eventName": "consumer_signup_completed", "label": "consumer signup completed", "users": 6, "events": 6, "conversionRate": 0.75, "dropoffRate": 0.25},
                {"eventName": "quote_generated", "label": "quote generated", "users": 5, "events": 5, "conversionRate": 0.8333, "dropoffRate": 0.1667},
                {"eventName": "deposit_completed", "label": "deposit completed", "users": 4, "events": 4, "conversionRate": 0.8, "dropoffRate": 0.2},
                {"eventName": "invoke_started", "label": "invoke started", "users": 3, "events": 3, "conversionRate": 0.75, "dropoffRate": 0.25},
                {"eventName": "invoke_completed", "label": "invoke completed", "users": 2, "events": 2, "conversionRate": 0.6667, "dropoffRate": 0.3333},
            ],
            "summary": {
                "activationRate": 0.2,
                "firstInvokeUsers": 2,
                "quoteToInvokeRate": 0.4,
                "depositToFirstInvokeRate": 0.5,
            },
        }

    def get_invocation_revenue(self, window: str) -> dict:
        return {
            "window": window,
            "quoteCount": 5,
            "invokeStartedCount": 3,
            "invokeCompletedCount": 2,
            "invokeFailedCount": 1,
            "successRate": 0.6667,
            "gmvUsdc": 42.0,
            "priceAvgUsdc": 21.0,
            "platformFeeUsdc": 4.2,
            "providerNetUsdc": 37.8,
            "latencyMs": {"p50": 100, "p95": 200, "p99": 300},
            "failureStages": [],
            "errorCodes": [],
            "trend": [],
        }

    def get_provider_revenue(self, window: str) -> dict:
        return {
            "window": window,
            "revenueProviderCount": 1,
            "firstRevenueProviderCount": 1,
            "avgTimeSinceListingMs": 1000,
            "providerGrossUsdc": 42.0,
            "platformFeeUsdc": 4.2,
            "providerNetUsdc": 37.8,
            "pendingSettlementUsdc": 0,
            "settlementCompletedUsdc": 0,
            "settlementFailureRate": 0,
            "settlementP95ConfirmMs": 0,
            "settlementFunnel": [],
            "topProviders": [],
        }

    def get_money_flow(self, window: str) -> dict:
        return {
            "window": window,
            "depositUsdc": 10,
            "depositFailedCount": 0,
            "withdrawalUsdc": 0,
            "withdrawalFailedCount": 0,
            "refundUsdc": 0,
            "confirmLatencyMs": {"p50": 0, "p95": 0},
            "depositErrors": [],
            "depositFailureSamples": [],
            "withdrawalErrors": [],
            "financeContext": {},
        }

    def get_risk_health(self, window: str) -> dict:
        return {
            "window": window,
            "criticalRiskEvents": 0,
            "riskRules": [],
            "surfaces": [],
            "providerHealthDegradedCount": 0,
            "degradedProviders": [],
            "budgetGapUsdc": 0,
            "budgetBlocks": [],
            "budgetBlockSamples": [],
            "refundReasons": [],
        }

    def get_data_quality(self, window: str) -> dict:
        return {
            "window": window,
            "overallStatus": "monitoring",
            "eventCount": 7,
            "duplicateRate": 0,
            "criticalEventsFreshness": [],
            "sourceCoverage": {"test": 7},
            "privacyViolations": 0,
            "missingRequiredProperties": 0,
            "xorViolations": 0,
            "kafkaLag": 0,
            "clickhouseLag": 0,
            "fileBackendFallbackEvents": 7,
            "schemaIssueSamples": [],
        }


TEST_STORE = InMemoryAdminStore.seed_demo()
TEST_GATEWAY_PROJECTION_REPOSITORY = InMemoryGatewayDashboardProjectionRepository.seed_demo()
TEST_PROVIDER_WITHDRAW_REVIEW_REPOSITORY = InMemoryProviderWithdrawReviewRepository.seed_demo()
TEST_GATEWAY_EXECUTION_ADAPTER = InMemoryGatewayExecutionAdapter()
TEST_PROVIDER_WITHDRAW_REVIEW_ADAPTER = InMemoryProviderWithdrawReviewAdapter(TEST_PROVIDER_WITHDRAW_REVIEW_REPOSITORY)
TEST_ANALYTICS_REPOSITORY = FakeAnalyticsDashboardRepository()
admin_app_module = importlib.import_module("src.app")


class FakeProviderServicesAdapter:
    def __init__(self) -> None:
        self.service = {
            "serviceId": "svc_quotes",
            "ownerAddress": "0xprovider",
            "serviceName": "Quote Engine",
            "summary": "Registered provider service.",
            "tags": ["quotes"],
            "pricing": {"amount": "0.01", "currency": "USDC"},
            "controlStatus": "active",
            "status": "active",
            "isActive": True,
            "runtimeStatus": "healthy",
            "runtimeAvailable": True,
            "probeTier": "normal",
            "adaptiveConcurrencyLimit": 8,
            "inFlight": 1,
            "queueDepth": 0,
            "latencyP95Ms": 42,
            "errorRate": 0.0,
            "circuitState": "closed",
            "lastConcurrencyAdjustmentAt": 1710000000000,
            "health": {
                "overallStatus": "healthy",
                "probeStatus": "healthy",
                "healthyTargets": 1,
                "totalTargets": 1,
                "lastCheckedAt": 1710000000000,
                "isStale": False,
                "runtimeAvailable": True,
                "probeTier": "normal",
            },
            "targets": [
                {
                    "targetUrl": "https://provider.test/invoke",
                    "status": "healthy",
                    "httpStatus": 200,
                    "latencyMs": 32,
                    "consecutiveSuccesses": 4,
                    "consecutiveFailures": 0,
                    "lastCheckedAt": 1710000000000,
                    "lastHealthyAt": 1710000000000,
                    "error": None,
                }
            ],
            "downstreamTargets": [
                {
                    "targetUrl": "https://provider.test/invoke",
                    "adaptiveConcurrencyLimit": 8,
                    "inFlight": 1,
                    "queueDepth": 0,
                    "latencyP95Ms": 42,
                    "errorRate": 0.0,
                    "circuitState": "closed",
                    "lastConcurrencyAdjustmentAt": 1710000000000,
                }
            ],
            "createdAt": "2026-04-17 00:00:00",
            "updatedAt": "2026-04-17 00:00:00",
        }

    def list_services(self, *, actor, params):
        _ = actor, params
        return {"items": [self.service], "page": 1, "pageSize": 20, "totalCount": 1, "totalPages": 1}

    def get_service(self, *, actor, service_id):
        _ = actor, service_id
        return {"service": self.service}

    def force_probe(self, *, actor, service_id):
        _ = actor, service_id
        return {"service": self.service}

    def update_lifecycle(self, *, actor, service_id, action, note):
        _ = actor, service_id, note
        status = {"PAUSE": "inactive", "RESUME": "active", "SUSPEND": "suspended"}[action]
        probe_tier = {"PAUSE": "manual_only", "RESUME": "normal", "SUSPEND": "slow_lane"}[action]
        next_service = {
            **self.service,
            "controlStatus": status,
            "status": status,
            "probeTier": probe_tier,
            "health": {**self.service["health"], "probeTier": probe_tier},
        }
        return {"service": next_service}

    def delete_service(self, *, actor, service_id, note):
        _ = actor, service_id, note
        return {"status": "success", "message": "Service deleted"}


TEST_PROVIDER_SERVICES_ADAPTER = FakeProviderServicesAdapter()


def _test_store() -> InMemoryAdminStore:
    return TEST_STORE


def _test_gateway_projection_repository() -> InMemoryGatewayDashboardProjectionRepository:
    return TEST_GATEWAY_PROJECTION_REPOSITORY


def _test_provider_withdraw_review_repository() -> InMemoryProviderWithdrawReviewRepository:
    return TEST_PROVIDER_WITHDRAW_REVIEW_REPOSITORY


def _get_test_auth_service() -> AdminAuthService:
    return AdminAuthService(TEST_STORE)


def _get_test_admin_user_service() -> AdminUserService:
    return AdminUserService(TEST_STORE)


def _get_test_admin_config_service() -> AdminConfigService:
    return AdminConfigService(TEST_STORE)


def _get_test_provider_withdraw_review_service() -> ProviderWithdrawReviewService:
    return ProviderWithdrawReviewService(TEST_STORE, TEST_PROVIDER_WITHDRAW_REVIEW_REPOSITORY, TEST_PROVIDER_WITHDRAW_REVIEW_ADAPTER)


def _get_test_approval_service() -> ApprovalService:
    return ApprovalService(TEST_STORE, TEST_PROVIDER_WITHDRAW_REVIEW_REPOSITORY, _get_test_provider_withdraw_review_service())


def _get_test_dashboard_service() -> DashboardService:
    return DashboardService(
        TEST_STORE,
        TEST_GATEWAY_PROJECTION_REPOSITORY,
        TEST_ANALYTICS_REPOSITORY,
        TEST_PROVIDER_WITHDRAW_REVIEW_REPOSITORY,
    )


def _get_test_audit_service() -> AuditService:
    return AuditService(TEST_STORE)


def _get_test_execution_service() -> ExecutionService:
    return ExecutionService(TEST_STORE, TEST_GATEWAY_EXECUTION_ADAPTER)


app.dependency_overrides[deps.get_store] = _test_store
app.dependency_overrides[deps.get_auth_service] = _get_test_auth_service
app.dependency_overrides[deps.get_admin_user_service] = _get_test_admin_user_service
app.dependency_overrides[deps.get_admin_config_service] = _get_test_admin_config_service
app.dependency_overrides[deps.get_approval_service] = _get_test_approval_service
app.dependency_overrides[deps.get_gateway_dashboard_projection_repository] = _test_gateway_projection_repository
app.dependency_overrides[deps.get_analytics_dashboard_repository] = lambda: TEST_ANALYTICS_REPOSITORY
app.dependency_overrides[deps.get_dashboard_service] = _get_test_dashboard_service
app.dependency_overrides[deps.get_provider_withdraw_review_repository] = _test_provider_withdraw_review_repository
app.dependency_overrides[deps.get_provider_withdraw_review_adapter] = lambda: TEST_PROVIDER_WITHDRAW_REVIEW_ADAPTER
app.dependency_overrides[deps.get_provider_withdraw_review_service] = _get_test_provider_withdraw_review_service
app.dependency_overrides[deps.get_provider_services_adapter] = lambda: TEST_PROVIDER_SERVICES_ADAPTER
app.dependency_overrides[deps.get_audit_service] = _get_test_audit_service
app.dependency_overrides[deps.get_gateway_execution_adapter] = lambda: TEST_GATEWAY_EXECUTION_ADAPTER
app.dependency_overrides[deps.get_execution_service] = _get_test_execution_service

client = TestClient(app)


def _login_as(email: str) -> dict[str, str]:
    client.cookies.clear()
    response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": email,
            "password": PLACEHOLDER_PASSWORD,
            "otpCode": _otp_code_for(email),
        },
    )
    assert response.status_code == 200
    csrf_token = response.json()["data"]["csrfToken"]
    return {"X-CSRF-Token": csrf_token}


def _seed_test_passwords() -> None:
    store = _test_store()
    for email in (
        "ops@synapse-network.ai",
        "audit@synapse-network.ai",
        "finance@synapse-network.ai",
        "finance-review@synapse-network.ai",
        "risk@synapse-network.ai",
        "risk-review@synapse-network.ai",
        "readonly@synapse-network.ai",
        "cliff@synapse-network.ai",
    ):
        user = store.identity.get_user_by_email(email)
        if user is not None:
            store.identity.update_password_hash(user.admin_id, hash_password(PLACEHOLDER_PASSWORD))


def _otp_code_for(email: str) -> str:
    store = _test_store()
    user = store.identity.get_user_by_email(email)
    assert user is not None
    factors = store.identity.list_mfa_factors(user.admin_id)
    secret = next(str(factor.payload.get("totpSecret") or "") for factor in factors if factor.payload.get("totpSecret"))
    return generate_totp_code(secret)


def _ensure_unenrolled_admin(email: str = "unenrolled@synapse-network.ai") -> None:
    store = _test_store()
    existing = store.identity.get_user_by_email(email)
    if existing is None:
        store.identity.create_user(
            AdminUser(
                admin_id="admin_unenrolled",
                email=email,
                display_name="Unenrolled Admin",
                status=AdminUserStatus.ACTIVE,
                password_hash=hash_password(PLACEHOLDER_PASSWORD),
                require_mfa=True,
            )
        )
        return
    store.identity.update_user(
        AdminUser(
            admin_id=existing.admin_id,
            email=existing.email,
            display_name=existing.display_name,
            status=AdminUserStatus.ACTIVE,
            auth_source=existing.auth_source,
            sso_subject=existing.sso_subject,
            password_hash=existing.password_hash,
            require_mfa=True,
            last_login_at=existing.last_login_at,
            created_at=existing.created_at,
            updated_at=existing.updated_at,
            disabled_at=None,
        )
    )
    store.identity.update_password_hash(existing.admin_id, hash_password(PLACEHOLDER_PASSWORD))


def _create_enrolled_admin(email: str, *, require_mfa: bool = True) -> AdminUser:
    store = _test_store()
    existing = store.identity.get_user_by_email(email)
    if existing is None:
        user = store.identity.create_user(
            AdminUser(
                admin_id=f"admin_{uuid4().hex[:12]}",
                email=email,
                display_name="Lockout Test Admin",
                status=AdminUserStatus.ACTIVE,
                password_hash=hash_password(PLACEHOLDER_PASSWORD),
                require_mfa=require_mfa,
            )
        )
    else:
        user = store.identity.update_user(
            replace(
                existing,
                status=AdminUserStatus.ACTIVE,
                password_hash=hash_password(PLACEHOLDER_PASSWORD),
                require_mfa=require_mfa,
                failed_login_attempts=0,
                last_failed_login_at=None,
                locked_until=None,
                disabled_at=None,
            )
        )
    if require_mfa:
        store.identity.upsert_mfa_factor(
            AdminMfaFactor(
                factor_id=f"mfa_{user.admin_id}_primary",
                admin_id=user.admin_id,
                factor_type=MfaFactorType.TOTP,
                factor_label="primary",
                status=MfaFactorStatus.ACTIVE,
                payload={"totpSecret": generate_totp_secret()},
            )
        )
    return user


def _refresh_auth_settings() -> None:
    get_settings.cache_clear()
    deps.get_auth_service.cache_clear()


_seed_test_passwords()


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_readiness() -> None:
    response = client.get("/readiness")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["components"]["gateway_adapter"]["configured"] is True


def test_metrics_requires_internal_authorization(monkeypatch) -> None:
    monkeypatch.setattr(
        admin_app_module.settings,
        "metrics_bearer_token",
        "admin-metrics-token",
    )
    monkeypatch.setattr(admin_app_module.settings, "metrics_basic_username", "")
    monkeypatch.setattr(admin_app_module.settings, "metrics_basic_password", "")

    forbidden = client.get("/metrics")
    allowed = client.get(
        "/metrics",
        headers={"Authorization": "Bearer admin-metrics-token"},
    )

    assert forbidden.status_code == 403
    assert allowed.status_code == 200
    assert "synapse_http_requests_total" in allowed.text


def test_metrics_runtime_guard_drops_sensitive_or_long_labels(caplog) -> None:
    registry = MetricsRegistry(service="gateway-admin")

    with caplog.at_level(logging.ERROR):
        registry.set_gauge(
            "synapse_admin_guard_value",
            1,
            {"wallet": "0x" + "a" * 40},
        )
        registry.set_gauge(
            "synapse_admin_guard_long_value",
            1,
            {"actor": "x" * 41},
        )

    rendered = registry.render()
    assert "synapse_admin_guard_value" not in rendered
    assert "synapse_admin_guard_long_value" not in rendered
    assert "synapse_metric_label_rejected_total" in rendered
    assert "METRIC_LABEL_REJECTED" in caplog.text


def _alert_receiver_settings(**overrides):
    base = {
        "gcp_alert_receiver_enabled": True,
        "gcp_alert_receiver_token": "receiver-token",
        "gcp_alert_receiver_username": "synapse-gcp-alert",
        "gcp_alert_default_route": "staging-drill",
        "lark_webhook_staging_drill": "https://lark.test/staging",
        "lark_secret_staging_drill": "",
        "lark_webhook_p0_war_room": "https://lark.test/p0",
        "lark_secret_p0_war_room": "",
        "lark_webhook_prod_alerts": "https://lark.test/prod",
        "lark_secret_prod_alerts": "",
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def test_gcp_alert_receiver_rejects_missing_token(monkeypatch) -> None:
    monkeypatch.setattr(
        ops_webhooks,
        "get_settings",
        lambda: _alert_receiver_settings(),
    )

    response = client.post(
        "/api/v1/ops/webhooks/gcp-alert-receiver",
        json={"incident": {"summary": "test"}},
    )

    assert response.status_code == 401


def test_gcp_alert_receiver_supports_basic_auth_and_route_config(monkeypatch) -> None:
    sent: list[dict] = []

    async def fake_send(route, alert):
        sent.append({"route": route, "alert": alert})
        return {"ok": True, "status": 200, "route": route.name}

    monkeypatch.setattr(
        ops_webhooks,
        "get_settings",
        lambda: _alert_receiver_settings(),
    )
    monkeypatch.setattr(ops_webhooks, "send_lark_alert", fake_send)
    credentials = base64.b64encode(b"synapse-gcp-alert:receiver-token").decode("ascii")

    response = client.post(
        "/api/v1/ops/webhooks/gcp-alert-receiver",
        headers={"Authorization": f"Basic {credentials}"},
        json={
            "incident": {
                "metadata": {
                    "user_labels": {
                        "route": "p0-war-room",
                        "alertname": "PolicyLabelAlert",
                    }
                },
                "summary": "basic auth receiver test",
            }
        },
    )

    assert response.status_code == 200
    assert response.json()["route"] == "p0-war-room"
    assert sent[0]["route"].name == "p0-war-room"
    assert sent[0]["route"].webhook == "https://lark.test/p0"
    assert sent[0]["alert"]["labels"]["alertname"] == "PolicyLabelAlert"


def test_gcp_alert_receiver_denies_when_disabled_or_unconfigured(monkeypatch) -> None:
    monkeypatch.setattr(
        ops_webhooks,
        "get_settings",
        lambda: _alert_receiver_settings(gcp_alert_receiver_enabled=False),
    )
    disabled = client.post(
        "/api/v1/ops/webhooks/gcp-alert-receiver",
        headers={"X-Synapse-Gcp-Alert-Token": "receiver-token"},
        json={"incident": {"summary": "test"}},
    )

    assert disabled.status_code == 404

    monkeypatch.setattr(
        ops_webhooks,
        "get_settings",
        lambda: _alert_receiver_settings(gcp_alert_receiver_token=""),
    )
    unconfigured = client.post(
        "/api/v1/ops/webhooks/gcp-alert-receiver",
        headers={"X-Synapse-Gcp-Alert-Token": "receiver-token"},
        json={"incident": {"summary": "test"}},
    )

    assert unconfigured.status_code == 401


def test_gcp_alert_receiver_rejects_malformed_basic_auth(monkeypatch) -> None:
    monkeypatch.setattr(
        ops_webhooks,
        "get_settings",
        lambda: _alert_receiver_settings(),
    )

    bad_base64 = client.post(
        "/api/v1/ops/webhooks/gcp-alert-receiver",
        headers={"Authorization": "Basic not-base64"},
        json={"incident": {"summary": "test"}},
    )
    no_colon = client.post(
        "/api/v1/ops/webhooks/gcp-alert-receiver",
        headers={"Authorization": f"Basic {base64.b64encode(b'no-colon').decode('ascii')}"},
        json={"incident": {"summary": "test"}},
    )

    assert bad_base64.status_code == 401
    assert no_colon.status_code == 401


def test_gcp_alert_receiver_converts_payload_and_sends_lark(monkeypatch) -> None:
    sent: list[dict] = []

    async def fake_send(route, alert):
        sent.append({"route": route, "alert": alert})
        return {"ok": True, "status": 200, "route": route.name}

    monkeypatch.setattr(
        ops_webhooks,
        "get_settings",
        lambda: _alert_receiver_settings(),
    )
    monkeypatch.setattr(ops_webhooks, "send_lark_alert", fake_send)

    response = client.post(
        "/api/v1/ops/webhooks/gcp-alert-receiver",
        headers={"X-Synapse-Gcp-Alert-Token": "receiver-token"},
        json={
            "incident": {
                "incident_id": "inc-1",
                "state": "open",
                "policy_name": "Synapse Staging Gateway 5xx Rate High",
                "condition_name": "Gateway 5xx ratio > 5%",
                "summary": "Gateway 5xx is high",
                "url": "https://console.cloud.google.com/monitoring",
                "resource": {
                    "type": "cloud_run_revision",
                    "labels": {"service_name": "synapse-staging-gateway"},
                },
                "metadata": {
                    "user_labels": {
                        "severity": "p1",
                        "system": "gateway",
                        "env": "staging",
                        "route": "staging-drill",
                        "business_scenario": "Gateway API unavailable",
                    }
                },
            }
        },
    )

    assert response.status_code == 200
    assert response.json()["route"] == "staging-drill"
    assert sent[0]["route"].name == "staging-drill"
    alert = sent[0]["alert"]
    assert alert["labels"]["alertname"] == "Synapse Staging Gateway 5xx Rate High"
    assert alert["labels"]["service_name"] == "synapse-staging-gateway"
    assert alert["annotations"]["business_scenario"] == "Gateway API unavailable"


def test_gcp_alert_receiver_logs_success_without_secrets(monkeypatch, caplog) -> None:
    async def fake_send(route, _alert):
        return {"ok": True, "status": 200, "route": route.name}

    monkeypatch.setattr(
        ops_webhooks,
        "get_settings",
        lambda: _alert_receiver_settings(),
    )
    monkeypatch.setattr(ops_webhooks, "send_lark_alert", fake_send)

    with caplog.at_level(logging.ERROR):
        response = client.post(
            "/api/v1/ops/webhooks/gcp-alert-receiver",
            headers={"X-Synapse-Gcp-Alert-Token": "receiver-token"},
            json={"incident": {"summary": "test", "metadata": {"user_labels": {"alertname": "ReceiverProbe"}}}},
        )

    assert response.status_code == 200
    assert "alert_trigger=GCP_ALERT_RECEIVED" in caplog.text
    assert "ReceiverProbe" in caplog.text
    assert "receiver-token" not in caplog.text


def test_gcp_alert_receiver_redacts_sensitive_payload_values() -> None:
    alert = ops_webhooks.normalize_gcp_monitoring_payload(
        {
            "incident": {
                "incident_id": "inc-secret",
                "summary": "authorization: Bearer super-secret-token",
                "metadata": {
                    "user_labels": {
                        "alertname": "SecretLeak",
                        "private_key": "0x" + "a" * 64,
                    }
                },
            }
        }
    )

    rendered = str(alert)
    assert "super-secret-token" not in rendered
    assert "aaaaaaaaaaaaaaaa" not in rendered
    assert "[REDACTED" in rendered


def test_lark_alert_helpers_redact_and_render_business_card() -> None:
    sanitized = lark_alerts.sanitize_payload(
        {
            "authorization": "Bearer token-value",
            "items": [
                "private_key=0x" + "a" * 64,
                "wallet 0x1234567890abcdef1234567890abcdef12345678",
            ],
            "ok": 1,
        }
    )

    assert sanitized["authorization"] == "[REDACTED]"
    assert sanitized["items"][0] == "private_key=[REDACTED]"
    assert "0x1234...5678" in sanitized["items"][1]
    assert sanitized["ok"] == 1

    card = lark_alerts.build_lark_card(
        {
            "status": "resolved",
            "labels": {
                "severity": "p0",
                "system": "gateway",
                "env": "staging",
                "alertname": "SynapseStagingGateway5xxRateHigh",
            },
            "annotations": {
                "summary": "Gateway recovered",
                "business_scenario": "Gateway API availability",
                "impact": "NO_ACTION_REQUIRED staging drill",
                "trigger": "Synthetic test",
                "action": "Check logs",
                "message": "authorization: Bearer card-secret-token",
                "runbook": "docs/ops/13_Production_Monitoring_Alerting_and_Backup_Restore.md",
                "dashboard": "https://console.cloud.google.com/monitoring",
            },
            "fingerprint": "fp-1",
        }
    )
    rendered = str(card)

    assert card["msg_type"] == "interactive"
    assert card["card"]["header"]["template"] == "green"
    assert "[RESOLVED][P0][gateway][staging]" in rendered
    assert "Gateway API availability" in rendered
    assert "card-secret-token" not in rendered


def test_lark_alert_card_compacts_large_payload() -> None:
    card = lark_alerts.build_lark_card(
        {
            "status": "firing",
            "labels": {"severity": "p1", "system": "ops", "env": "staging", "alertname": "HugeAlert"},
            "annotations": {
                "summary": "x" * 10_000,
                "business_scenario": "y" * 10_000,
                "impact": "z" * 10_000,
                "message": "m" * 10_000,
            },
            "fingerprint": "huge",
        }
    )
    content = card["card"]["elements"][0]["text"]["content"]

    assert "HugeAlert" in content
    assert len(str(card).encode("utf-8")) < lark_alerts.MAX_CARD_BYTES


def test_send_lark_alert_posts_signed_card(monkeypatch) -> None:
    sent: dict = {}

    class FakeAsyncClient:
        def __init__(self, *, timeout):
            sent["timeout"] = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def post(self, webhook, json):
            sent["webhook"] = webhook
            sent["json"] = json
            return SimpleNamespace(status_code=200)

    monkeypatch.setattr(lark_alerts.httpx, "AsyncClient", FakeAsyncClient)
    result = asyncio.run(
        lark_alerts.send_lark_alert(
            lark_alerts.LarkRoute(
                name="staging-drill",
                webhook="https://lark.test/hook",
                secret="signing-secret",
            ),
            {
                "status": "firing",
                "labels": {"alertname": "SignedAlert"},
                "annotations": {"summary": "signed"},
            },
        )
    )

    assert result == {"ok": True, "route": "staging-drill", "status": 200}
    assert sent["webhook"] == "https://lark.test/hook"
    assert sent["timeout"] == 8.0
    assert sent["json"]["timestamp"]
    assert sent["json"]["sign"]
    assert sent["json"]["msg_type"] == "interactive"


def test_send_lark_alert_fails_for_missing_webhook_or_http_error(monkeypatch, caplog) -> None:
    with pytest.raises(lark_alerts.LarkAlertError):
        asyncio.run(
            lark_alerts.send_lark_alert(
                lark_alerts.LarkRoute(name="missing", webhook=""),
                {"labels": {}, "annotations": {}},
            )
        )

    class FailingAsyncClient:
        def __init__(self, *, timeout):
            _ = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def post(self, webhook, json):
            _ = webhook, json
            return SimpleNamespace(status_code=500)

    monkeypatch.setattr(lark_alerts.httpx, "AsyncClient", FailingAsyncClient)
    with caplog.at_level(logging.ERROR), pytest.raises(lark_alerts.LarkAlertError):
        asyncio.run(
            lark_alerts.send_lark_alert(
                lark_alerts.LarkRoute(name="staging-drill", webhook="https://lark.test/hook"),
                {"labels": {}, "annotations": {}},
            )
        )

    assert "alert_trigger=LARK_RELAY_FAILURE" in caplog.text


def test_gcp_alert_receiver_returns_502_on_lark_failure(monkeypatch) -> None:
    async def fake_send(_route, _alert):
        raise ops_webhooks.LarkAlertError("lark down")

    monkeypatch.setattr(
        ops_webhooks,
        "get_settings",
        lambda: _alert_receiver_settings(),
    )
    monkeypatch.setattr(ops_webhooks, "send_lark_alert", fake_send)

    response = client.post(
        "/api/v1/ops/webhooks/gcp-alert-receiver",
        headers={"X-Synapse-Gcp-Alert-Token": "receiver-token"},
        json={"incident": {"summary": "test"}},
    )

    assert response.status_code == 502


def test_admin_auth_login() -> None:
    response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": "ops@synapse-network.ai",
            "password": PLACEHOLDER_PASSWORD,
            "otpCode": _otp_code_for("ops@synapse-network.ai"),
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["admin"]["email"] == "ops@synapse-network.ai"
    assert body["data"]["expiresIn"] == 3600
    assert body["data"]["csrfToken"]
    assert body["data"]["security"]["loginTotpRequired"] is True
    assert body["data"]["security"]["highRiskTotpRequired"] is True
    assert "synapse_admin_session=" in response.headers["set-cookie"]


def test_admin_auth_login_requires_mfa_enrollment_for_unbound_account() -> None:
    _ensure_unenrolled_admin()
    client.cookies.clear()

    response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": "unenrolled@synapse-network.ai",
            "password": PLACEHOLDER_PASSWORD,
        },
    )

    assert response.status_code == 428
    body = response.json()
    assert body["error"]["code"] == "MFA_ENROLLMENT_REQUIRED"
    assert body["data"]["enrollmentToken"]
    assert body["data"]["expiresIn"] == 600
    assert body["data"]["totpIssuer"] == "Synapse Gateway Admin"


def test_admin_auth_login_requires_mfa_enrollment_for_bootstrap_placeholder_totp() -> None:
    email = f"bootstrap-placeholder-{uuid4().hex[:8]}@synapse-network.ai"
    store = _test_store()
    user = store.identity.create_user(
        AdminUser(
            admin_id=f"admin_{uuid4().hex[:12]}",
            email=email,
            display_name="Bootstrap Placeholder Admin",
            status=AdminUserStatus.ACTIVE,
            password_hash=hash_password(PLACEHOLDER_PASSWORD),
            require_mfa=True,
        )
    )
    store.identity.upsert_mfa_factor(
        AdminMfaFactor(
            factor_id=f"factor_{uuid4().hex[:12]}",
            admin_id=user.admin_id,
            factor_type=MfaFactorType.TOTP,
            factor_label="primary",
            status=MfaFactorStatus.ACTIVE,
            payload={"totpSecret": BOOTSTRAP_TOTP_SECRET},
        )
    )
    client.cookies.clear()

    response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": email,
            "password": PLACEHOLDER_PASSWORD,
        },
    )

    assert response.status_code == 428
    body = response.json()
    assert body["error"]["code"] == "MFA_ENROLLMENT_REQUIRED"
    assert body["data"]["enrollmentToken"]


def test_admin_auth_mfa_enrollment_begin_and_verify_issue_session() -> None:
    _ensure_unenrolled_admin()
    client.cookies.clear()

    login_response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": "unenrolled@synapse-network.ai",
            "password": PLACEHOLDER_PASSWORD,
        },
    )
    assert login_response.status_code == 428
    enrollment_token = login_response.json()["data"]["enrollmentToken"]

    begin_response = client.post(
        "/api/admin/v1/auth/mfa/enroll/begin",
        json={"enrollmentToken": enrollment_token},
    )
    assert begin_response.status_code == 200
    begin_body = begin_response.json()["data"]
    assert begin_body["factorId"]
    assert begin_body["manualEntryKey"]
    assert begin_body["otpauthUrl"].startswith("otpauth://totp/")

    verify_response = client.post(
        "/api/admin/v1/auth/mfa/enroll/verify",
        json={
            "enrollmentToken": enrollment_token,
            "factorId": begin_body["factorId"],
            "otpCode": generate_totp_code(begin_body["manualEntryKey"]),
        },
    )
    assert verify_response.status_code == 200
    verify_body = verify_response.json()["data"]
    assert verify_body["admin"]["email"] == "unenrolled@synapse-network.ai"
    assert verify_body["csrfToken"]
    assert "synapse_admin_session=" in verify_response.headers["set-cookie"]

    store = _test_store()
    user = store.identity.get_user_by_email("unenrolled@synapse-network.ai")
    assert user is not None
    factors = store.identity.list_mfa_factors(user.admin_id)
    active_factors = [factor for factor in factors if factor.status.value == "active"]
    assert len(active_factors) == 1


def test_admin_auth_mfa_enrollment_begin_replaces_bootstrap_placeholder_secret() -> None:
    email = f"bootstrap-enroll-{uuid4().hex[:8]}@synapse-network.ai"
    store = _test_store()
    user = store.identity.create_user(
        AdminUser(
            admin_id=f"admin_{uuid4().hex[:12]}",
            email=email,
            display_name="Bootstrap Enrollment Admin",
            status=AdminUserStatus.ACTIVE,
            password_hash=hash_password(PLACEHOLDER_PASSWORD),
            require_mfa=True,
        )
    )
    existing_factor = store.identity.upsert_mfa_factor(
        AdminMfaFactor(
            factor_id=f"factor_{uuid4().hex[:12]}",
            admin_id=user.admin_id,
            factor_type=MfaFactorType.TOTP,
            factor_label="primary",
            status=MfaFactorStatus.ACTIVE,
            payload={"totpSecret": BOOTSTRAP_TOTP_SECRET},
        )
    )
    client.cookies.clear()

    login_response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": email,
            "password": PLACEHOLDER_PASSWORD,
        },
    )
    assert login_response.status_code == 428
    enrollment_token = login_response.json()["data"]["enrollmentToken"]

    begin_response = client.post(
        "/api/admin/v1/auth/mfa/enroll/begin",
        json={"enrollmentToken": enrollment_token},
    )

    assert begin_response.status_code == 200
    begin_body = begin_response.json()["data"]
    assert begin_body["factorId"] == existing_factor.factor_id
    assert begin_body["manualEntryKey"]
    assert begin_body["manualEntryKey"] != BOOTSTRAP_TOTP_SECRET
    assert BOOTSTRAP_TOTP_SECRET not in begin_body["otpauthUrl"]
    factor = store.identity.get_mfa_factor_by_id(existing_factor.factor_id)
    assert factor is not None
    assert factor.status == MfaFactorStatus.PENDING
    assert factor.payload["totpSecret"] == begin_body["manualEntryKey"]

    verify_response = client.post(
        "/api/admin/v1/auth/mfa/enroll/verify",
        json={
            "enrollmentToken": enrollment_token,
            "factorId": begin_body["factorId"],
            "otpCode": generate_totp_code(begin_body["manualEntryKey"]),
        },
    )
    assert verify_response.status_code == 200


def test_admin_auth_mfa_enrollment_begin_reuses_same_secret_for_same_token() -> None:
    email = f"repeat-begin-{uuid4().hex[:8]}@synapse-network.ai"
    store = _test_store()
    store.identity.create_user(
        AdminUser(
            admin_id=f"admin_{uuid4().hex[:12]}",
            email=email,
            display_name="Repeat Begin Admin",
            status=AdminUserStatus.ACTIVE,
            password_hash=hash_password(PLACEHOLDER_PASSWORD),
            require_mfa=True,
        )
    )
    client.cookies.clear()

    login_response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": email,
            "password": PLACEHOLDER_PASSWORD,
        },
    )
    assert login_response.status_code == 428
    enrollment_token = login_response.json()["data"]["enrollmentToken"]

    first_begin = client.post(
        "/api/admin/v1/auth/mfa/enroll/begin",
        json={"enrollmentToken": enrollment_token},
    )
    second_begin = client.post(
        "/api/admin/v1/auth/mfa/enroll/begin",
        json={"enrollmentToken": enrollment_token},
    )

    assert first_begin.status_code == 200
    assert second_begin.status_code == 200
    first_body = first_begin.json()["data"]
    second_body = second_begin.json()["data"]
    assert second_body["factorId"] == first_body["factorId"]
    assert second_body["manualEntryKey"] == first_body["manualEntryKey"]

    verify_response = client.post(
        "/api/admin/v1/auth/mfa/enroll/verify",
        json={
            "enrollmentToken": enrollment_token,
            "factorId": first_body["factorId"],
            "otpCode": generate_totp_code(first_body["manualEntryKey"]),
        },
    )
    assert verify_response.status_code == 200


def test_admin_auth_mfa_enrollment_begin_reuses_existing_primary_factor_identity() -> None:
    email = f"broken-factor-{uuid4().hex[:8]}@synapse-network.ai"
    store = _test_store()
    user = store.identity.create_user(
        AdminUser(
            admin_id=f"admin_{uuid4().hex[:12]}",
            email=email,
            display_name="Broken Factor Admin",
            status=AdminUserStatus.ACTIVE,
            password_hash=hash_password(PLACEHOLDER_PASSWORD),
            require_mfa=True,
        )
    )
    existing_factor = store.identity.upsert_mfa_factor(
        AdminMfaFactor(
            factor_id="factor_existing_primary",
            admin_id=user.admin_id,
            factor_type=MfaFactorType.TOTP,
            factor_label="primary",
            status=MfaFactorStatus.ACTIVE,
            payload={},
        )
    )

    client.cookies.clear()
    login_response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": email,
            "password": PLACEHOLDER_PASSWORD,
        },
    )
    assert login_response.status_code == 428
    enrollment_token = login_response.json()["data"]["enrollmentToken"]

    begin_response = client.post(
        "/api/admin/v1/auth/mfa/enroll/begin",
        json={"enrollmentToken": enrollment_token},
    )

    assert begin_response.status_code == 200
    begin_body = begin_response.json()["data"]
    assert begin_body["factorId"] == existing_factor.factor_id
    factors = store.identity.list_mfa_factors(user.admin_id)
    primary_factors = [
        factor
        for factor in factors
        if factor.factor_type == MfaFactorType.TOTP and factor.factor_label == "primary"
    ]
    assert len(primary_factors) == 1
    assert primary_factors[0].status == MfaFactorStatus.PENDING
    assert primary_factors[0].payload["totpSecret"] == begin_body["manualEntryKey"]


def test_admin_auth_mfa_enrollment_verify_revokes_other_totp_factors() -> None:
    email = f"rebind-factor-{uuid4().hex[:8]}@synapse-network.ai"
    store = _test_store()
    user = store.identity.create_user(
        AdminUser(
            admin_id=f"admin_{uuid4().hex[:12]}",
            email=email,
            display_name="Rebind Factor Admin",
            status=AdminUserStatus.ACTIVE,
            password_hash=hash_password(PLACEHOLDER_PASSWORD),
            require_mfa=True,
        )
    )

    client.cookies.clear()
    login_response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": email,
            "password": PLACEHOLDER_PASSWORD,
        },
    )
    assert login_response.status_code == 428
    enrollment_token = login_response.json()["data"]["enrollmentToken"]

    begin_response = client.post(
        "/api/admin/v1/auth/mfa/enroll/begin",
        json={"enrollmentToken": enrollment_token},
    )
    assert begin_response.status_code == 200
    begin_body = begin_response.json()["data"]

    legacy_factor = store.identity.upsert_mfa_factor(
        AdminMfaFactor(
            factor_id=f"legacy_{uuid4().hex[:12]}",
            admin_id=user.admin_id,
            factor_type=MfaFactorType.TOTP,
            factor_label="bootstrap_totp",
            status=MfaFactorStatus.ACTIVE,
            payload={"totpSecret": generate_totp_secret()},
        )
    )

    verify_response = client.post(
        "/api/admin/v1/auth/mfa/enroll/verify",
        json={
            "enrollmentToken": enrollment_token,
            "factorId": begin_body["factorId"],
            "otpCode": generate_totp_code(begin_body["manualEntryKey"]),
        },
    )

    assert verify_response.status_code == 200
    factors = store.identity.list_mfa_factors(user.admin_id)
    active_totp_factors = [
        factor
        for factor in factors
        if factor.factor_type == MfaFactorType.TOTP and factor.status == MfaFactorStatus.ACTIVE
    ]
    assert len(active_totp_factors) == 1
    assert active_totp_factors[0].factor_id == begin_body["factorId"]
    revoked_legacy_factor = next(factor for factor in factors if factor.factor_id == legacy_factor.factor_id)
    assert revoked_legacy_factor.status == MfaFactorStatus.REVOKED


def test_admin_auth_policy_exposes_google_authenticator_switches() -> None:
    response = client.get("/api/admin/v1/auth/policy")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["loginTotpRequired"] is True
    assert body["highRiskTotpRequired"] is True
    assert body["totpIssuer"] == "Synapse Gateway Admin"


def test_admin_auth_lockout_config_fail_closed() -> None:
    assert Settings(ADMIN_LOGIN_LOCK_THRESHOLD="5", ADMIN_LOGIN_LOCK_HOURS="24").admin_login_lock_threshold == 5
    assert Settings(ADMIN_LOGIN_LOCK_THRESHOLD="10", ADMIN_LOGIN_LOCK_HOURS="168").admin_login_lock_hours == 168

    for threshold in ("0", "11", "not-a-number"):
        try:
            Settings(ADMIN_LOGIN_LOCK_THRESHOLD=threshold)
        except ValueError as exc:
            assert "ADMIN_LOGIN_LOCK_THRESHOLD" in str(exc)
        else:
            raise AssertionError(f"expected threshold {threshold} to fail closed")

    for hours in ("0", "169", "not-a-number"):
        try:
            Settings(ADMIN_LOGIN_LOCK_HOURS=hours)
        except ValueError as exc:
            assert "ADMIN_LOGIN_LOCK_HOURS" in str(exc)
        else:
            raise AssertionError(f"expected lock hours {hours} to fail closed")


def test_admin_auth_policy_disables_login_totp_when_switch_is_off(monkeypatch) -> None:
    monkeypatch.setenv("ADMIN_GOOGLE_AUTHENTICATOR_LOGIN_ENABLED", "false")
    _refresh_auth_settings()

    try:
        response = client.get("/api/admin/v1/auth/policy")

        assert response.status_code == 200
        body = response.json()["data"]
        assert body["loginTotpRequired"] is False
        assert body["highRiskTotpRequired"] is True
    finally:
        _refresh_auth_settings()


def test_admin_auth_login_skips_google_authenticator_when_login_switch_is_off(monkeypatch) -> None:
    _ensure_unenrolled_admin("mfa-disabled@synapse-network.ai")
    monkeypatch.setenv("ADMIN_GOOGLE_AUTHENTICATOR_LOGIN_ENABLED", "false")
    _refresh_auth_settings()
    client.cookies.clear()

    try:
        response = client.post(
            "/api/admin/v1/auth/login",
            json={
                "email": "mfa-disabled@synapse-network.ai",
                "password": PLACEHOLDER_PASSWORD,
            },
        )

        assert response.status_code == 200
        body = response.json()["data"]
        assert body["admin"]["email"] == "mfa-disabled@synapse-network.ai"
        assert body["security"]["loginTotpRequired"] is False
        assert "synapse_admin_session=" in response.headers["set-cookie"]
    finally:
        _refresh_auth_settings()


def test_admin_auth_me_and_logout_use_cookie_session() -> None:
    csrf_headers = _login_as("ops@synapse-network.ai")

    me_response = client.get("/api/admin/v1/auth/me")
    assert me_response.status_code == 200
    assert me_response.json()["data"]["admin"]["email"] == "ops@synapse-network.ai"
    assert me_response.json()["data"]["csrfToken"]

    logout_response = client.post("/api/admin/v1/auth/logout", headers=csrf_headers)
    assert logout_response.status_code == 200
    assert logout_response.json()["data"]["loggedOut"] is True
    assert "synapse_admin_session=" in logout_response.headers["set-cookie"]

    me_after_logout = client.get("/api/admin/v1/auth/me")
    assert me_after_logout.status_code == 401


def test_admin_auth_login_rejects_wrong_password() -> None:
    email = f"wrong-password-{uuid4().hex[:8]}@synapse-network.ai"
    _create_enrolled_admin(email)
    response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": email,
            "password": "wrong-password",
            "otpCode": _otp_code_for(email),
        },
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_admin_auth_login_locks_after_five_wrong_passwords() -> None:
    email = f"lock-password-{uuid4().hex[:8]}@synapse-network.ai"
    user = _create_enrolled_admin(email)
    client.cookies.clear()

    for _ in range(4):
        response = client.post(
            "/api/admin/v1/auth/login",
            json={"email": email, "password": "wrong-password", "otpCode": _otp_code_for(email)},
        )
        assert response.status_code == 401

    store = _test_store()
    before_lock = store.identity.get_user_by_id(user.admin_id)
    assert before_lock is not None
    assert before_lock.failed_login_attempts == 4
    assert before_lock.locked_until is None

    fifth_response = client.post(
        "/api/admin/v1/auth/login",
        json={"email": email, "password": "wrong-password", "otpCode": _otp_code_for(email)},
    )
    assert fifth_response.status_code == 401
    locked_user = store.identity.get_user_by_id(user.admin_id)
    assert locked_user is not None
    assert locked_user.failed_login_attempts == 5
    assert locked_user.locked_until is not None

    lock_audits = store.audit.list_actions(action_type="admin.login.locked", operator_id=user.admin_id)
    assert len(lock_audits) == 1
    assert lock_audits[0].detail["failureStage"] == "password"
    assert lock_audits[0].detail["failedLoginAttempts"] == 5


def test_admin_auth_login_blocks_locked_account_even_with_valid_credentials() -> None:
    email = f"blocked-lock-{uuid4().hex[:8]}@synapse-network.ai"
    user = _create_enrolled_admin(email)
    store = _test_store()
    store.identity.lock_user_until(user.admin_id, datetime.now(timezone.utc) + timedelta(hours=24))
    client.cookies.clear()

    response = client.post(
        "/api/admin/v1/auth/login",
        json={"email": email, "password": PLACEHOLDER_PASSWORD, "otpCode": _otp_code_for(email)},
    )

    assert response.status_code == 423
    assert response.json()["error"]["code"] == "ADMIN_ACCOUNT_LOCKED"
    assert response.json()["error"]["message"] == "Admin account is temporarily locked. Try later or contact an owner."
    blocked_audits = store.audit.list_actions(action_type="admin.login.blocked_locked", operator_id=user.admin_id)
    assert len(blocked_audits) == 1
    assert blocked_audits[0].detail["failureStage"] == "locked"
    assert "locked_until" not in blocked_audits[0].detail


def test_admin_auth_login_rejects_invalid_google_authenticator_code() -> None:
    email = f"wrong-otp-{uuid4().hex[:8]}@synapse-network.ai"
    _create_enrolled_admin(email)
    response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": email,
            "password": PLACEHOLDER_PASSWORD,
            "otpCode": "000000",
        },
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_admin_auth_login_locks_after_five_invalid_google_authenticator_codes() -> None:
    email = f"lock-otp-{uuid4().hex[:8]}@synapse-network.ai"
    user = _create_enrolled_admin(email)
    client.cookies.clear()

    for _ in range(5):
        response = client.post(
            "/api/admin/v1/auth/login",
            json={"email": email, "password": PLACEHOLDER_PASSWORD, "otpCode": "000000"},
        )
        assert response.status_code == 401

    store = _test_store()
    locked_user = store.identity.get_user_by_id(user.admin_id)
    assert locked_user is not None
    assert locked_user.failed_login_attempts == 5
    assert locked_user.locked_until is not None
    lock_audits = store.audit.list_actions(action_type="admin.login.locked", operator_id=user.admin_id)
    assert len(lock_audits) == 1
    assert lock_audits[0].detail["failureStage"] == "otp"


def test_admin_auth_login_success_clears_failure_state_after_lock_expires() -> None:
    email = f"expired-lock-{uuid4().hex[:8]}@synapse-network.ai"
    user = _create_enrolled_admin(email)
    store = _test_store()
    store.identity.update_user(
        replace(
            user,
            failed_login_attempts=5,
            last_failed_login_at=datetime.now(timezone.utc) - timedelta(hours=2),
            locked_until=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
    )
    client.cookies.clear()

    response = client.post(
        "/api/admin/v1/auth/login",
        json={"email": email, "password": PLACEHOLDER_PASSWORD, "otpCode": _otp_code_for(email)},
    )

    assert response.status_code == 200
    cleared_user = store.identity.get_user_by_id(user.admin_id)
    assert cleared_user is not None
    assert cleared_user.failed_login_attempts == 0
    assert cleared_user.last_failed_login_at is None
    assert cleared_user.locked_until is None


def test_admin_auth_login_unknown_email_does_not_create_or_reveal_account() -> None:
    email = f"unknown-{uuid4().hex[:8]}@synapse-network.ai"
    store = _test_store()
    before_failure_audits = len(store.audit.list_actions(action_type="admin.login.failure"))
    client.cookies.clear()

    response = client.post(
        "/api/admin/v1/auth/login",
        json={"email": email, "password": "wrong-password", "otpCode": "000000"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"
    assert store.identity.get_user_by_email(email) is None
    after_failure_audits = len(store.audit.list_actions(action_type="admin.login.failure"))
    assert after_failure_audits == before_failure_audits


def test_admin_users_catalog_and_create_user() -> None:
    csrf_headers = _login_as("cliff@synapse-network.ai")
    store = _test_store()

    roles_response = client.get("/api/admin/v1/users/roles")
    assert roles_response.status_code == 200
    role_items = roles_response.json()["data"]["items"]
    assert any(item["roleKey"] == "super_admin" for item in role_items)

    create_response = client.post(
        "/api/admin/v1/users",
        headers=csrf_headers,
        json={
            "email": "new-ops@synapse-network.ai",
            "displayName": "New Ops",
            "roleKey": "platform_ops_admin",
            "password": PLACEHOLDER_PASSWORD,
            "requireMfa": False,
            "status": "active",
        },
    )
    assert create_response.status_code == 200
    created_admin = create_response.json()["data"]["admin"]
    assert created_admin["email"] == "new-ops@synapse-network.ai"
    assert created_admin["roleKeys"] == ["platform_ops_admin"]
    bindings = store.authorization.list_role_bindings(created_admin["adminId"])
    assert len(bindings) == 1
    assert bindings[0].starts_at is not None

    list_response = client.get("/api/admin/v1/users")
    assert list_response.status_code == 200
    emails = [item["email"] for item in list_response.json()["data"]["items"]]
    assert "new-ops@synapse-network.ai" in emails


def test_admin_users_update_and_disable_user() -> None:
    csrf_headers = _login_as("cliff@synapse-network.ai")

    create_response = client.post(
        "/api/admin/v1/users",
        headers=csrf_headers,
        json={
            "email": "crud-user@synapse-network.ai",
            "displayName": "CRUD User",
            "roleKey": "platform_ops_admin",
            "password": PLACEHOLDER_PASSWORD,
            "requireMfa": False,
            "status": "active",
        },
    )
    assert create_response.status_code == 200
    admin_id = create_response.json()["data"]["admin"]["adminId"]

    update_response = client.patch(
        f"/api/admin/v1/users/{admin_id}",
        headers=csrf_headers,
        json={
            "displayName": "Updated CRUD User",
            "roleKey": "finance_admin",
            "password": "",
            "requireMfa": True,
            "status": "active",
        },
    )
    assert update_response.status_code == 200
    updated_admin = update_response.json()["data"]["admin"]
    assert updated_admin["displayName"] == "Updated CRUD User"
    assert updated_admin["roleKeys"] == ["finance_admin"]
    assert updated_admin["requireMfa"] is True

    delete_response = client.delete(f"/api/admin/v1/users/{admin_id}", headers=csrf_headers)
    assert delete_response.status_code == 200
    assert delete_response.json()["data"]["status"] == "disabled"

    filtered_response = client.get("/api/admin/v1/users?status=disabled&search=crud-user&roleKey=finance_admin")
    assert filtered_response.status_code == 200
    filtered_items = filtered_response.json()["data"]["items"]
    assert len(filtered_items) == 1
    assert filtered_items[0]["adminId"] == admin_id


def test_admin_roles_crud_flow() -> None:
    csrf_headers = _login_as("cliff@synapse-network.ai")

    permissions_response = client.get("/api/admin/v1/users/permissions")
    assert permissions_response.status_code == 200
    permission_keys = [item["permissionKey"] for item in permissions_response.json()["data"]["items"]]
    assert "dashboard:read" in permission_keys

    create_response = client.post(
        "/api/admin/v1/users/roles",
        headers=csrf_headers,
        json={
            "roleKey": "ops_shift_manager",
            "roleName": "Ops Shift Manager",
            "description": "Shift-level control plane operator",
            "status": "active",
            "permissions": ["dashboard:read", "execution:read"],
        },
    )
    assert create_response.status_code == 200
    created_role = create_response.json()["data"]["role"]
    assert created_role["roleKey"] == "ops_shift_manager"
    assert created_role["permissions"] == ["dashboard:read", "execution:read"]

    update_response = client.patch(
        "/api/admin/v1/users/roles/ops_shift_manager",
        headers=csrf_headers,
        json={
            "roleName": "Ops Shift Lead",
            "description": "Lead for operations shift",
            "status": "active",
            "permissions": ["dashboard:read", "execution:read", "audit:read"],
        },
    )
    assert update_response.status_code == 200
    updated_role = update_response.json()["data"]["role"]
    assert updated_role["roleName"] == "Ops Shift Lead"
    assert "audit:read" in updated_role["permissions"]

    delete_response = client.delete("/api/admin/v1/users/roles/ops_shift_manager", headers=csrf_headers)
    assert delete_response.status_code == 200
    assert delete_response.json()["data"]["status"] == "disabled"


def test_admin_menu_config_crud_and_publish_flow() -> None:
    csrf_headers = _login_as("cliff@synapse-network.ai")

    list_response = client.get("/api/admin/v1/config/menu-items")
    assert list_response.status_code == 200
    assert any(item["itemId"] == "dashboard" for item in list_response.json()["data"]["items"])
    dashboard_item = next(item for item in list_response.json()["data"]["items"] if item["itemId"] == "dashboard")
    assert dashboard_item["parentItemId"] == "control-overview"
    assert dashboard_item["nodeType"] == "category"
    assert dashboard_item["href"] is None
    assert dashboard_item["iconKey"] == "OV"
    dashboard_runtime_item = next(item for item in list_response.json()["data"]["items"] if item["itemId"] == "dashboard-runtime")
    assert dashboard_runtime_item["parentItemId"] == "dashboard"
    assert dashboard_runtime_item["nodeType"] == "page"
    assert dashboard_runtime_item["href"] == "/dashboard/runtime"

    create_response = client.post(
        "/api/admin/v1/config/menu-items",
        headers=csrf_headers,
        json={
            "itemId": "ops-copilot",
            "sectionId": "ops-controls",
            "sectionLabel": "业务控制",
            "sectionDescription": "审批、资金、风控和系统运维的受控操作入口。",
            "label": "运行副驾",
            "href": "/ops-copilot",
            "description": "值班辅助和运行手册入口。",
            "parentItemId": "business-control",
            "nodeType": "page",
            "iconKey": "OC",
            "requiredRoles": ["super_admin"],
            "requiredPermissions": ["dashboard:read"],
            "sortOrder": 65,
            "keywords": ["copilot", "runbook"],
        },
    )
    assert create_response.status_code == 200
    created_item = next(item for item in create_response.json()["data"]["items"] if item["itemId"] == "ops-copilot")
    assert created_item["parentItemId"] == "business-control"
    assert created_item["nodeType"] == "page"
    assert created_item["iconKey"] == "OC"
    assert created_item["keywords"] == ["copilot", "runbook"]
    assert create_response.json()["data"]["meta"]["isDirty"] is True

    update_response = client.patch(
        "/api/admin/v1/config/menu-items/ops-copilot",
        headers=csrf_headers,
        json={
            "sectionId": "ops-controls",
            "sectionLabel": "业务控制",
            "sectionDescription": "审批、资金、风控和系统运维的受控操作入口。",
            "label": "运行副驾中心",
            "href": "/ops-copilot",
            "description": "值班辅助和运行手册入口。",
            "parentItemId": "business-control",
            "nodeType": "page",
            "iconKey": "OC",
            "requiredRoles": ["super_admin", "platform_ops_admin"],
            "requiredPermissions": ["dashboard:read"],
            "sortOrder": 66,
            "keywords": ["copilot", "shift"],
        },
    )
    assert update_response.status_code == 200
    updated_item = next(item for item in update_response.json()["data"]["items"] if item["itemId"] == "ops-copilot")
    assert updated_item["label"] == "运行副驾中心"
    assert updated_item["keywords"] == ["copilot", "shift"]

    publish_headers = {**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("cliff@synapse-network.ai")}
    publish_response = client.post("/api/admin/v1/config/menu-items/publish", headers=publish_headers)
    assert publish_response.status_code == 200
    assert publish_response.json()["data"]["meta"]["isDirty"] is False

    published_response = client.get("/api/admin/v1/config/menu-items?stage=published")
    assert published_response.status_code == 200
    assert any(item["itemId"] == "ops-copilot" for item in published_response.json()["data"]["items"])

    delete_response = client.delete("/api/admin/v1/config/menu-items/ops-copilot", headers=csrf_headers)
    assert delete_response.status_code == 200
    assert all(item["itemId"] != "ops-copilot" for item in delete_response.json()["data"]["items"])


def test_visible_menu_config_is_filtered_by_backend_permissions() -> None:
    _login_as("finance@synapse-network.ai")

    response = client.get("/api/admin/v1/config/menu-items/visible")
    assert response.status_code == 200
    item_ids = {item["itemId"] for item in response.json()["data"]["items"]}
    assert item_ids == {
        "control-overview",
        "dashboard",
        "dashboard-overview",
        "dashboard-runtime",
        "analytics",
        "dashboard-analytics",
        "analytics-consumer-funnel",
        "analytics-invocation-revenue",
        "analytics-provider-revenue",
        "analytics-money-flow",
        "analytics-risk-health",
        "analytics-data-quality",
        "provider-services",
        "system",
        "business-control",
        "approvals",
        "withdrawal-reviews",
        "review-history",
        "finance",
        "risk",
    }
    runtime_item = next(item for item in response.json()["data"]["items"] if item["itemId"] == "dashboard-runtime")
    dashboard_item = next(item for item in response.json()["data"]["items"] if item["itemId"] == "dashboard")
    analytics_item = next(item for item in response.json()["data"]["items"] if item["itemId"] == "analytics")
    analytics_overview_item = next(item for item in response.json()["data"]["items"] if item["itemId"] == "dashboard-analytics")
    consumer_funnel_item = next(item for item in response.json()["data"]["items"] if item["itemId"] == "analytics-consumer-funnel")
    system_item = next(item for item in response.json()["data"]["items"] if item["itemId"] == "system")
    provider_services_item = next(item for item in response.json()["data"]["items"] if item["itemId"] == "provider-services")
    assert dashboard_item["href"] is None
    assert dashboard_item["nodeType"] == "category"
    assert analytics_item["href"] is None
    assert analytics_item["nodeType"] == "category"
    assert analytics_item["parentItemId"] == "dashboard"
    assert analytics_overview_item["href"] == "/dashboard/analytics"
    assert analytics_overview_item["parentItemId"] == "analytics"
    assert consumer_funnel_item["href"] == "/dashboard/analytics/consumer-funnel"
    assert consumer_funnel_item["parentItemId"] == "analytics"
    assert runtime_item["href"] == "/dashboard/runtime"
    assert system_item["href"] == "/system"
    assert provider_services_item["href"] == "/provider-services"


def test_provider_services_management_routes_proxy_gateway_state() -> None:
    csrf_headers = _login_as("cliff@synapse-network.ai")

    list_response = client.get("/api/admin/v1/provider-services")
    assert list_response.status_code == 200
    body = list_response.json()["data"]
    assert body["totalCount"] == 1
    assert body["items"][0]["serviceId"] == "svc_quotes"
    assert body["items"][0]["runtimeAvailable"] is True
    assert body["items"][0]["probeTier"] == "normal"
    assert body["items"][0]["adaptiveConcurrencyLimit"] == 8
    assert body["items"][0]["inFlight"] == 1
    assert body["items"][0]["latencyP95Ms"] == 42
    assert body["items"][0]["circuitState"] == "closed"

    probe_response = client.post(
        "/api/admin/v1/provider-services/svc_quotes/force-probe",
        headers=csrf_headers,
    )
    assert probe_response.status_code == 200
    assert probe_response.json()["data"]["service"]["runtimeStatus"] == "healthy"
    assert probe_response.json()["data"]["service"]["probeTier"] == "normal"

    pause_response = client.post(
        "/api/admin/v1/provider-services/svc_quotes/lifecycle",
        headers=csrf_headers,
        json={"action": "PAUSE", "note": "ops pause"},
    )
    assert pause_response.status_code == 200
    assert pause_response.json()["data"]["service"]["controlStatus"] == "inactive"
    assert pause_response.json()["data"]["service"]["probeTier"] == "manual_only"


def test_menu_config_delete_removes_descendants() -> None:
    csrf_headers = _login_as("cliff@synapse-network.ai")

    create_response = client.post(
        "/api/admin/v1/config/menu-items",
        headers=csrf_headers,
        json={
            "itemId": "ops-root",
            "sectionId": "ops-controls",
            "sectionLabel": "业务控制",
            "sectionDescription": "审批、资金、风控和系统运维的受控操作入口。",
            "label": "Ops Root",
            "href": None,
            "description": "临时父节点。",
            "nodeType": "category",
            "iconKey": "OR",
            "requiredRoles": ["super_admin"],
            "requiredPermissions": [],
            "sortOrder": 500,
            "keywords": ["temporary"],
        },
    )
    assert create_response.status_code == 200

    child_response = client.post(
        "/api/admin/v1/config/menu-items",
        headers=csrf_headers,
        json={
            "itemId": "ops-child",
            "sectionId": "ops-controls",
            "sectionLabel": "业务控制",
            "sectionDescription": "审批、资金、风控和系统运维的受控操作入口。",
            "label": "Ops Child",
            "href": "/ops-child",
            "description": "临时子节点。",
            "parentItemId": "ops-root",
            "nodeType": "page",
            "iconKey": "OC",
            "requiredRoles": ["super_admin"],
            "requiredPermissions": ["dashboard:read"],
            "sortOrder": 501,
            "keywords": ["temporary"],
        },
    )
    assert child_response.status_code == 200

    delete_response = client.delete("/api/admin/v1/config/menu-items/ops-root", headers=csrf_headers)
    assert delete_response.status_code == 200
    deleted_ids = {item["itemId"] for item in delete_response.json()["data"]["items"]}
    assert "ops-root" not in deleted_ids
    assert "ops-child" not in deleted_ids


def test_visible_menu_config_returns_full_tree_for_super_admin() -> None:
    _login_as("cliff@synapse-network.ai")

    published_response = client.get("/api/admin/v1/config/menu-items?stage=published")
    visible_response = client.get("/api/admin/v1/config/menu-items/visible")

    assert published_response.status_code == 200
    assert visible_response.status_code == 200
    published_ids = {item["itemId"] for item in published_response.json()["data"]["items"]}
    visible_items = visible_response.json()["data"]["items"]
    visible_ids = {item["itemId"] for item in visible_items}
    assert visible_ids == published_ids
    visible_by_id = {item["itemId"]: item for item in visible_items}
    assert visible_by_id["permissions-matrix"]["href"] == "/role-permissions#permissions-matrix"
    assert visible_by_id["module-boundaries"]["href"] == "/role-permissions#module-boundaries"
    assert visible_by_id["reviewer-split"]["href"] == "/role-permissions#reviewer-split"


def test_approvals_list_includes_projected_provider_withdraw_reviews() -> None:
    _login_as("finance-review@synapse-network.ai")

    response = client.get("/api/admin/v1/approvals?limit=20")
    assert response.status_code == 200
    items = response.json()["data"]["items"]
    projected = [item for item in items if item["approvalType"] == "provider_withdraw_review"]
    assert projected
    assert all(item["approvalId"].startswith("PWR-") for item in projected)
    assert all(item["status"] == "UNDER_REVIEW" for item in projected)


def test_approvals_list_filter_can_select_only_projected_provider_reviews() -> None:
    _login_as("finance-review@synapse-network.ai")

    response = client.get("/api/admin/v1/approvals?approvalType=provider_withdraw_review&status=UNDER_REVIEW&limit=20")
    assert response.status_code == 200
    items = response.json()["data"]["items"]
    assert len(items) >= 1
    assert all(item["approvalType"] == "provider_withdraw_review" for item in items)
    assert all(item["status"] == "UNDER_REVIEW" for item in items)


def test_approval_decision_can_route_to_projected_provider_withdraw_review() -> None:
    csrf_headers = _login_as("finance-review@synapse-network.ai")

    response = client.post(
        "/api/admin/v1/approvals/PWR-wd-demo-review-002/decision",
        headers={**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("finance-review@synapse-network.ai")},
        json={
            "decision": "APPROVE",
            "comment": "Projected approval routed to provider manual review flow.",
        },
    )
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["approvalId"] == "PWR-wd-demo-review-002"
    assert payload["status"] == "APPROVED_AUTO"


def test_provider_withdraw_review_list_and_decision() -> None:
    csrf_headers = _login_as("finance-review@synapse-network.ai")
    repository = _test_provider_withdraw_review_repository()
    expired_review_id = f"wd-expired-review-{uuid4().hex[:6]}"
    if isinstance(repository, InMemoryProviderWithdrawReviewRepository):
        repository._items.append(
            ProviderWithdrawReviewItem(
                withdrawal_id=expired_review_id,
                withdrawal_kind="consumer_refund",
                review_type="consumer_withdraw_review",
                owner_address="0x3333333333333333333333333333333333333333",
                subject_address="0x3333333333333333333333333333333333333333",
                amount_usdc=Decimal("77.00"),
                status="PENDING_MANUAL_REVIEW",
                request_id="expired-review-request",
                tx_hash=None,
                risk_level="red",
                risk_reason_code="MANUAL_REVIEW_TIMEOUT",
                evidence_summary="Expired rows must not remain in the active queue.",
                message="Expired row",
                created_at="2026-03-18T09:30:00Z",
                updated_at="2026-03-18T09:30:00Z",
                review_expires_at="2026-03-19T09:30:00Z",
            )
        )

    list_response = client.get("/api/admin/v1/withdrawal-reviews?limit=10")
    assert list_response.status_code == 200
    items = list_response.json()["data"]["items"]
    assert len(items) >= 1
    first_item = items[0]
    assert first_item["status"] == "PENDING_MANUAL_REVIEW"
    assert "reviewExpiresAt" in first_item
    assert first_item["reviewExpiresAt"] is not None
    assert expired_review_id not in [item["withdrawalId"] for item in items]

    decision_response = client.post(
        f"/api/admin/v1/withdrawal-reviews/{first_item['withdrawalId']}/decision",
        headers={**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("finance-review@synapse-network.ai")},
        json={
            "decision": "APPROVE",
            "note": "Looks consistent with provider income.",
        },
    )
    assert decision_response.status_code == 200
    result = decision_response.json()["data"]
    assert result["reviewDecision"] == "APPROVE"
    assert result["status"] == "APPROVED_AUTO"

    list_after_response = client.get("/api/admin/v1/withdrawal-reviews?limit=10")
    assert list_after_response.status_code == 200
    remaining_ids = [item["withdrawalId"] for item in list_after_response.json()["data"]["items"]]
    assert first_item["withdrawalId"] not in remaining_ids


def test_withdraw_review_list_and_decision_supports_consumer_manual_withdrawal() -> None:
    csrf_headers = _login_as("finance-review@synapse-network.ai")
    repository = _test_provider_withdraw_review_repository()
    consumer_review_id = f"wd-consumer-review-{uuid4().hex[:8]}"
    if isinstance(repository, InMemoryProviderWithdrawReviewRepository):
            repository._items.append(
                ProviderWithdrawReviewItem(
                    withdrawal_id=consumer_review_id,
                withdrawal_kind="consumer_refund",
                review_type="consumer_withdraw_review",
                owner_address="0x2222222222222222222222222222222222222222",
                subject_address="0x2222222222222222222222222222222222222222",
                amount_usdc=Decimal("600.00"),
                status="PENDING_MANUAL_REVIEW",
                request_id="consumer-review-request",
                tx_hash=None,
                    risk_level="yellow",
                    risk_reason_code="CONSUMER_WITHDRAW_MANUAL_REVIEW",
                    evidence_summary="Consumer withdrawal exceeded manual review threshold.",
                    message="Manual review required before releasing frozen consumer balance.",
                    created_at=(datetime.now(timezone.utc) + timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
                    updated_at=(datetime.now(timezone.utc) + timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
                )
            )

    list_response = client.get("/api/admin/v1/withdrawal-reviews?limit=20")
    assert list_response.status_code == 200
    items = list_response.json()["data"]["items"]
    consumer_item = next(item for item in items if item["withdrawalId"] == consumer_review_id)
    assert consumer_item["withdrawalKind"] == "consumer_refund"
    assert consumer_item["reviewType"] == "consumer_withdraw_review"

    decision_response = client.post(
        f"/api/admin/v1/withdrawal-reviews/{consumer_review_id}/decision",
        headers={**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("finance-review@synapse-network.ai")},
        json={
            "decision": "REJECT",
            "note": "Consumer withdrawal risk rejected; funds must return to available.",
        },
    )
    assert decision_response.status_code == 200
    result = decision_response.json()["data"]
    assert result["withdrawalKind"] == "consumer_refund"
    assert result["reviewDecision"] == "REJECT"
    assert result["status"] == "REJECTED"

    audit = TEST_STORE.audit.list_actions(action_type="withdrawal_review.decide", limit=1)[0]
    assert audit.resource_type == "consumer_refund"
    assert audit.detail["withdrawalKind"] == "consumer_refund"


def test_provider_withdraw_review_decision_rejects_bad_inputs() -> None:
    csrf_headers = _login_as("finance-review@synapse-network.ai")
    repository = _test_provider_withdraw_review_repository()
    non_pending_id = f"wd-reviewed-{uuid4().hex[:8]}"
    if isinstance(repository, InMemoryProviderWithdrawReviewRepository):
        repository._items.append(
            ProviderWithdrawReviewItem(
                withdrawal_id=non_pending_id,
                withdrawal_kind="provider_withdrawal",
                review_type="provider_withdraw_review",
                owner_address="0x1111111111111111111111111111111111111111",
                subject_address="0x1111111111111111111111111111111111111111",
                amount_usdc=Decimal("64.00"),
                status="APPROVED_AUTO",
                request_id="already-reviewed-request",
                tx_hash=None,
                risk_level="yellow",
                risk_reason_code="AUTO_SINGLE_LIMIT_EXCEEDED",
                evidence_summary="Already reviewed fixture.",
                message="Already reviewed.",
                created_at="2026-03-20T09:30:00Z",
                updated_at="2026-03-20T09:30:00Z",
            )
        )

    invalid_decision = client.post(
        "/api/admin/v1/withdrawal-reviews/wd-demo-review-001/decision",
        headers={**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("finance-review@synapse-network.ai")},
        json={"decision": "HOLD", "note": "unsupported"},
    )
    assert invalid_decision.status_code == 400

    missing_item = client.post(
        "/api/admin/v1/withdrawal-reviews/wd-does-not-exist/decision",
        headers={**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("finance-review@synapse-network.ai")},
        json={"decision": "APPROVE", "note": "missing"},
    )
    assert missing_item.status_code == 404

    non_pending = client.post(
        f"/api/admin/v1/withdrawal-reviews/{non_pending_id}/decision",
        headers={**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("finance-review@synapse-network.ai")},
        json={"decision": "REJECT", "note": "already handled"},
    )
    assert non_pending.status_code == 400
    assert "not awaiting manual review" in non_pending.json()["error"]["message"]


def test_http_withdraw_review_adapter_routes_consumer_review_to_refund_endpoint(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(url, *, json, headers, timeout):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        captured["timeout"] = timeout

        class Response:
            is_success = True
            status_code = 200
            text = ""

            @staticmethod
            def json():
                return {"refundId": "wd-consumer-review-http", "status": "REJECTED"}

        return Response()

    monkeypatch.setattr("src.services.adapters.provider_withdraw_review.httpx.post", fake_post)
    adapter = HttpProviderWithdrawReviewAdapter(
        base_url="https://gateway.example",
        admin_wallet="0x3333333333333333333333333333333333333333",
        jwt_secret="test-secret",
        token_issuer="gateway-admin-test",
        token_audience="gateway-test",
        service_subject="gateway-admin",
        timeout_sec=3.0,
    )
    item = ProviderWithdrawReviewItem(
        withdrawal_id="wd-consumer-review-http",
        withdrawal_kind="consumer_refund",
        review_type="consumer_withdraw_review",
        owner_address="0x2222222222222222222222222222222222222222",
        subject_address="0x2222222222222222222222222222222222222222",
        amount_usdc=Decimal("600.00"),
        status="PENDING_MANUAL_REVIEW",
        request_id="consumer-review-request",
        tx_hash=None,
        risk_level="yellow",
        risk_reason_code="CONSUMER_WITHDRAW_MANUAL_REVIEW",
        evidence_summary="Consumer withdrawal exceeded manual review threshold.",
        message="Manual review required before releasing frozen consumer balance.",
        created_at="2026-03-20T09:30:00Z",
        updated_at="2026-03-20T09:30:00Z",
    )

    result = adapter.review_withdrawal(
        item,
        decision="REJECT",
        reviewer=AdminIdentity(
            admin_id="admin-1",
            email="finance-review@synapse-network.ai",
            display_name="Finance Review",
            role="finance_reviewer",
            permissions=("approval:decide",),
        ),
        note="Reject consumer manual withdrawal.",
    )

    assert result["status"] == "REJECTED"
    assert captured["url"] == "https://gateway.example/api/v1/admin/refunds/wd-consumer-review-http/review"
    assert captured["json"]["reviewDecision"] == "REJECT"
    assert captured["headers"]["X-Request-Id"] == "consumer_withdraw_review:wd-consumer-review-http:reject"


def _http_review_adapter() -> HttpProviderWithdrawReviewAdapter:
    return HttpProviderWithdrawReviewAdapter(
        base_url="https://gateway.example",
        admin_wallet="0x3333333333333333333333333333333333333333",
        jwt_secret="test-secret",
        token_issuer="gateway-admin-test",
        token_audience="gateway-test",
        service_subject="gateway-admin",
        timeout_sec=3.0,
    )


def _provider_review_item() -> ProviderWithdrawReviewItem:
    return ProviderWithdrawReviewItem(
        withdrawal_id="wd-provider-review-http",
        withdrawal_kind="provider_withdrawal",
        review_type="provider_withdraw_review",
        owner_address="0x2222222222222222222222222222222222222222",
        subject_address="0x2222222222222222222222222222222222222222",
        amount_usdc=Decimal("64.00"),
        status="PENDING_MANUAL_REVIEW",
        request_id="provider-review-request",
        tx_hash=None,
        risk_level="yellow",
        risk_reason_code="AUTO_SINGLE_LIMIT_EXCEEDED",
        evidence_summary="Provider withdrawal exceeded manual review threshold.",
        message="Manual review required before issuing withdraw ticket.",
        created_at="2026-03-20T09:30:00Z",
        updated_at="2026-03-20T09:30:00Z",
    )


def _reviewer_identity() -> AdminIdentity:
    return AdminIdentity(
        admin_id="admin-1",
        email="finance-review@synapse-network.ai",
        display_name="Finance Review",
        role="finance_reviewer",
        permissions=("approval:decide",),
    )


def test_http_withdraw_review_adapter_handles_gateway_validation_detail_list(monkeypatch) -> None:
    def fake_post(url, *, json, headers, timeout):
        class Response:
            is_success = False
            status_code = 422
            text = "unprocessable"

            @staticmethod
            def json():
                return {
                    "detail": [
                        {"loc": ["body", "reviewDecision"], "msg": "String should have at least 6 characters"},
                        "plain validation failure",
                    ]
                }

        return Response()

    monkeypatch.setattr("src.services.adapters.provider_withdraw_review.httpx.post", fake_post)
    try:
        _http_review_adapter().review_withdrawal(
            _provider_review_item(),
            decision="REJECT",
            reviewer=_reviewer_identity(),
            note="Reject provider withdrawal.",
        )
    except ProviderWithdrawReviewError as exc:
        assert exc.code == "GATEWAY_HTTP_422"
        assert "String should have at least 6 characters" in exc.message
        assert "plain validation failure" in exc.message
    else:
        raise AssertionError("expected ProviderWithdrawReviewError")


def test_http_withdraw_review_adapter_propagates_gateway_error_detail_dict(monkeypatch) -> None:
    def fake_post(url, *, json, headers, timeout):
        class Response:
            is_success = False
            status_code = 409
            text = "conflict"

            @staticmethod
            def json():
                return {"detail": {"code": "WITHDRAWAL_NOT_REVIEWABLE", "message": "Withdrawal is not awaiting review."}}

        return Response()

    monkeypatch.setattr("src.services.adapters.provider_withdraw_review.httpx.post", fake_post)
    try:
        _http_review_adapter().review_withdrawal(
            _provider_review_item(),
            decision="APPROVE",
            reviewer=_reviewer_identity(),
            note="Approve provider withdrawal.",
        )
    except ProviderWithdrawReviewError as exc:
        assert exc.code == "WITHDRAWAL_NOT_REVIEWABLE"
        assert exc.message == "Withdrawal is not awaiting review."
        assert exc.status_code == 409
    else:
        raise AssertionError("expected ProviderWithdrawReviewError")


def test_provider_withdraw_review_history_returns_reviewed_items() -> None:
    csrf_headers = _login_as("finance-review@synapse-network.ai")
    repository = _test_provider_withdraw_review_repository()
    review_item_id = f"wd-history-{uuid4().hex[:8]}"
    if isinstance(repository, InMemoryProviderWithdrawReviewRepository):
        repository._items.append(
            ProviderWithdrawReviewItem(
                withdrawal_id=review_item_id,
                withdrawal_kind="provider_withdrawal",
                review_type="provider_withdraw_review",
                owner_address="0x1111111111111111111111111111111111111111",
                subject_address="0x1111111111111111111111111111111111111111",
                amount_usdc=Decimal("64.00"),
                status="PENDING_MANUAL_REVIEW",
                request_id="history-review-request",
                tx_hash=None,
                risk_level="yellow",
                risk_reason_code="AUTO_SINGLE_LIMIT_EXCEEDED",
                evidence_summary="Seeded by test for review history endpoint.",
                message="Manual review required before issuing withdraw ticket.",
                created_at="2026-03-20T09:30:00Z",
                updated_at="2026-03-20T09:30:00Z",
            )
        )

    decision_response = client.post(
        f"/api/admin/v1/withdrawal-reviews/{review_item_id}/decision",
        headers={**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("finance-review@synapse-network.ai")},
        json={
            "decision": "APPROVE",
            "note": "History page should show this reviewed item.",
        },
    )
    assert decision_response.status_code == 200

    history_response = client.get("/api/admin/v1/withdrawal-reviews/history?limit=10")
    assert history_response.status_code == 200
    payload = history_response.json()["data"]
    items = payload["items"]
    reviewed = next(item for item in items if item["withdrawalId"] == review_item_id)
    assert reviewed["reviewDecision"] == "APPROVE"
    assert reviewed["currentStatus"] == "APPROVED_AUTO"
    assert reviewed["reviewerNote"] == "History page should show this reviewed item."
    assert reviewed["riskLevel"] == "yellow"
    assert reviewed["riskReasonCode"] == "AUTO_SINGLE_LIMIT_EXCEEDED"
    assert reviewed["evidenceSummary"] == "Seeded by test for review history endpoint."
    assert reviewed["createdAt"] == "2026-03-20T09:30:00Z"
    assert reviewed["updatedAt"] is not None
    assert payload["totalCount"] >= 1
    assert payload["totalPages"] >= 1


def test_provider_withdraw_review_history_supports_filters_and_pagination() -> None:
    csrf_headers = _login_as("finance-review@synapse-network.ai")
    repository = _test_provider_withdraw_review_repository()
    review_ids = [f"wd-history-filter-{uuid4().hex[:6]}", f"wd-history-filter-{uuid4().hex[:6]}"]
    reviewed_on = datetime.now(timezone.utc).date().isoformat()
    if isinstance(repository, InMemoryProviderWithdrawReviewRepository):
        repository._items.extend(
            [
                ProviderWithdrawReviewItem(
                    withdrawal_id=review_ids[0],
                    withdrawal_kind="provider_withdrawal",
                    review_type="provider_withdraw_review",
                    owner_address="0x9999999999999999999999999999999999999991",
                    subject_address="0x9999999999999999999999999999999999999991",
                    amount_usdc=Decimal("51.00"),
                    status="PENDING_MANUAL_REVIEW",
                    request_id="history-page-1",
                    tx_hash=None,
                    risk_level="yellow",
                    risk_reason_code="AUTO_SINGLE_LIMIT_EXCEEDED",
                    evidence_summary="First paginated reviewer record.",
                    message="Awaiting reviewer action.",
                    created_at="2026-03-21T08:00:00Z",
                    updated_at="2026-03-21T08:00:00Z",
                ),
                ProviderWithdrawReviewItem(
                    withdrawal_id=review_ids[1],
                    withdrawal_kind="provider_withdrawal",
                    review_type="provider_withdraw_review",
                    owner_address="0x9999999999999999999999999999999999999992",
                    subject_address="0x9999999999999999999999999999999999999992",
                    amount_usdc=Decimal("52.00"),
                    status="PENDING_MANUAL_REVIEW",
                    request_id="history-page-2",
                    tx_hash=None,
                    risk_level="yellow",
                    risk_reason_code="AUTO_SINGLE_LIMIT_EXCEEDED",
                    evidence_summary="Second paginated reviewer record.",
                    message="Awaiting reviewer action.",
                    created_at="2026-03-22T08:00:00Z",
                    updated_at="2026-03-22T08:00:00Z",
                ),
            ]
        )

    for withdrawal_id in review_ids:
        decision_response = client.post(
            f"/api/admin/v1/withdrawal-reviews/{withdrawal_id}/decision",
            headers={**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("finance-review@synapse-network.ai")},
            json={
                "decision": "APPROVE",
                "note": f"Reviewed item {withdrawal_id}",
            },
        )
        assert decision_response.status_code == 200

    first_page_response = client.get(
        f"/api/admin/v1/withdrawal-reviews/history?query=wd-history-filter-&reviewer=finance-review&reviewedFrom={reviewed_on}&reviewedTo={reviewed_on}&limit=1"
    )
    assert first_page_response.status_code == 200
    first_page = first_page_response.json()["data"]
    assert len(first_page["items"]) == 1
    assert first_page["items"][0]["withdrawalId"] == review_ids[1]
    assert first_page["nextCursor"] == "1"
    assert first_page["totalCount"] == 2
    assert first_page["totalPages"] == 2

    second_page_response = client.get(
        f"/api/admin/v1/withdrawal-reviews/history?query=wd-history-filter-&reviewer=finance-review&reviewedFrom={reviewed_on}&reviewedTo={reviewed_on}&limit=1&cursor={first_page['nextCursor']}"
    )
    assert second_page_response.status_code == 200
    second_page = second_page_response.json()["data"]
    assert len(second_page["items"]) == 1
    assert second_page["items"][0]["withdrawalId"] == review_ids[0]
    assert second_page["nextCursor"] is None
    assert second_page["totalCount"] == 2
    assert second_page["totalPages"] == 2


def test_provider_withdraw_review_history_rejects_invalid_filters() -> None:
    _login_as("finance-review@synapse-network.ai")

    bad_date = client.get("/api/admin/v1/withdrawal-reviews/history?reviewedFrom=2026-99-99")
    assert bad_date.status_code == 400

    bad_datetime = client.get("/api/admin/v1/withdrawal-reviews/history?reviewedTo=not-a-datetime")
    assert bad_datetime.status_code == 400

    bad_cursor = client.get("/api/admin/v1/withdrawal-reviews/history?cursor=abc")
    assert bad_cursor.status_code == 400

    negative_cursor = client.get("/api/admin/v1/withdrawal-reviews/history?cursor=-1")
    assert negative_cursor.status_code == 400

    reversed_range = client.get(
        "/api/admin/v1/withdrawal-reviews/history?reviewedFrom=2026-03-22&reviewedTo=2026-03-21"
    )
    assert reversed_range.status_code == 400


def test_postgres_withdraw_review_item_defaults_and_consumer_kind() -> None:
    repository = PostgresProviderWithdrawReviewRepository("postgresql://example")
    created_at = datetime(2026, 3, 20, 9, 30, tzinfo=timezone.utc)

    default_item = repository._to_item(
        {
            "withdrawal_id": "wd-default-kind",
            "owner_wallet": "0x1111111111111111111111111111111111111111",
            "amount_usdc": Decimal("12.50"),
            "status": "PENDING_MANUAL_REVIEW",
            "payload": b'{"riskLevel":"yellow","message":"Manual review."}',
            "created_at": created_at,
            "updated_at": created_at,
        }
    )
    assert default_item.withdrawal_kind == "provider_withdrawal"
    assert default_item.review_type == "provider_withdraw_review"

    consumer_item = repository._to_item(
        {
            "withdrawal_id": "wd-consumer-kind",
            "withdrawal_kind": "consumer_refund",
            "owner_wallet": "0x2222222222222222222222222222222222222222",
            "amount_usdc": Decimal("600.00"),
            "flow_status": "PENDING_MANUAL_REVIEW",
            "payload": memoryview(b'{"riskReasonCode":"CONSUMER_WITHDRAW_MANUAL_REVIEW"}'),
            "created_at": created_at,
            "updated_at": created_at,
        }
    )
    assert consumer_item.withdrawal_kind == "consumer_refund"
    assert consumer_item.review_type == "consumer_withdraw_review"
    assert consumer_item.risk_reason_code == "CONSUMER_WITHDRAW_MANUAL_REVIEW"


def test_menu_config_snapshot_auto_adds_new_seed_menu_items() -> None:
    _login_as("cliff@synapse-network.ai")
    store = _test_store()
    snapshot = store.config.get_menu_config("admin_menu_config")
    assert snapshot is not None

    migrated_item_ids = {
        "analytics",
        "dashboard-analytics",
        "analytics-consumer-funnel",
        "analytics-invocation-revenue",
        "analytics-provider-revenue",
        "analytics-money-flow",
        "analytics-risk-health",
        "analytics-data-quality",
        "review-history",
    }
    trimmed_snapshot = replace(
        snapshot,
        draft_items=tuple(item for item in snapshot.draft_items if item.item_id not in migrated_item_ids),
        published_items=tuple(item for item in snapshot.published_items if item.item_id not in migrated_item_ids),
    )
    store.config.save_menu_config(trimmed_snapshot)

    visible_response = client.get("/api/admin/v1/config/menu-items/visible")
    assert visible_response.status_code == 200
    visible_ids = {item["itemId"] for item in visible_response.json()["data"]["items"]}
    assert migrated_item_ids.issubset(visible_ids)
    analytics_item = next(item for item in visible_response.json()["data"]["items"] if item["itemId"] == "analytics")
    assert analytics_item["parentItemId"] == "dashboard"
    assert analytics_item["nodeType"] == "category"


def test_menu_config_snapshot_auto_patches_seed_panel_hrefs() -> None:
    _login_as("cliff@synapse-network.ai")
    store = _test_store()
    snapshot = store.config.get_menu_config("admin_menu_config")
    assert snapshot is not None

    patch_item_ids = {
        "permissions-matrix",
        "module-boundaries",
        "reviewer-split",
    }
    stale_snapshot = replace(
        snapshot,
        draft_items=tuple(
            replace(item, href=None)
            if item.item_id in patch_item_ids
            else item
            for item in snapshot.draft_items
        ),
        published_items=tuple(
            replace(item, href=None)
            if item.item_id in patch_item_ids
            else item
            for item in snapshot.published_items
        ),
    )
    store.config.save_menu_config(stale_snapshot)

    visible_response = client.get("/api/admin/v1/config/menu-items/visible")

    assert visible_response.status_code == 200
    visible_by_id = {
        item["itemId"]: item for item in visible_response.json()["data"]["items"]
    }
    assert (
        visible_by_id["permissions-matrix"]["href"]
        == "/role-permissions#permissions-matrix"
    )
    assert (
        visible_by_id["module-boundaries"]["href"]
        == "/role-permissions#module-boundaries"
    )
    assert visible_by_id["reviewer-split"]["href"] == "/role-permissions#reviewer-split"


def test_provider_withdraw_review_decision_requires_permission() -> None:
    csrf_headers = _login_as("finance@synapse-network.ai")

    response = client.post(
        "/api/admin/v1/withdrawal-reviews/wd-demo-review-001/decision",
        headers={**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("finance@synapse-network.ai")},
        json={
            "decision": "REJECT",
            "note": "Finance admin cannot decide directly.",
        },
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"


def test_provider_withdraw_review_decision_rejects_multiple_active_google_authenticator_factors() -> None:
    csrf_headers = _login_as("finance-review@synapse-network.ai")
    store = _test_store()
    user = store.identity.get_user_by_email("finance-review@synapse-network.ai")
    assert user is not None
    duplicate_factor = store.identity.upsert_mfa_factor(
        AdminMfaFactor(
            factor_id=f"dup_{uuid4().hex[:12]}",
            admin_id=user.admin_id,
            factor_type=MfaFactorType.TOTP,
            factor_label="bootstrap_totp",
            status=MfaFactorStatus.ACTIVE,
            payload={"totpSecret": generate_totp_secret()},
        )
    )

    try:
        response = client.post(
            "/api/admin/v1/withdrawal-reviews/wd-demo-review-001/decision",
            headers={**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("finance-review@synapse-network.ai")},
            json={
                "decision": "REJECT",
                "note": "Duplicate active TOTP factors must be rejected.",
            },
        )
        assert response.status_code == 401
        assert response.json()["error"]["message"] == "Multiple active Google Authenticator factors are configured"
    finally:
        factor = store.identity.get_mfa_factor_by_id(duplicate_factor.factor_id)
        assert factor is not None
        store.identity.upsert_mfa_factor(
            AdminMfaFactor(
                factor_id=factor.factor_id,
                admin_id=factor.admin_id,
                factor_type=factor.factor_type,
                factor_label=factor.factor_label,
                status=MfaFactorStatus.REVOKED,
                secret_ref=factor.secret_ref,
                payload=factor.payload,
                last_verified_at=factor.last_verified_at,
                created_at=factor.created_at,
                updated_at=factor.updated_at,
                revoked_at=factor.updated_at,
            )
        )


def test_provider_withdraw_review_decision_rejects_placeholder_google_authenticator_secret() -> None:
    csrf_headers = _login_as("finance-review@synapse-network.ai")
    store = _test_store()
    user = store.identity.get_user_by_email("finance-review@synapse-network.ai")
    assert user is not None
    factor = next(
        factor
        for factor in store.identity.list_mfa_factors(user.admin_id)
        if factor.status == MfaFactorStatus.ACTIVE
        and factor.factor_type == MfaFactorType.TOTP
    )
    original_payload = dict(factor.payload)
    store.identity.upsert_mfa_factor(
        AdminMfaFactor(
            factor_id=factor.factor_id,
            admin_id=factor.admin_id,
            factor_type=factor.factor_type,
            factor_label=factor.factor_label,
            status=factor.status,
            secret_ref=factor.secret_ref,
            payload={**original_payload, "totpSecret": "__BOOTSTRAP_TOTP_SECRET__"},
            last_verified_at=factor.last_verified_at,
            created_at=factor.created_at,
            updated_at=factor.updated_at,
            revoked_at=factor.revoked_at,
        )
    )

    try:
        response = client.post(
            "/api/admin/v1/withdrawal-reviews/wd-demo-review-001/decision",
            headers={**csrf_headers, "X-Admin-OTP-Code": "123456"},
            json={
                "decision": "REJECT",
                "note": "Placeholder TOTP secret must be rejected explicitly.",
            },
        )
        assert response.status_code == 401
        assert response.json()["error"]["message"] == (
            "Admin Google Authenticator is not configured"
        )
    finally:
        store.identity.upsert_mfa_factor(
            AdminMfaFactor(
                factor_id=factor.factor_id,
                admin_id=factor.admin_id,
                factor_type=factor.factor_type,
                factor_label=factor.factor_label,
                status=factor.status,
                secret_ref=factor.secret_ref,
                payload=original_payload,
                last_verified_at=factor.last_verified_at,
                created_at=factor.created_at,
                updated_at=factor.updated_at,
                revoked_at=factor.revoked_at,
            )
        )


def test_draft_menu_config_requires_control_plane_role() -> None:
    _login_as("finance@synapse-network.ai")

    response = client.get("/api/admin/v1/config/menu-items")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"


def test_raw_published_menu_config_requires_control_plane_role() -> None:
    _login_as("finance@synapse-network.ai")

    response = client.get("/api/admin/v1/config/menu-items?stage=published")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"


def test_dashboard_requires_auth() -> None:
    client.cookies.clear()
    response = client.get("/api/admin/v1/dashboard/overview")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"
    assert response.json()["requestId"].startswith("req_")


def test_approval_submit_forbidden_without_permission() -> None:
    csrf_headers = _login_as("audit@synapse-network.ai")

    response = client.post(
        "/api/admin/v1/approvals",
        headers=csrf_headers,
        json={
            "approvalType": "deposit_repair",
            "resourceType": "deposit_intent",
            "resourceId": "dep_123",
            "approvalLevel": "L2",
            "amountUsdc": "100.00",
            "reason": "链上已确认但账本未入账",
            "payload": {"txHash": "0xabc", "ownerAddress": "0x123", "eventKey": "evt_123"},
        },
    )

    assert response.status_code == 403
    body = response.json()
    assert body["error"]["code"] == "FORBIDDEN"
    assert body["requestId"].startswith("req_")


def test_approval_decision_requires_reviewer_role() -> None:
    csrf_headers = _login_as("finance-review@synapse-network.ai")

    response = client.post(
        "/api/admin/v1/approvals/APR-20260316-001/decision",
        headers={**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("finance-review@synapse-network.ai")},
        json={"decision": "APPROVE", "comment": "approved"},
    )

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "APPROVED_PENDING_EXECUTION"


def test_dashboard_overview_uses_store_backed_metrics() -> None:
    _login_as("ops@synapse-network.ai")

    response = client.get("/api/admin/v1/dashboard/overview")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["metrics"]["pendingApprovals"] >= 3
    assert body["metrics"]["depositExceptions"] == 2
    assert body["metrics"]["auditAlerts"] == 1
    assert body["metrics"]["vaultLedgerDelta"] == "0.50"


def test_system_status_uses_gateway_projection_snapshot() -> None:
    _login_as("ops@synapse-network.ai")

    response = client.get("/api/admin/v1/dashboard/system-status")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["gatewayAdmin"] == "healthy"
    assert body["gateway"] == "degraded"
    assert body["approvalQueueDepth"] >= 3
    assert body["lastReconciliationAt"] == "2026-03-16T08:00:00Z"


def test_finance_overview_exposes_gateway_finance_projection() -> None:
    _login_as("ops@synapse-network.ai")

    response = client.get("/api/admin/v1/dashboard/finance-overview")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["todayChargeUsdc"] == "1280.40"
    assert body["todayDepositUsdc"] == "1640.00"
    assert body["todayInvocationCount"] == 342
    assert body["todayPlatformFeeEarnedUsdc"] == "196.40"
    assert body["todayProviderEarnedUsdc"] == "1084.00"
    assert body["refundableConsumerBalanceUsdc"] == "7320.35"
    assert body["providerAvailableToWithdrawUsdc"] == "3510.20"
    assert body["providerLockedBalanceUsdc"] == "410.25"
    assert body["vaultLedgerDeltaUsdc"] == "0.50"
    assert body["pendingDepositCount"] == 2
    assert body["pendingWithdrawalCount"] == 1


def test_activity_trends_expose_seven_day_projection() -> None:
    _login_as("ops@synapse-network.ai")

    response = client.get("/api/admin/v1/dashboard/activity-trends")

    assert response.status_code == 200
    points = response.json()["data"]["points"]
    assert len(points) == 7
    assert points[-1]["bucketDate"] == "2026-03-16"
    assert points[-1]["invocationCount"] == 342
    assert points[-1]["platformFeeEarnedUsdc"] == "196.40"
    assert points[-1]["providerEarnedUsdc"] == "1084.00"
    assert points[-1]["netFlowUsdc"] == "1287.25"


def test_operations_overview_exposes_gateway_ops_projection() -> None:
    _login_as("ops@synapse-network.ai")

    response = client.get("/api/admin/v1/dashboard/operations-overview")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["gatewayStatus"] == "degraded"
    assert body["indexerRunning"] is True
    assert body["indexerStatus"] == "lagging"
    assert body["indexerPollIntervalSec"] == 30
    assert body["backfillEnabled"] is True
    assert body["backfillStatus"] == "lagging"
    assert body["backfillLastScannedBlock"] == 19450321


class FakeForumSupportService:
    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.ignored: list[dict] = []
        self.closed: list[dict] = []
        self.pinned: list[dict] = []

    def list_response_tasks(self, *, status=None, classification=None, page=1, page_size=20):
        _ = (status, classification)
        return {
            "items": [self._task("draft_ready")],
            "pagination": {
                "page": page,
                "pageSize": page_size,
                "total": 1,
                "totalPages": 1,
                "hasNextPage": False,
                "hasPreviousPage": False,
            },
        }

    def get_response_task(self, task_id):
        return self._task("draft_ready", task_id=task_id)

    def update_suggestion(self, task_id, payload):
        return {
            **self._task("draft_ready", task_id=task_id),
            "classification": payload["classification"],
            "priority": payload["priority"],
            "suggestedReply": payload["suggestedReply"],
            "linkedRequirementCandidateId": payload.get("linkedRequirementCandidateId"),
        }

    def send_reply(self, task_id, payload, *, admin):
        self.sent.append({"task_id": task_id, "payload": payload, "admin_id": admin.admin_id})
        return {**self._task("responded", task_id=task_id), "replyId": "reply-admin-1", "respondedAt": datetime.now(timezone.utc)}

    def ignore_task(self, task_id, payload, *, admin):
        self.ignored.append({"task_id": task_id, "payload": payload, "admin_id": admin.admin_id})
        return self._task("ignored", task_id=task_id)

    def list_topics(self, *, status=None, page=1, page_size=20, category=None, q=None, pinned=None):
        _ = (status, category, q, pinned)
        return {
            "items": [self._topic()],
            "pagination": {
                "page": page,
                "pageSize": page_size,
                "total": 1,
                "totalPages": 1,
                "hasNextPage": False,
                "hasPreviousPage": False,
            },
        }

    def get_topic(self, topic_id):
        return {
            "topic": self._topic(topic_id=topic_id),
            "responseTask": self._task("draft_ready"),
            "events": [
                {
                    "eventId": "fte-demo",
                    "topicId": topic_id,
                    "actorAdminId": "adm_platform_ops_admin",
                    "action": "pin",
                    "fromStatus": "open",
                    "toStatus": "open",
                    "reason": None,
                    "metadata": {"pinned": True},
                    "createdAt": datetime.now(timezone.utc),
                }
            ],
        }

    def close_topic(self, topic_id, payload, *, admin):
        self.closed.append({"topic_id": topic_id, "payload": payload, "admin_id": admin.admin_id})
        return self._topic(topic_id=topic_id, status="closed", locked=True, closed_reason=payload["reason"])

    def reopen_topic(self, topic_id, *, admin):
        self.closed.append({"topic_id": topic_id, "payload": {"reopen": True}, "admin_id": admin.admin_id})
        return self._topic(topic_id=topic_id, status="open", locked=False)

    def pin_topic(self, topic_id, *, admin, pinned):
        self.pinned.append({"topic_id": topic_id, "pinned": pinned, "admin_id": admin.admin_id})
        return self._topic(topic_id=topic_id, pinned=pinned)

    @staticmethod
    def _topic(
        *,
        topic_id: str = "topic-demo",
        status: str = "awaiting_admin",
        locked: bool = False,
        pinned: bool = True,
        closed_reason: str | None = None,
    ) -> dict:
        return {
            "topicId": topic_id,
            "title": "Gateway timeout while opening FAQ route",
            "body": "FAQ route times out with 500",
            "excerpt": "FAQ route times out",
            "category": "Bugs",
            "authorAddress": "0x123",
            "authorDisplay": "0x123",
            "authorRoles": ["Builder"],
            "status": status,
            "resolved": status == "resolved",
            "locked": locked,
            "pinned": pinned,
            "viewsCount": 7,
            "repliesCount": 0,
            "officialRepliesCount": 0,
            "closedReason": closed_reason,
            "closedByAdminId": "adm_platform_ops_admin" if closed_reason else None,
            "closedAt": datetime.now(timezone.utc) if closed_reason else None,
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc),
            "lastActivityAt": datetime.now(timezone.utc),
        }

    @staticmethod
    def _task(status: str, *, task_id: str = "frt-demo") -> dict:
        return {
            "responseTaskId": task_id,
            "topicId": "topic-demo",
            "status": status,
            "source": "growing_agent",
            "priority": "high",
            "classification": "bug",
            "suggestedReply": "Thanks, we captured this as a bug candidate.",
            "suggestedReplySource": "growing",
            "suggestedReplyUpdatedAt": datetime.now(timezone.utc),
            "repliedByAdminId": None,
            "replyId": None,
            "respondedAt": None,
            "linkedRequirementCandidateId": "42",
            "linkedRequirementId": None,
            "linkedWorkflowRunId": None,
            "metadata": {},
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc),
            "topic": FakeForumSupportService._topic(),
        }


def test_forum_support_lists_unreplied_tasks() -> None:
    fake = FakeForumSupportService()
    app.dependency_overrides[deps.get_forum_support_service] = lambda: fake
    _login_as("ops@synapse-network.ai")

    response = client.get("/api/admin/v1/forum/response-tasks")

    app.dependency_overrides.pop(deps.get_forum_support_service, None)
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["items"][0]["status"] == "draft_ready"
    assert body["items"][0]["topic"]["title"] == "Gateway timeout while opening FAQ route"


def test_forum_support_gets_single_response_task_context() -> None:
    fake = FakeForumSupportService()
    app.dependency_overrides[deps.get_forum_support_service] = lambda: fake
    _login_as("ops@synapse-network.ai")

    response = client.get("/api/admin/v1/forum/response-tasks/frt-demo")

    app.dependency_overrides.pop(deps.get_forum_support_service, None)
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["responseTaskId"] == "frt-demo"
    assert body["topic"]["body"] == "FAQ route times out with 500"
    assert body["suggestedReply"] == "Thanks, we captured this as a bug candidate."


def test_forum_support_send_reply_marks_task_responded() -> None:
    fake = FakeForumSupportService()
    app.dependency_overrides[deps.get_forum_support_service] = lambda: fake
    csrf_headers = _login_as("ops@synapse-network.ai")

    response = client.post(
        "/api/admin/v1/forum/response-tasks/frt-demo/send-reply",
        json={"body": "Thanks, we are reviewing this."},
        headers=csrf_headers,
    )

    app.dependency_overrides.pop(deps.get_forum_support_service, None)
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "responded"
    assert fake.sent[0]["admin_id"] == "adm_platform_ops_admin"


def test_forum_support_ignore_requires_reason_and_closes_task() -> None:
    fake = FakeForumSupportService()
    app.dependency_overrides[deps.get_forum_support_service] = lambda: fake
    csrf_headers = _login_as("ops@synapse-network.ai")

    response = client.post(
        "/api/admin/v1/forum/response-tasks/frt-demo/ignore",
        json={"reason": "Duplicate topic already answered."},
        headers=csrf_headers,
    )

    app.dependency_overrides.pop(deps.get_forum_support_service, None)
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "ignored"
    assert fake.ignored[0]["payload"]["reason"] == "Duplicate topic already answered."
    assert fake.ignored[0]["admin_id"] == "adm_platform_ops_admin"


def test_forum_support_growing_can_push_suggestion() -> None:
    fake = FakeForumSupportService()
    app.dependency_overrides[deps.get_forum_support_service] = lambda: fake
    app.dependency_overrides[forum_support_router.require_growing_service_token] = lambda: None
    client.cookies.clear()

    response = client.post(
        "/api/admin/v1/forum/response-tasks/frt-demo/suggestion",
        headers={"X-Growing-Service-Token": "test-growing-token"},
        json={
            "classification": "bug",
            "priority": "high",
            "suggestedReply": "Thanks, we captured this as a bug candidate.",
            "linkedRequirementCandidateId": "42",
            "metadata": {"source": "test"},
        },
    )

    app.dependency_overrides.pop(deps.get_forum_support_service, None)
    app.dependency_overrides.pop(forum_support_router.require_growing_service_token, None)
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["status"] == "draft_ready"
    assert body["classification"] == "bug"
    assert body["linkedRequirementCandidateId"] == "42"


def test_forum_support_growing_can_read_pending_queue() -> None:
    fake = FakeForumSupportService()
    app.dependency_overrides[deps.get_forum_support_service] = lambda: fake
    app.dependency_overrides[forum_support_router.require_growing_service_token] = lambda: None
    client.cookies.clear()

    response = client.get(
        "/api/admin/v1/forum/response-tasks/-/pending?page_size=10",
        headers={"X-Growing-Service-Token": "test-growing-token"},
    )

    app.dependency_overrides.pop(deps.get_forum_support_service, None)
    app.dependency_overrides.pop(forum_support_router.require_growing_service_token, None)
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["items"][0]["status"] == "draft_ready"
    assert body["pagination"]["pageSize"] == 10


def test_forum_support_lists_all_topics_for_operations() -> None:
    fake = FakeForumSupportService()
    app.dependency_overrides[deps.get_forum_support_service] = lambda: fake
    _login_as("ops@synapse-network.ai")

    response = client.get("/api/admin/v1/forum/topics?status=awaiting_admin&page_size=10&pinned=true")

    app.dependency_overrides.pop(deps.get_forum_support_service, None)
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["items"][0]["status"] == "awaiting_admin"
    assert body["items"][0]["pinned"] is True
    assert body["items"][0]["viewsCount"] == 7
    assert body["pagination"]["pageSize"] == 10


def test_forum_support_gets_topic_detail_and_timeline() -> None:
    fake = FakeForumSupportService()
    app.dependency_overrides[deps.get_forum_support_service] = lambda: fake
    _login_as("ops@synapse-network.ai")

    response = client.get("/api/admin/v1/forum/topics/topic-demo")

    app.dependency_overrides.pop(deps.get_forum_support_service, None)
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["topic"]["topicId"] == "topic-demo"
    assert body["responseTask"]["responseTaskId"] == "frt-demo"
    assert body["events"][0]["action"] == "pin"


def test_forum_support_closes_reopens_and_pins_topic() -> None:
    fake = FakeForumSupportService()
    app.dependency_overrides[deps.get_forum_support_service] = lambda: fake
    csrf_headers = _login_as("ops@synapse-network.ai")

    close_response = client.post(
        "/api/admin/v1/forum/topics/topic-demo/close",
        json={"reason": "Duplicate answered issue."},
        headers=csrf_headers,
    )
    reopen_response = client.post("/api/admin/v1/forum/topics/topic-demo/reopen", headers=csrf_headers)
    pin_response = client.post("/api/admin/v1/forum/topics/topic-demo/pin", headers=csrf_headers)
    unpin_response = client.post("/api/admin/v1/forum/topics/topic-demo/unpin", headers=csrf_headers)

    app.dependency_overrides.pop(deps.get_forum_support_service, None)
    assert close_response.status_code == 200
    assert close_response.json()["data"]["status"] == "closed"
    assert close_response.json()["data"]["closedReason"] == "Duplicate answered issue."
    assert reopen_response.status_code == 200
    assert reopen_response.json()["data"]["status"] == "open"
    assert pin_response.status_code == 200
    assert pin_response.json()["data"]["pinned"] is True
    assert unpin_response.status_code == 200
    assert unpin_response.json()["data"]["pinned"] is False
    assert fake.closed[0]["admin_id"] == "adm_platform_ops_admin"
    assert fake.pinned[-1]["pinned"] is False


def test_reconciliation_detail_exposes_runtime_breakdown_and_related_backlog() -> None:
    _login_as("ops@synapse-network.ai")

    response = client.get("/api/admin/v1/dashboard/reconciliation-detail")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["gatewayStatus"] == "degraded"
    assert body["reconciliationAlert"] is True
    assert body["reconciliationDeltaUsdc"] == "0.50"
    assert body["signedDifferenceUsdc"] == "-0.50"
    assert body["imbalanceDirection"] == "vault_deficit"
    assert body["chainVaultUsdc"] == "8449.60"
    assert body["ledgerObligationUsdc"] == "8450.10"
    assert body["lastReconciliationAt"] == "2026-03-16T08:00:00Z"
    assert body["runtimeStateUpdatedAt"] == "2026-03-16T08:00:00Z"
    assert body["pendingApprovals"] >= 3
    assert body["depositExceptions"] == 2
    assert body["pendingDepositCount"] == 2
    assert body["pendingWithdrawalCount"] == 1
    assert body["todayRefundUsdc"] == "42.25"
    assert body["todayWithdrawalUsdc"] == "310.50"
    assert body["ownerLiabilityUsdc"] == "8450.10"
    assert body["platformFeeBalanceUsdc"] == "128.75"
    assert body["chainConfirmedNotLedgerConfirmedCount"] == 1
    assert body["depositP95SyncDelaySeconds"] == 184
    assert body["recentlyCompletedOutflowsUsdc"] == "186.40"
    assert len(body["priorityApprovals"]) >= 1
    assert body["depositRepairApprovals"][0]["approvalType"] == "deposit_repair"
    assert isinstance(body["pendingWithdrawalReviews"], list)
    assert body["priorityApprovals"][0]["ownerAddress"]


def test_reconciliation_drilldown_cross_locates_by_owner_and_tx_hash() -> None:
    _login_as("ops@synapse-network.ai")

    owner_response = client.get(
        "/api/admin/v1/dashboard/reconciliation-drilldown",
        params={"ownerAddress": "0x8f3a2c6d4b1180e6ac93d55aefe34c81a8d6d111"},
    )

    assert owner_response.status_code == 200
    owner_body = owner_response.json()["data"]
    assert owner_body["ownerAddress"] == "0x8f3a2c6d4b1180e6ac93d55aefe34c81a8d6d111"
    assert len(owner_body["priorityApprovals"]) >= 1
    assert len(owner_body["depositRepairApprovals"]) >= 1
    assert isinstance(owner_body["pendingWithdrawalReviews"], list)

    tx_response = client.get(
        "/api/admin/v1/dashboard/reconciliation-drilldown",
        params={"txHash": "0xdep003"},
    )

    assert tx_response.status_code == 200
    tx_body = tx_response.json()["data"]
    assert tx_body["txHash"] == "0xdep003"
    assert tx_body["depositRepairApprovals"][0]["approvalId"] == "APR-20260316-003"
    assert tx_body["pendingWithdrawalReviews"] == []


def test_dashboard_diagnostics_expose_runtime_signals_and_actions() -> None:
    _login_as("ops@synapse-network.ai")

    response = client.get("/api/admin/v1/dashboard/diagnostics")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["overallStatus"] == "degraded"
    assert "reconciliation alert present" in body["summary"]
    assert len(body["signals"]) == 5
    assert body["signals"][0]["signalId"] == "reconciliation"
    assert body["signals"][0]["status"] == "degraded"
    assert len(body["actions"]) == 3
    assert "persisted task status" in body["actions"][0]["detail"]


def test_dashboard_analytics_overview_exposes_north_star_cards() -> None:
    _login_as("ops@synapse-network.ai")

    response = client.get("/api/admin/v1/dashboard/analytics/overview")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["window"] == "24h"
    assert body["overallStatus"] == "monitoring"
    assert body["cards"][0]["key"] == "gmv_usdc"
    assert any(card["key"] == "analytics_health" for card in body["cards"])


def test_dashboard_analytics_consumer_funnel_exposes_activation_steps() -> None:
    _login_as("ops@synapse-network.ai")

    response = client.get("/api/admin/v1/dashboard/analytics/consumer-funnel?window=7d")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["window"] == "7d"
    assert [step["eventName"] for step in body["steps"]][:3] == [
        "page_viewed",
        "wallet_connected",
        "consumer_signup_completed",
    ]
    assert body["summary"]["activationRate"] > 0


def test_dashboard_analytics_money_flow_includes_projection_context() -> None:
    _login_as("ops@synapse-network.ai")

    response = client.get("/api/admin/v1/dashboard/analytics/money-flow")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["depositUsdc"] == "10.00"
    assert body["withdrawalUsdc"] == "0.00"
    assert body["refundUsdc"] == "0.00"
    assert body["financeContext"]["pendingDepositCount"] == 2
    assert body["financeContext"]["pendingWithdrawalCount"] == 1
    assert body["financeContext"]["vaultLedgerDeltaUsdc"] == "0.50"


def test_dashboard_analytics_data_quality_flags_demo_fallback_events() -> None:
    _login_as("ops@synapse-network.ai")

    response = client.get("/api/admin/v1/dashboard/analytics/data-quality?window=1h")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["window"] == "1h"
    assert body["overallStatus"] == "monitoring"
    assert body["privacyViolations"] == 0
    assert body["fileBackendFallbackEvents"] == 7


def test_dashboard_service_pending_counts_include_projected_provider_reviews() -> None:
    service = DashboardService(
        InMemoryAdminStore.seed_demo(),
        InMemoryGatewayDashboardProjectionRepository.seed_demo(),
        FakeAnalyticsDashboardRepository(),
        InMemoryProviderWithdrawReviewRepository.seed_demo(),
    )

    assert service.get_overview()["metrics"]["pendingApprovals"] == 5
    assert service.get_system_status()["approvalQueueDepth"] == 5
    assert service.get_reconciliation_detail()["pendingApprovals"] == 5


def test_audit_actions_list_is_available() -> None:
    _login_as("audit@synapse-network.ai")

    response = client.get("/api/admin/v1/audit/actions?resultStatus=failure")

    assert response.status_code == 200
    items = response.json()["data"]["items"]
    assert len(items) >= 1
    assert items[0]["resultStatus"] == "failure"


def test_execution_jobs_list_and_retry() -> None:
    csrf_headers = _login_as("finance-review@synapse-network.ai")

    list_response = client.get("/api/admin/v1/execution-jobs?status=FAILED")
    assert list_response.status_code == 200
    items = list_response.json()["data"]["items"]
    assert len(items) >= 1
    job_id = items[0]["jobId"]

    retry_response = client.post(
        f"/api/admin/v1/execution-jobs/{job_id}/retry",
        headers={**csrf_headers, "X-Admin-OTP-Code": _otp_code_for("finance-review@synapse-network.ai")},
    )

    assert retry_response.status_code == 200
    assert retry_response.json()["data"]["status"] == "SUCCEEDED"

    jobs_response = client.get("/api/admin/v1/execution-jobs?approvalId=APR-20260316-003")
    assert jobs_response.status_code == 200
    retried_job = jobs_response.json()["data"]["items"][0]
    assert retried_job["status"] == "SUCCEEDED"
    assert retried_job["retryCount"] == 2
    assert retried_job["attempts"][0]["status"] == "SUCCEEDED"


def test_high_risk_route_requires_google_authenticator_header() -> None:
    csrf_headers = _login_as("finance-review@synapse-network.ai")

    response = client.post(
        "/api/admin/v1/approvals/APR-20260316-001/decision",
        headers=csrf_headers,
        json={"decision": "APPROVE", "comment": "missing otp"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_cookie_authenticated_write_requires_csrf_token() -> None:
    _login_as("cliff@synapse-network.ai")

    response = client.post(
        "/api/admin/v1/users",
        json={
            "email": "csrf-missing@synapse-network.ai",
            "displayName": "Missing CSRF",
            "roleKey": "platform_ops_admin",
            "password": PLACEHOLDER_PASSWORD,
            "requireMfa": False,
            "status": "active",
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["message"] == "Invalid CSRF token"
