from __future__ import annotations

import asyncio
from copy import deepcopy
from decimal import Decimal
from types import SimpleNamespace
from typing import cast

import pytest

from src.api.routers.services import RegisterServiceRequest
from src.domain.finance import UsageLogRow
from src.domain.service_contract import ServiceConstraintRecord, ServiceDefinitionRecord
from src.domain.service_contract import ServiceHealthTargetRecord, ServiceRuntimeHealthRecord
from src.services.platform import service_health_service
from src.services.owner.forwarding_validation import effective_service_constraints
from src.services.provider.registry.payload_helpers import normalize_service_payload
from src.services.provider.registry_service import RegistryService
from src.storage.base import BaseStorage


class InMemoryRegistryRepo:
    def __init__(self) -> None:
        self._rows: list[ServiceDefinitionRecord] = []
        self._health_history_rows: list[object] = []

    def read_service_registry_rows(self):
        return list(self._rows)

    def write_service_registry_rows(self, rows):
        self._rows = list(rows)

    def read_service_target_health_rows(self):
        return []

    def write_service_target_health_rows(self, rows):
        return list(rows)

    def read_service_target_health_history_rows(self):
        return list(self._health_history_rows)

    def write_service_target_health_history_rows(self, rows):
        self._health_history_rows = list(rows)


class InMemoryAuditRepo:
    def __init__(self) -> None:
        self.rows: list[object] = []

    def append_audit_row(self, row):
        self.rows.append(row)


class InMemoryGatewayStateRepo:
    def __init__(self) -> None:
        self.rows: list[UsageLogRow] = []

    def read_invocation_billing_rows(self):
        return list(self.rows)


class FakeStorage:
    def __init__(self) -> None:
        self.data_manager = SimpleNamespace(
            system=SimpleNamespace(
                registry=InMemoryRegistryRepo(),
                gateway_state=InMemoryGatewayStateRepo(),
            )
            ,
            audit=SimpleNamespace(
                logs=InMemoryAuditRepo(),
            )
        )

    def get_data_manager(self):
        return self.data_manager


def _service_payload(service_id: str | None) -> dict:
    return {
        "serviceId": service_id,
        "serviceName": "Famous Quotes Top 3",
        "pricing": "0.01",
        "summary": "Return the top 3 famous quotes.",
        "status": "active",
        "isActive": True,
        "healthCheck": {
            "path": "/health",
            "method": "GET",
            "timeoutMs": 3000,
            "successCodes": [200],
            "healthyThreshold": 2,
            "unhealthyThreshold": 3,
        },
        "constraints": {
            "timeoutMs": 15000,
            "maxResponseBytes": 4096,
            "maxRequestBytes": 4096,
            "maxQps": 100,
        },
        "invoke": {
            "method": "POST",
            "targets": [{"url": "https://quotes.test/invoke", "weight": 100}],
            "timeoutMs": 15000,
            "request": {
                "contentType": "application/json",
                "schema": {"body": {"type": "object"}},
            },
            "response": {
                "contentType": "application/json",
                "schema": {"body": {"type": "object"}},
            },
        },
    }


def _llm_service_payload(service_id: str = "svc_deepseek_chat") -> dict:
    payload = deepcopy(_service_payload(service_id))
    payload["serviceName"] = "DeepSeek Chat"
    payload["serviceKind"] = "llm"
    payload["priceModel"] = "token_metered"
    payload["pricing"] = {
        "amount": "0",
        "currency": "USDC",
        "priceModel": "token_metered",
        "inputPricePer1MTokensUsdc": "0.140000",
        "outputPricePer1MTokensUsdc": "0.280000",
        "defaultMaxOutputTokens": 2048,
        "holdBufferMultiplier": "1.2",
        "maxAutoHoldUsdc": "1.000000",
    }
    payload["invoke"]["targets"] = [
        {"url": "https://provider.test/provider-services/deepseek-chat/invoke", "weight": 100}
    ]
    return payload


async def _healthy_probe(payload):
    fresh_ts = 4102444800000
    await asyncio.sleep(0)
    return payload.model_copy(
        update={
            "runtime_health": ServiceRuntimeHealthRecord(
                overallStatus="healthy",
                healthyTargets=1,
                totalTargets=1,
                lastCheckedAt=fresh_ts,
                targets=[
                    ServiceHealthTargetRecord(
                        targetUrl="https://quotes.test/invoke",
                        status="healthy",
                        weight=100,
                        lastCheckedAt=fresh_ts,
                        lastHealthyAt=fresh_ts,
                    )
                ],
            )
        }
    )


def test_register_service_request_maps_agent_tool_name_to_service_id() -> None:
    request = RegisterServiceRequest.model_validate(
        {
            **_service_payload(None),
            "agentToolName": "famous_quotes_top3",
        }
    )

    assert request.serviceId == "famous_quotes_top3"
    assert request.model_dump()["serviceId"] == "famous_quotes_top3"


def test_llm_service_defaults_to_bounded_llm_timeout() -> None:
    payload = _llm_service_payload()
    payload.pop("constraints")
    payload["invoke"].pop("timeoutMs")

    service = normalize_service_payload(payload, "0xabc")

    assert service.constraints.timeout_ms == 120000
    assert service.invoke.timeout_ms == 120000


def test_register_service_request_applies_llm_timeout_defaults_before_validation() -> None:
    payload = _llm_service_payload()
    payload.pop("constraints")
    payload["invoke"].pop("timeoutMs")

    request = RegisterServiceRequest.model_validate(payload)

    assert request.constraints.timeoutMs == 120000
    assert request.invoke.timeoutMs == 120000


def test_register_service_request_preserves_llm_token_metering_contract() -> None:
    request = RegisterServiceRequest.model_validate(_llm_service_payload())
    dumped = request.model_dump()

    assert dumped["serviceKind"] == "llm"
    assert dumped["priceModel"] == "token_metered"
    assert dumped["pricing"]["priceModel"] == "token_metered"
    assert dumped["pricing"]["inputPricePer1MTokensUsdc"] == "0.140000"
    assert dumped["pricing"]["outputPricePer1MTokensUsdc"] == "0.280000"


def test_llm_service_allows_long_sync_timeout_with_hard_cap() -> None:
    payload = _llm_service_payload()
    payload["constraints"]["timeoutMs"] = 300000
    payload["invoke"]["timeoutMs"] = 300000

    service = normalize_service_payload(payload, "0xabc")

    assert service.constraints.timeout_ms == 300000
    assert service.invoke.timeout_ms == 300000


def test_llm_service_rejects_zero_timeout_instead_of_unlimited_wait() -> None:
    payload = _llm_service_payload()
    payload["constraints"]["timeoutMs"] = 0

    with pytest.raises(ValueError, match=r"constraints\.timeoutMs must be in"):
        normalize_service_payload(payload, "0xabc")


def test_api_service_rejects_llm_sized_timeout() -> None:
    payload = _service_payload("svc_regular_api")
    payload["constraints"]["timeoutMs"] = 120000
    payload["invoke"]["timeoutMs"] = 120000

    with pytest.raises(ValueError, match=r"constraints\.timeoutMs must be in"):
        normalize_service_payload(payload, "0xabc")


def test_runtime_clamps_stale_api_timeout_to_api_cap() -> None:
    service = normalize_service_payload(
        _service_payload("svc_regular_api"),
        "0xabc",
    ).model_copy(update={"constraints": ServiceConstraintRecord(timeoutMs=300000)})

    assert effective_service_constraints(service).timeout_ms == 60000


def test_register_service_request_keeps_provider_onboarding_fields() -> None:
    request = RegisterServiceRequest.model_validate(
        {
            **_service_payload("svc_sentiment"),
            "auth": {"type": "gateway_signed"},
            "providerProfile": {"displayName": "Sentiment Desk"},
            "payoutAccount": {
                "payoutAddress": "0x1234567890abcdef1234567890abcdef12345678",
                "chainId": 8453,
                "settlementCurrency": "USDC",
            },
            "governance": {"termsAccepted": True, "riskAcknowledged": True},
        }
    )

    dumped = request.model_dump()
    assert dumped["auth"]["type"] == "gateway_signed"
    assert dumped["providerProfile"]["displayName"] == "Sentiment Desk"
    assert dumped["payoutAccount"]["chainId"] == 8453
    assert dumped["governance"]["termsAccepted"] is True


def test_registry_service_rejects_duplicate_service_id(monkeypatch) -> None:
    storage = FakeStorage()
    service = RegistryService(cast(BaseStorage, storage))

    async def _no_probe(payload):
        await asyncio.sleep(0)
        return payload

    monkeypatch.setattr(service_health_service, "probe_service_health", _no_probe)
    monkeypatch.setattr(
        service_health_service,
        "sync_service_target_health_table",
        lambda storage_ref, rows: rows,
    )

    asyncio.run(service.register_service(_service_payload("famous_quotes_top3"), "0xabc"))

    with pytest.raises(ValueError, match="already exists"):
        asyncio.run(service.register_service(_service_payload("famous_quotes_top3"), "0xdef"))


def test_register_service_returns_runtime_probe_fields(monkeypatch) -> None:
    storage = FakeStorage()
    service = RegistryService(cast(BaseStorage, storage))

    monkeypatch.setattr(service_health_service, "probe_service_health", _healthy_probe)
    monkeypatch.setattr(
        service_health_service,
        "sync_service_target_health_table",
        lambda storage_ref, rows: rows,
    )

    created = asyncio.run(
        service.register_service(_service_payload("famous_quotes_top3"), "0xabc")
    )

    assert created["runtimeAvailable"] is True
    assert created["probeStatus"] == "healthy"
    assert created["lastCheckedAt"] == 4102444800000
    assert created["probeError"] is None


def test_owner_force_probe_refreshes_runtime_fields(monkeypatch) -> None:
    storage = FakeStorage()
    service = RegistryService(cast(BaseStorage, storage))

    async def _unhealthy_probe(payload):
        await asyncio.sleep(0)
        return payload.model_copy(
            update={
                "runtime_health": ServiceRuntimeHealthRecord(
                    overallStatus="unhealthy",
                    healthyTargets=0,
                    totalTargets=1,
                    lastCheckedAt=1,
                    targets=[
                        ServiceHealthTargetRecord(
                            targetUrl="https://quotes.test/invoke",
                            status="unhealthy",
                            weight=100,
                            lastCheckedAt=1,
                            error="connection refused",
                        )
                    ],
                )
            }
        )

    probes = [_unhealthy_probe, _healthy_probe]

    async def _probe(payload):
        return await probes.pop(0)(payload)

    monkeypatch.setattr(service_health_service, "probe_service_health", _probe)
    monkeypatch.setattr(
        service_health_service,
        "sync_service_target_health_table",
        lambda storage_ref, rows: rows,
    )
    monkeypatch.setattr(service_health_service.settings, "service_health_history_enabled", False)

    created = asyncio.run(
        service.register_service(_service_payload("famous_quotes_top3"), "0xabc")
    )
    refreshed = asyncio.run(
        service.force_probe_owner_service("famous_quotes_top3", "0xabc")
    )

    assert created["runtimeAvailable"] is False
    assert created["probeError"] == "connection refused"
    assert refreshed is not None
    assert refreshed["runtimeAvailable"] is True
    assert refreshed["probeStatus"] == "healthy"


def test_delete_service_requires_inactive_state(monkeypatch) -> None:
    storage = FakeStorage()
    service = RegistryService(cast(BaseStorage, storage))

    async def _no_probe(payload):
        await asyncio.sleep(0)
        return payload

    monkeypatch.setattr(service_health_service, "probe_service_health", _no_probe)
    monkeypatch.setattr(
        service_health_service,
        "sync_service_target_health_table",
        lambda storage_ref, rows: rows,
    )

    asyncio.run(service.register_service(_service_payload("famous_quotes_top3"), "0xabc"))

    with pytest.raises(ValueError, match="SERVICE_DELETE_ACTIVE_CONFLICT"):
        asyncio.run(service.delete_service("famous_quotes_top3", "0xabc"))


def test_delete_service_marks_deleted_and_hides_from_owner_list(monkeypatch) -> None:
    storage = FakeStorage()
    service = RegistryService(cast(BaseStorage, storage))

    async def _no_probe(payload):
        await asyncio.sleep(0)
        return payload

    monkeypatch.setattr(service_health_service, "probe_service_health", _no_probe)
    monkeypatch.setattr(
        service_health_service,
        "sync_service_target_health_table",
        lambda storage_ref, rows: rows,
    )

    asyncio.run(service.register_service(_service_payload("famous_quotes_top3"), "0xabc"))
    asyncio.run(
        service.update_service(
            "famous_quotes_top3",
            {"status": "inactive", "isActive": False},
            "0xabc",
        )
    )

    deleted = asyncio.run(service.delete_service("famous_quotes_top3", "0xabc"))
    owner_rows = asyncio.run(service.list_owner_services("0xabc"))
    persisted_rows = storage.get_data_manager().system.registry.read_service_registry_rows()

    assert deleted is True
    assert owner_rows == []
    assert len(persisted_rows) == 1
    assert persisted_rows[0].status == "deleted"
    assert persisted_rows[0].is_active is False
    assert storage.get_data_manager().audit.logs.rows[-1].action == "provider.service.deleted"


def test_register_service_audits_provider_onboarding_details(monkeypatch) -> None:
    storage = FakeStorage()
    service = RegistryService(cast(BaseStorage, storage))

    async def _no_probe(payload):
        await asyncio.sleep(0)
        return payload

    monkeypatch.setattr(service_health_service, "probe_service_health", _no_probe)
    monkeypatch.setattr(
        service_health_service,
        "sync_service_target_health_table",
        lambda storage_ref, rows: rows,
    )

    payload = _service_payload("svc_sentiment")
    payload.update(
        {
            "serviceName": "Web3 Sentiment Index",
            "auth": {"type": "gateway_signed"},
            "providerProfile": {"displayName": "Sentiment Desk"},
            "payoutAccount": {
                "payoutAddress": "0x1234567890abcdef1234567890abcdef12345678",
                "chainId": 8453,
                "settlementCurrency": "USDC",
            },
            "governance": {"termsAccepted": True, "riskAcknowledged": True},
        }
    )

    created = asyncio.run(service.register_service(payload, "0xabc"))

    audit_entry = storage.get_data_manager().audit.logs.rows[-1]
    assert created["auth"]["type"] == "gateway_signed"
    assert audit_entry.action == "provider.service.registered"
    assert audit_entry.details["providerDisplayName"] == "Sentiment Desk"
    assert audit_entry.details["payoutAccount"]["chainId"] == 8453
    assert audit_entry.details["payoutAccount"]["payoutAddress"].endswith("5678")
    assert audit_entry.details["governance"]["termsAccepted"] is True


def test_register_service_defaults_gateway_signed_for_provider_service_targets(
    monkeypatch,
) -> None:
    storage = FakeStorage()
    service = RegistryService(cast(BaseStorage, storage))

    async def _no_probe(payload):
        await asyncio.sleep(0)
        return payload

    monkeypatch.setattr(service_health_service, "probe_service_health", _no_probe)
    monkeypatch.setattr(
        service_health_service,
        "sync_service_target_health_table",
        lambda storage_ref, rows: rows,
    )

    payload = _service_payload("svc_web3_sentiment_index")
    payload.update(
        {
            "serviceName": "Web3 Sentiment Index",
            "invoke": {
                "method": "POST",
                "targets": [
                    {
                        "url": "https://provider.test/provider-services/web3-sentiment-index/invoke",
                        "weight": 100,
                    }
                ],
                "timeoutMs": 15000,
                "request": {
                    "contentType": "application/json",
                    "schema": {"body": {"type": "object"}},
                },
                "response": {
                    "contentType": "application/json",
                    "schema": {"body": {"type": "object"}},
                },
            },
        }
    )
    payload.pop("auth", None)

    created = asyncio.run(service.register_service(payload, "0xabc"))

    assert created["auth"]["type"] == "gateway_signed"


def test_register_service_rejects_non_gateway_signed_provider_service_targets(
    monkeypatch,
) -> None:
    storage = FakeStorage()
    service = RegistryService(cast(BaseStorage, storage))

    async def _no_probe(payload):
        await asyncio.sleep(0)
        return payload

    monkeypatch.setattr(service_health_service, "probe_service_health", _no_probe)
    monkeypatch.setattr(
        service_health_service,
        "sync_service_target_health_table",
        lambda storage_ref, rows: rows,
    )

    payload = _service_payload("svc_web3_sentiment_index")
    payload.update(
        {
            "auth": {"type": "service_key"},
            "invoke": {
                "method": "POST",
                "targets": [
                    {
                        "url": "https://provider.test/provider-services/web3-sentiment-index/invoke",
                        "weight": 100,
                    }
                ],
                "timeoutMs": 15000,
                "request": {
                    "contentType": "application/json",
                    "schema": {"body": {"type": "object"}},
                },
                "response": {
                    "contentType": "application/json",
                    "schema": {"body": {"type": "object"}},
                },
            },
        }
    )

    with pytest.raises(
        ValueError, match="auth.type must be gateway_signed for /provider-services targets"
    ):
        asyncio.run(service.register_service(payload, "0xabc"))


def test_deleted_service_cannot_be_updated(monkeypatch) -> None:
    storage = FakeStorage()
    service = RegistryService(cast(BaseStorage, storage))

    async def _no_probe(payload):
        await asyncio.sleep(0)
        return payload

    monkeypatch.setattr(service_health_service, "probe_service_health", _no_probe)
    monkeypatch.setattr(
        service_health_service,
        "sync_service_target_health_table",
        lambda storage_ref, rows: rows,
    )

    asyncio.run(service.register_service(_service_payload("famous_quotes_top3"), "0xabc"))
    asyncio.run(
        service.update_service(
            "famous_quotes_top3",
            {"status": "inactive", "isActive": False},
            "0xabc",
        )
    )
    asyncio.run(service.delete_service("famous_quotes_top3", "0xabc"))

    with pytest.raises(ValueError, match="SERVICE_ALREADY_DELETED"):
        asyncio.run(
            service.update_service(
                "famous_quotes_top3",
                {"serviceName": "Renamed"},
                "0xabc",
            )
        )


def test_discover_services_supports_revenue_and_call_count_sort(monkeypatch) -> None:
    storage = FakeStorage()
    service = RegistryService(cast(BaseStorage, storage))

    monkeypatch.setattr(service_health_service, "probe_service_health", _healthy_probe)
    monkeypatch.setattr(
        service_health_service,
        "sync_service_target_health_table",
        lambda storage_ref, rows: rows,
    )
    monkeypatch.setattr(service_health_service, "is_service_discoverable", lambda row: True)

    first_payload = _service_payload("alpha_service")
    first_payload["serviceName"] = "Alpha Service"
    second_payload = _service_payload("beta_service")
    second_payload["serviceName"] = "Beta Service"

    asyncio.run(service.register_service(first_payload, "0xabc"))
    asyncio.run(service.register_service(second_payload, "0xabc"))

    storage.get_data_manager().system.gateway_state.rows = [
        UsageLogRow(
            id="row_1",
            ts=100,
            requestId="req_1",
            serviceId="alpha_service",
            status="SUCCEEDED",
            totalCharge=Decimal("0.050"),
        ),
        UsageLogRow(
            id="row_2",
            ts=200,
            requestId="req_2",
            serviceId="alpha_service",
            status="SUCCEEDED",
            totalCharge=Decimal("0.040"),
        ),
        UsageLogRow(
            id="row_3",
            ts=300,
            requestId="req_3",
            serviceId="beta_service",
            status="SUCCEEDED",
            totalCharge=Decimal("0.120"),
        ),
    ]

    by_count = asyncio.run(service.discover_services(sort_by="invocation_count", sort_order="desc"))
    by_revenue = asyncio.run(service.discover_services(sort_by="revenue", sort_order="desc"))

    assert by_count[0]["serviceId"] == "alpha_service"
    assert by_count[0]["invocationCount"] == 2
    assert by_count[0]["totalRevenueUsdc"] == "0.090"
    assert by_revenue[0]["serviceId"] == "beta_service"
    assert by_revenue[0]["totalRevenueUsdc"] == "0.120"
