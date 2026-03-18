from __future__ import annotations

import asyncio
import json
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Optional

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from src.api.schemas.pydantic_models import (
    AgentInvocationRequest,
    AgentDiscoverySearchRequest,
    AgentQuoteRequest,
    InferenceRequest,
)
from src.domain.execution import InvocationRecord, ServiceQuoteRecord
from src.domain.finance import BalanceLedger, FeePolicyEntity, UsageLogRow
from src.domain.registry import ServiceTargetHealth
from src.domain.service_contract import (
    AgentDiscoveryQueryRecord,
    PublicServiceDiscoveryRecord,
    QuoteInputPreviewRecord,
    RuntimePayloadRecord,
    ServiceDefinitionRecord,
)
from src import app as gateway_app
from src.services.owner import forwarding_billing, forwarding_service, forwarding_upstream
from src.services.platform import credential_service
from src.services.provider.registry_service import RegistryService


class InMemoryBalanceRepo:
    def __init__(self) -> None:
        self.ledger = BalanceLedger()

    def read_balance_ledger(self):
        return self.ledger.model_copy(deep=True)

    def write_balance_ledger(self, ledger):
        self.ledger = ledger.model_copy(deep=True)


class InMemoryFeePolicyRepo:
    def get_platform_fee_policy(self):
        return FeePolicyEntity(defaultRate=0.1, updatedAt="2026-03-17 00:00:00")


class InMemoryGatewayStateRepo:
    def __init__(self) -> None:
        self.usage_rows: list[UsageLogRow] = []

    def read_invocation_billing_rows(self):
        return list(self.usage_rows)

    def write_invocation_billing_rows(self, rows):
        assert all(isinstance(row, UsageLogRow) for row in rows)
        self.usage_rows = list(rows)


class InMemoryRegistryRepo:
    def __init__(self, service: ServiceDefinitionRecord) -> None:
        self._service = service
        self._rows = [service]

    def read_service_registry_rows(self):
        return list(self._rows)

    def read_service_target_health_rows(self):
        return [
            ServiceTargetHealth(
                serviceId=self._service.service_id,
                ownerAddress=self._service.owner_address,
                targetUrl=self._service.invoke.targets[0].url,
                weight=100,
                region=self._service.invoke.targets[0].region,
                status="healthy",
                overallStatus="healthy",
                httpStatus=200,
                latencyMs=40,
                consecutiveSuccesses=3,
                consecutiveFailures=0,
                probeUrl=f"{self._service.invoke.targets[0].url}/health",
                lastCheckedAt=credential_service.now_ts() * 1000,
                lastHealthyAt=credential_service.now_ts() * 1000,
                error=None,
            )
        ]


class InMemoryCredentialAuthRepo:
    def __init__(self, credential_row) -> None:
        self._rows = {"agent": [credential_row], "provider": []}

    def read_credential_rows(self, credential_type: str):
        return list(self._rows.get(credential_type, []))

    def write_credential_rows(self, credential_type: str, rows):
        self._rows[credential_type] = list(rows)

    def read_auth_session(self, wallet: str):
        _ = wallet
        return None


class InMemoryAuditRepo:
    def __init__(self) -> None:
        self.rows = []

    def append_audit_row(self, row) -> None:
        self.rows.append(row)


class InMemoryExecutionRepo:
    def __init__(self) -> None:
        self.quotes: dict[str, ServiceQuoteRecord] = {}
        self.invocations: dict[str, InvocationRecord] = {}

    def upsert_quote(self, quote: ServiceQuoteRecord) -> None:
        self.quotes[quote.quote_id] = quote.model_copy(deep=True)

    def read_quote(self, quote_id: str):
        quote = self.quotes.get(quote_id)
        return quote.model_copy(deep=True) if quote is not None else None

    def upsert_invocation(self, invocation: InvocationRecord) -> None:
        self.invocations[invocation.invocation_id] = invocation.model_copy(deep=True)

    def read_invocation(self, invocation_id: str):
        invocation = self.invocations.get(invocation_id)
        return invocation.model_copy(deep=True) if invocation is not None else None

    def read_invocation_by_idempotency(self, credential_id: str, idempotency_key: str):
        for invocation in self.invocations.values():
            if (
                invocation.credential_id == credential_id
                and invocation.idempotency_key == idempotency_key
            ):
                return invocation.model_copy(deep=True)
        return None


class FakeStorage:
    def __init__(self, service: ServiceDefinitionRecord, credential_row) -> None:
        self.balance = InMemoryBalanceRepo()
        self.fee_policy = InMemoryFeePolicyRepo()
        self.gateway_state = InMemoryGatewayStateRepo()
        self.registry = InMemoryRegistryRepo(service)
        self.credential_auth = InMemoryCredentialAuthRepo(credential_row)
        self.audit = InMemoryAuditRepo()
        self.execution = InMemoryExecutionRepo()
        self.data_manager = SimpleNamespace(
            finance=SimpleNamespace(balance=self.balance, fee_policy=self.fee_policy),
            system=SimpleNamespace(
                gateway_state=self.gateway_state,
                registry=self.registry,
                credential_auth=self.credential_auth,
                execution=self.execution,
            ),
            audit=SimpleNamespace(logs=self.audit),
        )

    def get_data_manager(self):
        return self.data_manager


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload
        self.content = json.dumps(payload).encode("utf-8")

    def json(self):
        return self._payload

    def raise_for_status(self) -> None:
        return None


class FakeAsyncClient:
    last_request = None

    def __init__(self, timeout: float):
        self.timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        _ = (exc_type, exc, tb)
        return False

    async def post(self, url: str, json: dict, headers: dict):
        await asyncio.sleep(0)
        type(self).last_request = {
            "url": url,
            "json": dict(json),
            "headers": dict(headers),
            "timeout": self.timeout,
        }
        return FakeResponse({"quote": {"answer": "pong", "echo": json["text"]}})


async def _async_none():
    await asyncio.sleep(0)
    return None


async def _background_loop_until_stopped(stop_event, storage) -> None:
    _ = storage
    await stop_event.wait()


class AgentDiscoverySearchResponse(BaseModel):
    requestId: str
    results: list[PublicServiceDiscoveryRecord]
    count: int


class BudgetCheckResponse(BaseModel):
    allowed: bool
    remainingBudgetUsdc: Optional[float] = None
    remainingDailyLimitUsdc: Optional[float] = None


class InvokeConstraintsResponse(BaseModel):
    body: dict = Field(default_factory=dict)
    timeoutMs: int
    maxPayloadBytes: int


class AgentQuoteResponse(BaseModel):
    requestId: str
    quoteId: str
    serviceId: str
    priceUsdc: float
    priceModel: str
    budgetCheck: BudgetCheckResponse
    expiresAt: str
    idempotencyScope: str
    invokeConstraints: InvokeConstraintsResponse


class InvocationReceiptResponse(BaseModel):
    quoteId: str
    invocationId: str


class AgentInvocationResponse(BaseModel):
    invocationId: str
    status: str
    chargedUsdc: Optional[float] = None
    result: dict = Field(default_factory=dict)
    receipt: Optional[InvocationReceiptResponse] = None


@contextmanager
def _http_runtime_client(monkeypatch, storage: FakeStorage):
    monkeypatch.setattr(gateway_app, "create_storage", lambda settings: storage)
    monkeypatch.setattr(
        gateway_app,
        "run_v2_deposit_indexer",
        _background_loop_until_stopped,
    )
    monkeypatch.setattr(
        gateway_app.settings,
        "service_health_monitor_enabled",
        False,
        raising=False,
    )
    monkeypatch.setattr(
        gateway_app,
        "run_service_health_monitor",
        _background_loop_until_stopped,
    )
    with TestClient(gateway_app.create_app(), base_url="https://gateway.test") as client:
        yield client


def _runtime_credential(raw_token: str):
    return credential_service.build_runtime_credential_record(
        credential_service.CredentialRuntimeSeed(
            credential_type="agent",
            owner_wallet="0xabc",
            credential_id="cred-agent-001",
            display_name="Agent Runtime Key",
            token_hash_value=credential_service.hash_token(raw_token),
            token_prefix_value=credential_service.token_prefix(raw_token),
            status="active",
            max_calls=10,
            calls_used=0,
            rpm=10,
            credit_limit=20.0,
            reset_interval="daily",
            expiration=None,
            created_at="2026-03-17 00:00:00",
            updated_at="2026-03-17 00:00:00",
            expires_at=4102444800,
            revoked_at=None,
        )
    )


def _service_definition() -> ServiceDefinitionRecord:
    return ServiceDefinitionRecord(
        serviceId="svc.echo",
        ownerAddress="0xdef",
        serviceName="Echo Service",
        summary="Echoes agent prompt",
        status="active",
        isActive=True,
        pricingAmount="1.2",
        pricingCurrency="USDC",
        constraints={
            "timeoutMs": 15000,
            "maxQps": 10,
            "maxRequestBytes": 4096,
            "maxResponseBytes": 4096,
        },
        forwarding={"requestIdHeader": "X-Synapse-Request-Id"},
        invoke={
            "method": "POST",
            "targets": [{"url": "https://provider.test/invoke", "weight": 100}],
            "request": {
                "contentType": "application/json",
                "schema": {"body": {"required": ["text"]}},
            },
            "response": {
                "contentType": "application/json",
                "schema": {"body": {}},
            },
        },
    )


def test_generate_response_v2_paid_invocation_uses_typed_execution_models(
    monkeypatch,
) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_service_definition(), _runtime_credential(raw_token))
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = 10.0

    monkeypatch.setattr(forwarding_service, "_get_redis_client", _async_none)
    monkeypatch.setattr(forwarding_upstream.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(
        forwarding_upstream.service_health_service,
        "get_healthy_target_urls",
        lambda service: [service.invoke.targets[0].url],
    )
    monkeypatch.setattr(
        forwarding_billing.settings, "gateway_routing_tax", 0.05, raising=False
    )

    response = asyncio.run(
        forwarding_service.generate_response_v2(
            storage,
            InferenceRequest(prompt="hello typed world", serviceId="svc.echo"),
            "svc.echo",
            raw_token,
            "req-typed-001",
        )
    )

    receipt = response["payload"]["receipt"]
    assert receipt["requestId"] == "req-typed-001"
    assert receipt["quoteId"].startswith("quote-")
    assert receipt["invocationId"].startswith("inv-")
    assert receipt["serviceId"] == "svc.echo"
    assert receipt["serviceUnitPrice"] == pytest.approx(1.2)
    assert receipt["totalCharge"] == pytest.approx(1.25)
    assert receipt["consumerAvailableBalanceAfter"] == pytest.approx(8.75)

    assert response["payload"]["data"]["result"] == {
        "answer": "pong",
        "echo": "hello typed world",
    }

    assert FakeAsyncClient.last_request == {
        "url": "https://provider.test/invoke",
        "json": {"text": "hello typed world"},
        "headers": {"X-Synapse-Request-Id": "req-typed-001"},
        "timeout": 15.0,
    }

    assert storage.gateway_state.usage_rows == []

    assert storage.balance.ledger.consumer_available_balance("0xabc") == pytest.approx(8.75)
    assert storage.balance.ledger.provider_receivable_balance("0xdef") == pytest.approx(1.08)
    assert storage.balance.ledger.platform.fee_accrued == pytest.approx(0.17)

    assert len(storage.audit.rows) == 1
    assert storage.audit.rows[0].action == "V2_USAGE_CHARGED"
    assert storage.audit.rows[0].details["quoteId"] == receipt["quoteId"]
    assert storage.audit.rows[0].details["invocationId"] == receipt["invocationId"]
    assert storage.audit.rows[0].details["resultStatus"] == "success"
    assert storage.execution.read_quote(receipt["quoteId"]).status == "CONSUMED"
    assert storage.execution.read_invocation(receipt["invocationId"]).status == "SUCCEEDED"


def test_agent_quote_and_invocation_flow_persists_typed_execution_rows(monkeypatch) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_service_definition(), _runtime_credential(raw_token))
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = 10.0

    monkeypatch.setattr(forwarding_service, "_get_redis_client", _async_none)
    monkeypatch.setattr(forwarding_upstream.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(
        forwarding_upstream.service_health_service,
        "get_healthy_target_urls",
        lambda service: [service.invoke.targets[0].url],
    )
    monkeypatch.setattr(
        forwarding_billing.settings, "gateway_routing_tax", 0.05, raising=False
    )

    quote_response = asyncio.run(
        forwarding_service.create_quote_v1(
            storage,
            AgentQuoteRequest(
                serviceId="svc.echo",
                inputPreview=QuoteInputPreviewRecord(
                    sample=RuntimePayloadRecord(body={"textLength": 17})
                ),
                responseMode="sync",
            ),
            raw_token,
            "req-quote-001",
        )
    )
    quote_id = quote_response["quoteId"]
    assert quote_response["budgetCheck"]["allowed"] is True
    assert quote_response["invokeConstraints"]["timeoutMs"] == 15000
    assert quote_response["invokeConstraints"]["maxPayloadBytes"] == 4096
    assert storage.execution.read_quote(quote_id).status == "OPEN"

    invocation_response = asyncio.run(
        forwarding_service.create_invocation_v1(
            storage,
            AgentInvocationRequest(
                quoteId=quote_id,
                idempotencyKey="task-1-step-1",
                payload=RuntimePayloadRecord(body={"text": "hello typed world"}),
                responseMode="sync",
            ),
            raw_token,
            "req-invoke-001",
        )
    )
    invocation_id = invocation_response["invocationId"]
    assert invocation_response["status"] == "SUCCEEDED"
    assert invocation_response["chargedUsdc"] == pytest.approx(1.25)

    receipt_response = forwarding_service.get_invocation_receipt_v1(
        storage, invocation_id, raw_token
    )
    assert receipt_response["invocationId"] == invocation_id
    assert receipt_response["status"] == "SUCCEEDED"
    assert receipt_response["result"]["echo"] == "hello typed world"

    persisted_quote = storage.execution.read_quote(quote_id)
    persisted_invocation = storage.execution.read_invocation(invocation_id)
    assert persisted_quote.status == "CONSUMED"
    assert persisted_invocation.quote_id == quote_id
    assert persisted_invocation.idempotency_key == "task-1-step-1"

    replay_response = asyncio.run(
        forwarding_service.create_invocation_v1(
            storage,
            AgentInvocationRequest(
                quoteId=quote_id,
                idempotencyKey="task-1-step-1",
                payload=RuntimePayloadRecord(body={"text": "hello typed world"}),
                responseMode="sync",
            ),
            raw_token,
            "req-invoke-002",
        )
    )
    assert replay_response["invocationId"] == invocation_id


def test_agent_discovery_quote_and_invocation_flow_uses_typed_templates(monkeypatch) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_service_definition(), _runtime_credential(raw_token))
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = 10.0
    registry_service = RegistryService(storage)

    monkeypatch.setattr(forwarding_service, "_get_redis_client", _async_none)
    monkeypatch.setattr(forwarding_upstream.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(
        forwarding_upstream.service_health_service,
        "get_healthy_target_urls",
        lambda service: [service.invoke.targets[0].url],
    )
    monkeypatch.setattr(
        forwarding_billing.settings, "gateway_routing_tax", 0.05, raising=False
    )

    discovery_results = asyncio.run(
        registry_service.search_agent_discovery(
            AgentDiscoveryQueryRecord(query="echo", limit=5),
            public_gateway_url="https://gateway.test/api/v1/gateway/generate",
        )
    )

    assert len(discovery_results) == 1
    discovery_result = discovery_results[0]
    assert discovery_result.invoke.targets[0].url == "https://gateway.test/api/v1/gateway/generate"
    assert discovery_result.quote_template.service_id == "svc.echo"

    quote_response = asyncio.run(
        forwarding_service.create_quote_v1(
            storage,
            AgentQuoteRequest(
                serviceId=discovery_result.quote_template.service_id,
                inputPreview=discovery_result.quote_template.input_preview,
                responseMode=discovery_result.quote_template.response_mode,
            ),
            raw_token,
            "req-disc-quote-001",
        )
    )
    invocation_response = asyncio.run(
        forwarding_service.create_invocation_v1(
            storage,
            AgentInvocationRequest(
                quoteId=quote_response["quoteId"],
                idempotencyKey="task-disc-step-1",
                payload=RuntimePayloadRecord(body={"text": "hello typed world"}),
                responseMode="sync",
            ),
            raw_token,
            "req-disc-invoke-001",
        )
    )

    assert quote_response["serviceId"] == discovery_result.service_id
    assert invocation_response["status"] == "SUCCEEDED"
    assert invocation_response["result"]["echo"] == "hello typed world"


def test_agent_runtime_http_contract_locks_discovery_quote_and_invocation(monkeypatch) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_service_definition(), _runtime_credential(raw_token))
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = 10.0

    monkeypatch.setattr(forwarding_service, "_get_redis_client", _async_none)
    monkeypatch.setattr(forwarding_upstream.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(
        forwarding_upstream.service_health_service,
        "get_healthy_target_urls",
        lambda service: [service.invoke.targets[0].url],
    )
    monkeypatch.setattr(
        forwarding_billing.settings, "gateway_routing_tax", 0.05, raising=False
    )

    with _http_runtime_client(monkeypatch, storage) as client:
        discovery_request = AgentDiscoverySearchRequest(query="echo", limit=5)
        discovery_http = client.post(
            "/api/v1/agent/discovery/search",
            json=discovery_request.model_dump(by_alias=True),
            headers={"X-Request-Id": "req-http-disc-001"},
        )

        assert discovery_http.status_code == 200
        discovery_response = AgentDiscoverySearchResponse.model_validate(
            discovery_http.json()
        )
        assert discovery_response.requestId == "req-http-disc-001"
        assert discovery_response.count == 1

        discovery_result = discovery_response.results[0]
        quote_request = AgentQuoteRequest(
            serviceId=discovery_result.quote_template.service_id,
            inputPreview=discovery_result.quote_template.input_preview,
            responseMode=discovery_result.quote_template.response_mode,
        )
        quote_http = client.post(
            "/api/v1/agent/quotes",
            json=quote_request.model_dump(by_alias=True),
            headers={
                "X-Credential": raw_token,
                "X-Request-Id": "req-http-quote-001",
            },
        )

        assert quote_http.status_code == 200
        quote_response = AgentQuoteResponse.model_validate(quote_http.json())
        assert quote_response.requestId == "req-http-quote-001"
        assert quote_response.serviceId == "svc.echo"
        assert quote_response.budgetCheck.allowed is True
        assert quote_response.invokeConstraints.timeoutMs == 15000
        assert quote_response.invokeConstraints.maxPayloadBytes == 4096

        invocation_request = AgentInvocationRequest(
            quoteId=quote_response.quoteId,
            idempotencyKey="task-http-step-1",
            payload=RuntimePayloadRecord(body={"text": "hello typed world"}),
            responseMode="sync",
        )
        invocation_http = client.post(
            "/api/v1/agent/invocations",
            json=invocation_request.model_dump(by_alias=True),
            headers={
                "X-Credential": raw_token,
                "X-Request-Id": "req-http-invoke-001",
            },
        )

        assert invocation_http.status_code == 200
        invocation_response = AgentInvocationResponse.model_validate(
            invocation_http.json()
        )
        assert invocation_response.status == "SUCCEEDED"
        assert invocation_response.receipt is not None
        assert invocation_response.receipt.quoteId == quote_response.quoteId
        assert invocation_response.result["echo"] == "hello typed world"

    persisted_quote = storage.execution.read_quote(quote_response.quoteId)
    persisted_invocation = storage.execution.read_invocation(
        invocation_response.invocationId
    )
    assert persisted_quote is not None
    assert persisted_quote.status == "CONSUMED"
    assert persisted_invocation is not None
    assert persisted_invocation.status == "SUCCEEDED"