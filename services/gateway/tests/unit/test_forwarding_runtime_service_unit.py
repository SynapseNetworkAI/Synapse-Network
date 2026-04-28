from __future__ import annotations

import asyncio
import json
import logging
from contextlib import contextmanager
from decimal import Decimal
from types import SimpleNamespace
from typing import Optional

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from src.api.schemas.pydantic_models import (
    AgentDiscoverySearchRequest,
    AgentInvokeRequest,
    InferenceRequest,
)
from src.domain.gateway import OwnerSpendLimitRow
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
from src.services.owner import downstream_concurrency, forwarding_billing, forwarding_budget, forwarding_service, forwarding_upstream, forwarding_validation
from src.services.platform import credential_service
from src.services.provider.registry_service import RegistryService


class InMemoryBalanceRepo:
    def __init__(self) -> None:
        self.ledger = BalanceLedger()

    def read_balance_ledger(self):
        return self.ledger.model_copy(deep=True)

    def write_balance_ledger(self, ledger):
        self.ledger = ledger.model_copy(deep=True)

    def reserve_consumer_balance_for_manual_review(self, owner, amount_usdc, updated_at):
        ledger = self.read_balance_ledger()
        wallet = ledger.ensure_consumer_wallet(owner)
        amount = Decimal(str(amount_usdc)).quantize(Decimal("0.000001"))
        if Decimal(str(wallet.available_balance)) < amount:
            raise RuntimeError("INSUFFICIENT_AVAILABLE_BALANCE")
        wallet.available_balance = (Decimal(str(wallet.available_balance)) - amount).quantize(Decimal("0.000001"))
        wallet.frozen_balance = (Decimal(str(wallet.frozen_balance)) + amount).quantize(Decimal("0.000001"))
        ledger.updated_at = updated_at
        self.write_balance_ledger(ledger)

    def release_consumer_frozen_to_available(self, owner, amount_usdc, updated_at):
        ledger = self.read_balance_ledger()
        wallet = ledger.ensure_consumer_wallet(owner)
        amount = Decimal(str(amount_usdc)).quantize(Decimal("0.000001"))
        if Decimal(str(wallet.frozen_balance)) < amount:
            raise RuntimeError("RELEASE_FROZEN_TO_AVAILABLE_INCONSISTENT")
        wallet.frozen_balance = (Decimal(str(wallet.frozen_balance)) - amount).quantize(Decimal("0.000001"))
        wallet.available_balance = (Decimal(str(wallet.available_balance)) + amount).quantize(Decimal("0.000001"))
        ledger.updated_at = updated_at
        self.write_balance_ledger(ledger)


class InMemoryFeePolicyRepo:
    def get_platform_fee_policy(self):
        return FeePolicyEntity(defaultRate=0.1, updatedAt="2026-03-17 00:00:00")


class InMemoryGatewayStateRepo:
    def __init__(self) -> None:
        self.usage_rows: list[UsageLogRow] = []
        self.owner_spend_limit_rows: list[OwnerSpendLimitRow] = []

    def read_invocation_billing_rows(self):
        return list(self.usage_rows)

    def write_invocation_billing_rows(self, rows):
        assert all(isinstance(row, UsageLogRow) for row in rows)
        self.usage_rows = list(rows)

    def read_owner_spend_limit_rows(self):
        return list(self.owner_spend_limit_rows)


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
    def __init__(self, payload, headers: Optional[dict[str, str]] = None):
        self._payload = payload
        self.content = json.dumps(payload).encode("utf-8")
        self.status_code = 200
        self.headers = headers or {"content-type": "application/json"}

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

    async def post(self, url: str, json: dict, headers: dict, timeout=None):
        _ = timeout
        await asyncio.sleep(0)
        type(self).last_request = {
            "url": url,
            "json": dict(json),
            "headers": dict(headers),
            "timeout": self.timeout,
        }
        return FakeResponse({"quote": {"answer": "pong", "echo": json["text"]}})


class FakeLlmAsyncClient:
    last_request = None

    def __init__(self, timeout: float):
        self.timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        _ = (exc_type, exc, tb)
        return False

    async def post(self, url: str, json: dict, headers: dict, timeout=None):
        _ = timeout
        await asyncio.sleep(0)
        type(self).last_request = {
            "url": url,
            "json": dict(json),
            "headers": dict(headers),
            "timeout": self.timeout,
        }
        return FakeResponse(
            {
                "id": "chatcmpl-local-001",
                "model": "provider/deepseek-chat",
                "choices": [{"message": {"role": "assistant", "content": "pong"}}],
                "usage": {
                    "prompt_tokens": 1000,
                    "completion_tokens": 500,
                    "total_tokens": 1500,
                },
            }
        )


class FakeMissingUsageLlmClient(FakeLlmAsyncClient):
    async def post(self, url: str, json: dict, headers: dict, timeout=None):
        _ = timeout
        await asyncio.sleep(0)
        type(self).last_request = {"url": url, "json": dict(json), "headers": dict(headers)}
        return FakeResponse({"id": "chatcmpl-local-usage-missing", "choices": []})


class FakeSseLlmClient(FakeLlmAsyncClient):
    async def post(self, url: str, json: dict, headers: dict, timeout=None):
        _ = timeout
        await asyncio.sleep(0)
        type(self).last_request = {"url": url, "json": dict(json), "headers": dict(headers)}
        return FakeResponse({"event": "chunk"}, headers={"content-type": "text/event-stream"})


class FakeStructuredAsyncClient:
    last_request = None

    def __init__(self, timeout: float):
        self.timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        _ = (exc_type, exc, tb)
        return False

    async def post(self, url: str, json: dict, headers: dict, timeout=None):
        _ = timeout
        await asyncio.sleep(0)
        type(self).last_request = {
            "url": url,
            "json": dict(json),
            "headers": dict(headers),
            "timeout": self.timeout,
        }
        return FakeResponse(
            {
                "service": {
                    "serviceId": "svc_web3_sentiment_index",
                    "serviceName": "Web3 Sentiment Index",
                    "version": "1.0.0",
                },
                "freshness": {
                    "generatedAt": "2026-03-24T00:00:00Z",
                    "maxSourceAgeSec": 45,
                    "cacheHit": False,
                },
                "result": {
                    "symbol": json["symbol"],
                    "sentiment_score": 68,
                    "sentiment_label": "greed",
                    "trend_direction": "up",
                    "volatility_signal": "medium",
                    "reasoning_bullets": [
                        "Fear and Greed baseline is above neutral.",
                        "Short-term price momentum remains positive.",
                    ],
                },
                "errors": [],
            }
        )


class FakeSlowAsyncClient:
    def __init__(self, timeout: float):
        self.timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        _ = (exc_type, exc, tb)
        return False

    async def post(self, url: str, json: dict, headers: dict, timeout=None):
        _ = timeout
        _ = (url, json, headers)
        await asyncio.sleep(0.05)
        return FakeResponse({"quote": {"answer": "slow-ok"}})


class FakePoolTimeoutAsyncClient:
    def __init__(self, timeout: float):
        self.timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        _ = (exc_type, exc, tb)
        return False

    async def post(self, url: str, json: dict, headers: dict, timeout=None):
        _ = timeout
        _ = (url, json, headers)
        raise forwarding_upstream.httpx.PoolTimeout("pool saturated")


class FakePerRequestTimeoutAsyncClient:
    instances = []

    def __init__(self, timeout, limits=None):
        self.timeout = timeout
        self.limits = limits
        self.post_timeouts = []
        type(self).instances.append(self)

    async def post(self, url: str, json: dict, headers: dict, timeout=None):
        _ = (url, json, headers)
        self.post_timeouts.append(timeout)
        return FakeResponse({"quote": {"answer": "ok"}})


class FakeRedisCounter:
    def __init__(self, initial: int = 0):
        self.value = initial

    async def incr(self, key: str) -> int:
        _ = key
        self.value += 1
        return self.value

    async def decr(self, key: str) -> int:
        _ = key
        self.value -= 1
        return self.value

    async def expire(self, key: str, ttl: int) -> None:
        _ = (key, ttl)

    async def delete(self, key: str) -> None:
        _ = key
        self.value = 0


async def _async_none():
    await asyncio.sleep(0)
    return None


def _async_value(value):
    async def _return_value():
        return value

    return _return_value


@pytest.fixture(autouse=True)
def _reset_downstream_concurrency_state():
    downstream_concurrency.reset_downstream_concurrency_state()
    yield
    downstream_concurrency.reset_downstream_concurrency_state()


async def _background_loop_until_stopped(stop_event, storage) -> None:
    _ = storage
    await stop_event.wait()


class AgentDiscoverySearchResponse(BaseModel):
    requestId: str
    results: list[PublicServiceDiscoveryRecord]
    count: int
    page: int
    pageSize: int
    totalCount: int
    hasMore: bool


class BudgetCheckResponse(BaseModel):
    allowed: bool
    remainingBudgetUsdc: Optional[Decimal] = None
    remainingDailyLimitUsdc: Optional[Decimal] = None
    remainingBillingCycleLimitUsdc: Optional[Decimal] = None


class InvokeConstraintsResponse(BaseModel):
    body: dict = Field(default_factory=dict)
    timeoutMs: int
    maxPayloadBytes: int


class AgentQuoteResponse(BaseModel):
    requestId: str
    quoteId: str
    serviceId: str
    priceUsdc: Decimal
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
    monkeypatch.setattr(
        gateway_app,
        "run_provider_withdraw_expiry_reaper",
        _background_loop_until_stopped,
    )
    monkeypatch.setattr(
        gateway_app.settings,
        "provider_withdraw_expiry_reaper_enabled",
        False,
        raising=False,
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
        tags=["echo", "inspiration"],
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


def _free_service_definition() -> ServiceDefinitionRecord:
    return _service_definition().model_copy(update={"pricing_amount": Decimal("0")})


def _signed_service_definition() -> ServiceDefinitionRecord:
    service = _service_definition()
    return service.model_copy(
        update={
            "auth": service.auth.model_copy(update={"auth_type": "gateway_signed"}),
            "primary_endpoint": service.primary_endpoint.model_copy(
                update={"auth_mode": "gateway_signed"}
            )
            if service.primary_endpoint is not None
            else None,
        }
    )


def _structured_service_definition() -> ServiceDefinitionRecord:
    return ServiceDefinitionRecord(
        serviceId="svc_web3_sentiment_index",
        ownerAddress="0xdef",
        serviceName="Web3 Sentiment Index",
        summary="Structured crypto market sentiment score.",
        status="active",
        isActive=True,
        pricingAmount="0.01",
        pricingCurrency="USDC",
        tags=["web3", "sentiment"],
        auth={"type": "gateway_signed"},
        constraints={
            "timeoutMs": 8000,
            "maxQps": 10,
            "maxRequestBytes": 131072,
            "maxResponseBytes": 131072,
        },
        forwarding={"requestIdHeader": "X-Synapse-Request-Id"},
        invoke={
            "method": "POST",
            "targets": [
                {
                    "url": "https://provider.test/provider-services/web3-sentiment-index/invoke",
                    "weight": 100,
                }
            ],
            "request": {
                "contentType": "application/json",
                "schema": {
                    "body": {
                        "type": "object",
                        "required": ["symbol"],
                        "properties": {
                            "symbol": {"type": "string"},
                            "chain": {"type": "string"},
                            "lookback_hours": {"type": "integer"},
                            "include_narrative": {"type": "boolean"},
                        },
                        "additionalProperties": False,
                    }
                },
            },
            "response": {
                "contentType": "application/json",
                "schema": {"body": {"type": "object"}},
            },
        },
    )


def _llm_service_definition() -> ServiceDefinitionRecord:
    return ServiceDefinitionRecord(
        serviceId="svc.llm.deepseek",
        ownerAddress="0xdef",
        serviceName="DeepSeek Chat via Provider",
        summary="OpenAI-compatible provider-hosted LLM endpoint.",
        status="active",
        isActive=True,
        pricingAmount="0",
        pricingCurrency="USDC",
        priceModel="token_metered",
        serviceKind="llm",
        tags=["llm", "deepseek"],
        constraints={
            "timeoutMs": 15000,
            "maxQps": 10,
            "maxRequestBytes": 65536,
            "maxResponseBytes": 65536,
        },
        forwarding={"requestIdHeader": "X-Synapse-Request-Id"},
        metering={
            "billingUnit": "token",
            "inputPricePer1MTokensUsdc": "0.140000",
            "outputPricePer1MTokensUsdc": "0.280000",
            "defaultMaxOutputTokens": 2048,
            "holdBufferMultiplier": "1.2",
            "maxAutoHoldUsdc": "1.000000",
        },
        invoke={
            "method": "POST",
            "targets": [{"url": "https://provider.test/llm/chat", "weight": 100}],
            "request": {
                "contentType": "application/json",
                "schema": {"body": {"required": ["messages"]}},
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

    monkeypatch.setattr(forwarding_budget, "_get_redis_client", _async_none)
    monkeypatch.setattr(forwarding_upstream.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(
        forwarding_upstream.service_health_service,
        "get_healthy_target_urls",
        lambda service, **_: [service.invoke.targets[0].url],
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

    receipt = response.payload.receipt
    assert receipt.requestId == "req-typed-001"
    assert receipt.quoteId.startswith("quote-")
    assert receipt.invocationId.startswith("inv-")
    assert receipt.serviceId == "svc.echo"
    assert Decimal(str(receipt.serviceUnitPrice)) == Decimal("1.2")
    assert Decimal(str(receipt.totalCharge)) == Decimal("1.25")
    assert Decimal(str(receipt.consumerAvailableBalanceAfter)) == Decimal("8.75")

    assert response.payload.data.result == {
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

    assert storage.balance.ledger.consumer_available_balance("0xabc") == Decimal("8.750000")
    assert storage.balance.ledger.provider_receivable_balance("0xdef") == Decimal("1.080000")
    assert storage.balance.ledger.platform.fee_accrued == Decimal("0.170000")

    assert len(storage.audit.rows) == 1
    assert storage.audit.rows[0].action == "V2_USAGE_CHARGED"
    assert storage.audit.rows[0].details["quoteId"] == receipt.quoteId
    assert storage.audit.rows[0].details["invocationId"] == receipt.invocationId
    assert storage.audit.rows[0].details["resultStatus"] == "success"
    assert storage.execution.read_quote(receipt.quoteId).status == "CONSUMED"
    assert storage.execution.read_invocation(receipt.invocationId).status == "SUCCEEDED"


def test_invoke_v1_llm_auto_preauth_settles_usage_and_releases_hold(monkeypatch) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_llm_service_definition(), _runtime_credential(raw_token))
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = Decimal("10.000000")

    monkeypatch.setattr(forwarding_budget, "_get_redis_client", _async_none)
    monkeypatch.setattr(forwarding_upstream.httpx, "AsyncClient", FakeLlmAsyncClient)
    monkeypatch.setattr(
        forwarding_upstream.service_health_service,
        "get_healthy_target_urls",
        lambda service, **_: [service.invoke.targets[0].url],
    )

    prompt = "a" * 3000
    response = asyncio.run(
        forwarding_service.invoke_v1(
            storage,
            AgentInvokeRequest(
                serviceId="svc.llm.deepseek",
                idempotencyKey="llm-auto-001",
                costUsdc=Decimal("0"),
                payload=RuntimePayloadRecord(
                    body={
                        "model": "deepseek-chat",
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": 500,
                    }
                ),
            ),
            raw_token,
            "req-llm-auto-001",
        )
    )

    assert response.status == "SUCCEEDED"
    assert Decimal(str(response.chargedUsdc)) == Decimal("0.000280")
    assert response.result["usage"] == {
        "inputTokens": 1000,
        "outputTokens": 500,
        "totalTokens": 1500,
    }
    assert response.result["synapse"] == {
        "priceModel": "token_metered",
        "holdUsdc": "0.000336",
        "chargedUsdc": "0.000280",
        "releasedUsdc": "0.000056",
        "providerRevenueUsdc": "0.000252",
        "platformFeeUsdc": "0.000028",
        "preAuthMode": "auto",
    }
    assert storage.balance.ledger.consumer_available_balance("0xabc") == Decimal("9.999720")
    assert storage.balance.ledger.consumer_frozen_balance("0xabc") == Decimal("0.000000")
    assert storage.balance.ledger.provider_receivable_balance("0xdef") == Decimal("0.000252")
    assert storage.balance.ledger.platform.fee_accrued == Decimal("0.000028")


def test_invoke_v1_llm_rejects_streaming_before_upstream(monkeypatch) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_llm_service_definition(), _runtime_credential(raw_token))
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = Decimal("10.000000")

    monkeypatch.setattr(forwarding_budget, "_get_redis_client", _async_none)
    monkeypatch.setattr(forwarding_upstream.httpx, "AsyncClient", FakeLlmAsyncClient)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            forwarding_service.invoke_v1(
                storage,
                AgentInvokeRequest(
                    serviceId="svc.llm.deepseek",
                    idempotencyKey="llm-stream-001",
                    costUsdc=Decimal("0"),
                    payload=RuntimePayloadRecord(
                        body={"messages": [{"role": "user", "content": "hi"}], "stream": True}
                    ),
                ),
                raw_token,
                "req-llm-stream-001",
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "LLM_STREAMING_NOT_SUPPORTED"
    assert storage.balance.ledger.consumer_available_balance("0xabc") == Decimal("10.000000")


def test_invoke_v1_llm_missing_usage_releases_hold(monkeypatch) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_llm_service_definition(), _runtime_credential(raw_token))
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = Decimal("10.000000")

    monkeypatch.setattr(forwarding_budget, "_get_redis_client", _async_none)
    monkeypatch.setattr(forwarding_upstream.httpx, "AsyncClient", FakeMissingUsageLlmClient)
    monkeypatch.setattr(
        forwarding_upstream.service_health_service,
        "get_healthy_target_urls",
        lambda service, **_: [service.invoke.targets[0].url],
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            forwarding_service.invoke_v1(
                storage,
                AgentInvokeRequest(
                    serviceId="svc.llm.deepseek",
                    idempotencyKey="llm-missing-usage-001",
                    costUsdc=Decimal("0"),
                    payload=RuntimePayloadRecord(
                        body={"messages": [{"role": "user", "content": "hi"}], "max_tokens": 10}
                    ),
                ),
                raw_token,
                "req-llm-missing-usage-001",
            )
        )

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail["code"] == "LLM_USAGE_MISSING"
    assert storage.balance.ledger.consumer_available_balance("0xabc") == Decimal("10.000000")
    assert storage.balance.ledger.consumer_frozen_balance("0xabc") == Decimal("0.000000")
    assert storage.balance.ledger.provider_receivable_balance("0xdef") == Decimal("0")


def test_invoke_v1_llm_explicit_max_cost_too_low(monkeypatch) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_llm_service_definition(), _runtime_credential(raw_token))
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = Decimal("10.000000")
    monkeypatch.setattr(forwarding_budget, "_get_redis_client", _async_none)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            forwarding_service.invoke_v1(
                storage,
                AgentInvokeRequest(
                    serviceId="svc.llm.deepseek",
                    idempotencyKey="llm-max-low-001",
                    costUsdc=Decimal("0"),
                    maxCostUsdc=Decimal("0.000001"),
                    payload=RuntimePayloadRecord(
                        body={
                            "messages": [{"role": "user", "content": "a" * 3000}],
                            "max_tokens": 500,
                        }
                    ),
                ),
                raw_token,
                "req-llm-max-low-001",
            )
        )

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail["code"] == "LLM_MAX_COST_TOO_LOW"


def test_invoke_v1_llm_rejects_provider_sse_response(monkeypatch) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_llm_service_definition(), _runtime_credential(raw_token))
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = Decimal("10.000000")

    monkeypatch.setattr(forwarding_budget, "_get_redis_client", _async_none)
    monkeypatch.setattr(forwarding_upstream.httpx, "AsyncClient", FakeSseLlmClient)
    monkeypatch.setattr(
        forwarding_upstream.service_health_service,
        "get_healthy_target_urls",
        lambda service, **_: [service.invoke.targets[0].url],
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            forwarding_service.invoke_v1(
                storage,
                AgentInvokeRequest(
                    serviceId="svc.llm.deepseek",
                    idempotencyKey="llm-sse-001",
                    costUsdc=Decimal("0"),
                    payload=RuntimePayloadRecord(
                        body={"messages": [{"role": "user", "content": "hi"}], "max_tokens": 10}
                    ),
                ),
                raw_token,
                "req-llm-sse-001",
            )
        )

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail["code"] == "LLM_STREAMING_RESPONSE_NOT_SUPPORTED"
    assert storage.balance.ledger.consumer_available_balance("0xabc") == Decimal("10.000000")


@pytest.mark.asyncio
async def test_prepare_upstream_logs_provider_unavailable_alert(monkeypatch, caplog) -> None:
    service = _service_definition()
    monkeypatch.setattr(
        forwarding_upstream.service_health_service,
        "get_healthy_target_urls",
        lambda service, **_: [],
    )
    monkeypatch.setattr(
        forwarding_upstream.settings,
        "forwarding_require_healthy_targets",
        True,
        raising=False,
    )
    caplog.set_level(logging.ERROR, logger=forwarding_upstream.__name__)

    with pytest.raises(HTTPException) as exc_info:
        await forwarding_upstream.prepare_upstream_call(service, {"text": "hello"})

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["code"] == "SERVICE_UNAVAILABLE"
    assert "alert_trigger=PROVIDER_UPSTREAM_UNAVAILABLE" in caplog.text
    assert "service_id=svc.echo" in caplog.text


@pytest.mark.asyncio
async def test_downstream_adaptive_concurrency_reduces_and_recovers(monkeypatch) -> None:
    service = _service_definition()
    target_url = service.invoke.targets[0].url
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_concurrency_enabled", True)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_redis_enabled", False)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_default_concurrency", 4)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_min_concurrency", 1)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_max_concurrency", 8)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_window_sec", 0)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_latency_target_ms", 100)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_decrease_factor", 0.5)

    permit = await downstream_concurrency.acquire_downstream_permit(service, target_url)
    await permit.release(latency_ms=25, status_code=200, error_code=None, success=True)
    recovered = downstream_concurrency.downstream_snapshot_for_service(service)
    assert recovered["adaptiveConcurrencyLimit"] == 5

    permit = await downstream_concurrency.acquire_downstream_permit(service, target_url)
    await permit.release(latency_ms=500, status_code=200, error_code=None, success=True)
    reduced = downstream_concurrency.downstream_snapshot_for_service(service)
    assert reduced["adaptiveConcurrencyLimit"] == 2


@pytest.mark.asyncio
async def test_downstream_adaptive_concurrency_opens_half_open_circuit(monkeypatch) -> None:
    service = _service_definition()
    target_url = service.invoke.targets[0].url
    now_ms = [1_000_000]
    monkeypatch.setattr(downstream_concurrency, "_now_ms", lambda: now_ms[0])
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_concurrency_enabled", True)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_redis_enabled", False)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_default_concurrency", 4)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_circuit_failure_threshold", 2)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_circuit_open_sec", 1)

    for _ in range(2):
        permit = await downstream_concurrency.acquire_downstream_permit(service, target_url)
        await permit.release(
            latency_ms=1500,
            status_code=None,
            error_code="SERVICE_TIMEOUT",
            success=False,
        )

    snapshot = downstream_concurrency.downstream_snapshot_for_service(service)
    assert snapshot["circuitState"] == "open"

    with pytest.raises(HTTPException) as exc_info:
        await downstream_concurrency.acquire_downstream_permit(service, target_url)
    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["code"] == "SERVICE_CIRCUIT_OPEN"

    now_ms[0] += 1_500
    half_open_probe = await downstream_concurrency.acquire_downstream_permit(service, target_url)
    with pytest.raises(HTTPException) as half_open_exc:
        await downstream_concurrency.acquire_downstream_permit(service, target_url)
    assert half_open_exc.value.detail["code"] == "SERVICE_CIRCUIT_OPEN"

    await half_open_probe.release(latency_ms=50, status_code=200, error_code=None, success=True)
    recovered = downstream_concurrency.downstream_snapshot_for_service(service)
    assert recovered["circuitState"] == "closed"


@pytest.mark.asyncio
async def test_downstream_redis_global_counter_rejects_over_limit(monkeypatch) -> None:
    service = _service_definition()
    target_url = service.invoke.targets[0].url
    redis = FakeRedisCounter(initial=1)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_concurrency_enabled", True)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_redis_enabled", True)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_default_concurrency", 1)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_max_concurrency", 1)
    monkeypatch.setattr(downstream_concurrency, "get_redis_client", _async_value(redis))

    with pytest.raises(HTTPException) as exc_info:
        await downstream_concurrency.acquire_downstream_permit(service, target_url)

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["code"] == "SERVICE_BUSY"
    snapshot = downstream_concurrency.downstream_snapshot_for_service(service)
    assert snapshot["inFlight"] == 0
    assert redis.value == 1


@pytest.mark.asyncio
async def test_downstream_redis_degraded_falls_back_to_conservative_local_limit(monkeypatch) -> None:
    service = _service_definition()
    target_url = service.invoke.targets[0].url
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_concurrency_enabled", True)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_redis_enabled", True)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_default_concurrency", 8)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_max_concurrency", 8)
    monkeypatch.setattr(downstream_concurrency, "get_redis_client", _async_none)

    permit = await downstream_concurrency.acquire_downstream_permit(service, target_url)
    snapshot = downstream_concurrency.downstream_snapshot_for_service(service)

    assert snapshot["adaptiveConcurrencyLimit"] == 4
    assert snapshot["inFlight"] == 1
    await permit.release_without_outcome()


@pytest.mark.asyncio
async def test_invoke_busy_rejects_before_charge_or_success_billing(monkeypatch) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_service_definition(), _runtime_credential(raw_token))
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = 10.0

    monkeypatch.setattr(forwarding_budget, "_get_redis_client", _async_none)
    monkeypatch.setattr(forwarding_upstream.httpx, "AsyncClient", FakeSlowAsyncClient)
    monkeypatch.setattr(
        forwarding_upstream.service_health_service,
        "get_healthy_target_urls",
        lambda service, **_: [service.invoke.targets[0].url],
    )
    monkeypatch.setattr(forwarding_billing.settings, "gateway_routing_tax", 0.05, raising=False)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_concurrency_enabled", True)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_redis_enabled", False)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_default_concurrency", 1)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_max_concurrency", 1)
    monkeypatch.setattr(downstream_concurrency.settings, "downstream_adaptive_window_sec", 60)

    async def _invoke(request_id: str):
        return await forwarding_service.generate_response_v2(
            storage,
            InferenceRequest(prompt=f"hello {request_id}", serviceId="svc.echo"),
            "svc.echo",
            raw_token,
            request_id,
        )

    first = asyncio.create_task(_invoke("req-busy-001"))
    await asyncio.sleep(0)
    second_result = await asyncio.gather(
        first,
        _invoke("req-busy-002"),
        return_exceptions=True,
    )

    failures = [item for item in second_result if isinstance(item, HTTPException)]
    assert len(failures) == 1
    assert failures[0].detail["code"] == "SERVICE_BUSY"
    assert storage.balance.ledger.consumer_available_balance("0xabc") == Decimal("8.750000")
    assert storage.balance.ledger.provider_receivable_balance("0xdef") == Decimal("1.080000")
    assert len(storage.audit.rows) == 1
    assert all(row.status != "succeeded" for row in storage.gateway_state.usage_rows)


def test_upstream_http_pool_timeout_rolls_back_charge(monkeypatch) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_service_definition(), _runtime_credential(raw_token))
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = 10.0

    monkeypatch.setattr(forwarding_budget, "_get_redis_client", _async_none)
    monkeypatch.setattr(forwarding_upstream.httpx, "AsyncClient", FakePoolTimeoutAsyncClient)
    monkeypatch.setattr(
        forwarding_upstream.service_health_service,
        "get_healthy_target_urls",
        lambda service, **_: [service.invoke.targets[0].url],
    )
    monkeypatch.setattr(forwarding_billing.settings, "gateway_routing_tax", 0.05, raising=False)
    monkeypatch.setattr(
        forwarding_upstream.settings,
        "provider_http_client_pool_enabled",
        True,
        raising=False,
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            forwarding_service.generate_response_v2(
                storage,
                InferenceRequest(prompt="hello pool", serviceId="svc.echo"),
                "svc.echo",
                raw_token,
                "req-pool-timeout-001",
            )
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["code"] == "SERVICE_BUSY"
    assert storage.balance.ledger.consumer_available_balance("0xabc") == Decimal("10.000000")
    assert storage.balance.ledger.provider_receivable_balance("0xdef") == Decimal("0")
    assert all(row.status != "succeeded" for row in storage.gateway_state.usage_rows)


def test_pooled_upstream_client_uses_per_request_timeout(monkeypatch) -> None:
    FakePerRequestTimeoutAsyncClient.instances = []
    forwarding_upstream._shared_upstream_client_state.client = None
    forwarding_upstream._shared_upstream_client_state.factory = None
    monkeypatch.setattr(
        forwarding_upstream.settings,
        "provider_http_client_pool_enabled",
        True,
        raising=False,
    )
    monkeypatch.setattr(
        forwarding_upstream.httpx,
        "AsyncClient",
        FakePerRequestTimeoutAsyncClient,
    )

    asyncio.run(
        forwarding_upstream._post_upstream(
            "https://provider.example/fast",
            {"prompt": "fast"},
            {},
            3.0,
        )
    )
    asyncio.run(
        forwarding_upstream._post_upstream(
            "https://provider.example/slow",
            {"prompt": "slow"},
            {},
            15.0,
        )
    )

    assert len(FakePerRequestTimeoutAsyncClient.instances) == 1
    first_timeout, second_timeout = FakePerRequestTimeoutAsyncClient.instances[0].post_timeouts
    assert first_timeout.read == 3.0
    assert second_timeout.read == 15.0


def test_invoke_v1_accepts_zero_price_service_without_charging(monkeypatch) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_free_service_definition(), _runtime_credential(raw_token))

    monkeypatch.setattr(forwarding_budget, "_get_redis_client", _async_none)
    monkeypatch.setattr(forwarding_upstream.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(
        forwarding_upstream.service_health_service,
        "get_healthy_target_urls",
        lambda service, **_: [service.invoke.targets[0].url],
    )
    monkeypatch.setattr(
        forwarding_billing.settings, "gateway_routing_tax", 0.05, raising=False
    )

    response = asyncio.run(
        forwarding_service.invoke_v1(
            storage,
            AgentInvokeRequest(
                serviceId="svc.echo",
                idempotencyKey="task-free-smoke-step-1",
                costUsdc=Decimal("0"),
                payload=RuntimePayloadRecord(body={"text": "hello free world"}),
                responseMode="sync",
            ),
            raw_token,
            "req-free-invoke-001",
        )
    )

    assert response.status == "SUCCEEDED"
    assert response.chargedUsdc == Decimal("0")
    assert storage.balance.ledger.consumer_available_balance("0xabc") == Decimal("0")
    assert storage.balance.ledger.provider_receivable_balance("0xdef") == Decimal("0")
    assert storage.balance.ledger.platform.fee_accrued == Decimal("0")
    assert all(row.total_charge == Decimal("0.000000") for row in storage.gateway_state.usage_rows)


def test_find_active_service_hydrates_persisted_health_snapshot() -> None:
    storage = FakeStorage(_service_definition(), _runtime_credential("agt_1234567890abcdef12345678"))

    service = forwarding_validation.find_active_service(storage, "svc.echo")

    assert service.runtime_health is not None
    assert service.runtime_health.healthy_targets == 1
    assert service.runtime_health.targets[0].target_url == "https://provider.test/invoke"


def test_parse_service_price_rejects_invalid_value() -> None:
    service = _service_definition().model_copy(update={"pricing_amount": "not-a-number"})

    with pytest.raises(HTTPException) as exc_info:
        forwarding_validation.parse_service_price_usdc(service)

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail["code"] == "INVALID_SERVICE_PRICE"


@pytest.mark.skip(reason="Route A (quote→invocations) removed; use invoke_v1 flow")
def test_agent_quote_and_invocation_flow_persists_typed_execution_rows(monkeypatch) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_service_definition(), _runtime_credential(raw_token))
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = 10.0

    monkeypatch.setattr(forwarding_budget, "_get_redis_client", _async_none)
    monkeypatch.setattr(forwarding_upstream.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(
        forwarding_upstream.service_health_service,
        "get_healthy_target_urls",
        lambda service, **_: [service.invoke.targets[0].url],
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
    assert Decimal(str(invocation_response["chargedUsdc"])) == Decimal("1.25")

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


def test_owner_billing_cycle_limit_blocks_invoke(monkeypatch) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_service_definition(), _runtime_credential(raw_token))
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = 10.0
    storage.gateway_state.owner_spend_limit_rows = [
        OwnerSpendLimitRow(
            ownerAddress="0xabc",
            spendingLimitUsdc=Decimal("1.000000"),
            cycleInterval="monthly",
            createdAt="2026-04-01 00:00:00",
            updatedAt="2026-04-01 00:00:00",
        )
    ]
    storage.gateway_state.usage_rows = [
        UsageLogRow(
            id="usage-owner-cap-1",
            ts=credential_service.now_ts(),
            consumerAddress="0xabc",
            providerAddress="0xdef",
            status="accepted",
            totalCharge=Decimal("0.600000"),
            businessType="charge",
            riskLevel="green",
        )
    ]

    monkeypatch.setattr(forwarding_budget, "_get_redis_client", _async_none)
    monkeypatch.setattr(forwarding_upstream.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(
        forwarding_upstream.service_health_service,
        "get_healthy_target_urls",
        lambda service, **_: [service.invoke.targets[0].url],
    )
    monkeypatch.setattr(
        forwarding_billing.settings, "gateway_routing_tax", 0.05, raising=False
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            forwarding_service.invoke_v1(
                storage,
                AgentInvokeRequest(
                    serviceId="svc.echo",
                    idempotencyKey="task-owner-cap-step-1",
                    costUsdc=Decimal("1.2"),
                    payload=RuntimePayloadRecord(body={"text": "hello typed world"}),
                    responseMode="sync",
                ),
                raw_token,
                "req-owner-cap-invoke-001",
            )
        )

    assert exc_info.value.status_code == 402
    assert exc_info.value.detail["code"] == "OWNER_BILLING_CYCLE_LIMIT_EXCEEDED"


@pytest.mark.skip(reason="Route A (quote→invocations) removed; use invoke_v1 flow")
def test_agent_discovery_quote_and_invocation_flow_uses_typed_templates(monkeypatch) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_service_definition(), _runtime_credential(raw_token))
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = 10.0
    registry_service = RegistryService(storage)

    monkeypatch.setattr(forwarding_budget, "_get_redis_client", _async_none)
    monkeypatch.setattr(forwarding_upstream.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(
        forwarding_upstream.service_health_service,
        "get_healthy_target_urls",
        lambda service, **_: [service.invoke.targets[0].url],
    )
    monkeypatch.setattr(
        forwarding_billing.settings, "gateway_routing_tax", 0.05, raising=False
    )

    discovery_results = asyncio.run(
        registry_service.search_agent_discovery(
            AgentDiscoveryQueryRecord(query="echo", pageSize=5),
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


@pytest.mark.skip(reason="Route A (quote→invocations) removed; HTTP contract tests need rewrite for /invoke")
def test_agent_runtime_http_contract_locks_discovery_quote_and_invocation(monkeypatch) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_service_definition(), _runtime_credential(raw_token))
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = 10.0

    monkeypatch.setattr(forwarding_budget, "_get_redis_client", _async_none)
    monkeypatch.setattr(forwarding_upstream.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(
        forwarding_upstream.service_health_service,
        "get_healthy_target_urls",
        lambda service, **_: [service.invoke.targets[0].url],
    )
    monkeypatch.setattr(
        forwarding_billing.settings, "gateway_routing_tax", 0.05, raising=False
    )

    with _http_runtime_client(monkeypatch, storage) as client:
        discovery_request = AgentDiscoverySearchRequest(query="echo", pageSize=5)
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
        assert discovery_response.page == 1
        assert discovery_response.pageSize == 5
        assert discovery_response.totalCount == 1
        assert discovery_response.hasMore is False

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


@pytest.mark.skip(reason="Route A (quote→invocations) removed; HTTP contract tests need rewrite for /invoke")
def test_agent_runtime_http_contract_uses_persisted_health_snapshot_for_discovery_and_invoke(
    monkeypatch,
) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_service_definition(), _runtime_credential(raw_token))
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = 10.0

    manifest_service = storage.registry.read_service_registry_rows()[0]
    assert manifest_service.runtime_health is None

    monkeypatch.setattr(forwarding_budget, "_get_redis_client", _async_none)
    monkeypatch.setattr(forwarding_upstream.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(
        forwarding_billing.settings, "gateway_routing_tax", 0.05, raising=False
    )

    with _http_runtime_client(monkeypatch, storage) as client:
        discovery_http = client.post(
            "/api/v1/agent/discovery/search",
            json={"query": "echo", "pageSize": 5},
            headers={"X-Request-Id": "req-http-snapshot-disc-001"},
        )

        assert discovery_http.status_code == 200
        discovery_response = AgentDiscoverySearchResponse.model_validate(
            discovery_http.json()
        )
        assert discovery_response.count == 1

        quote_http = client.post(
            "/api/v1/agent/quotes",
            json={
                "serviceId": discovery_response.results[0].service_id,
                "inputPreview": {
                    "sample": {"body": {"textLength": 17}},
                    "payloadSchema": {"body": {}},
                },
                "responseMode": "sync",
            },
            headers={
                "X-Credential": raw_token,
                "X-Request-Id": "req-http-snapshot-quote-001",
            },
        )

        assert quote_http.status_code == 200
        quote_response = AgentQuoteResponse.model_validate(quote_http.json())

        invocation_http = client.post(
            "/api/v1/agent/invocations",
            json={
                "quoteId": quote_response.quoteId,
                "idempotencyKey": "task-http-snapshot-step-1",
                "payload": {"body": {"text": "hello typed world"}},
                "responseMode": "sync",
            },
            headers={
                "X-Credential": raw_token,
                "X-Request-Id": "req-http-snapshot-invoke-001",
            },
        )

        assert invocation_http.status_code == 200
        invocation_response = AgentInvocationResponse.model_validate(
            invocation_http.json()
        )
        assert invocation_response.status == "SUCCEEDED"

    assert FakeAsyncClient.last_request == {
        "url": "https://provider.test/invoke",
        "json": {"text": "hello typed world"},
        "headers": {"X-Synapse-Request-Id": "task-http-snapshot-step-1"},
        "timeout": 15.0,
    }


def test_call_upstream_adds_gateway_signed_headers(monkeypatch) -> None:
    invocation = InvocationRecord(
        invocationId="inv-1",
        quoteId="quote-1",
        serviceId="svc.echo",
        endpointId="svc.echo:ep:0",
        credentialId="cred-1",
        agentId="agent-1",
        idempotencyKey="req-signed-001",
        requestDigest="digest-1",
        responseMode="sync",
        status="RUNNING",
        createdAt="2026-03-20 10:00:00",
        updatedAt="2026-03-20 10:00:00",
    )

    monkeypatch.setattr(forwarding_upstream.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(
        forwarding_upstream.service_health_service,
        "get_healthy_target_urls",
        lambda service, **_: [service.invoke.targets[0].url],
    )
    monkeypatch.setattr(forwarding_upstream.time, "time", lambda: 1710931200)

    result = asyncio.run(
        forwarding_upstream.call_upstream(
            _signed_service_definition(),
            invocation,
            {"text": "hello typed world"},
        )
    )

    assert result.payload["echo"] == "hello typed world"
    headers = FakeAsyncClient.last_request["headers"]
    assert headers["X-Synapse-Request-Id"] == "req-signed-001"
    assert headers["X-Synapse-Service-Id"] == "svc.echo"
    assert headers["X-Synapse-Signed-At"] == "1710931200"
    assert len(headers["X-Synapse-Signature"]) == 64


def test_gateway_signature_tolerates_secret_manager_newline(monkeypatch) -> None:
    payload = {"text": "hello typed world"}
    monkeypatch.setattr(
        forwarding_upstream.settings,
        "gateway_provider_signature_secret",
        "unit-test-provider-signature-secret",
        raising=False,
    )
    without_newline = forwarding_upstream._gateway_signature(payload, "svc.echo", 1710931200)

    monkeypatch.setattr(
        forwarding_upstream.settings,
        "gateway_provider_signature_secret",
        "unit-test-provider-signature-secret\n",
        raising=False,
    )
    with_newline = forwarding_upstream._gateway_signature(payload, "svc.echo", 1710931200)

    assert with_newline == without_newline


def test_generate_response_v2_supports_structured_payloads(monkeypatch) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_structured_service_definition(), _runtime_credential(raw_token))
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = 10.0

    monkeypatch.setattr(forwarding_budget, "_get_redis_client", _async_none)
    monkeypatch.setattr(
        forwarding_upstream.httpx, "AsyncClient", FakeStructuredAsyncClient
    )
    monkeypatch.setattr(
        forwarding_upstream.service_health_service,
        "get_healthy_target_urls",
        lambda service, **_: [service.invoke.targets[0].url],
    )
    monkeypatch.setattr(
        forwarding_billing.settings, "gateway_routing_tax", 0.05, raising=False
    )

    response = asyncio.run(
        forwarding_service.generate_response_v2(
            storage,
            InferenceRequest(
                serviceId="svc_web3_sentiment_index",
                payload={"symbol": "ETH", "chain": "ethereum", "lookback_hours": 24},
            ),
            "svc_web3_sentiment_index",
            raw_token,
            "req-sentiment-001",
        )
    )

    assert response.payload.data.result["result"]["symbol"] == "ETH"
    assert FakeStructuredAsyncClient.last_request["url"] == (
        "https://provider.test/provider-services/web3-sentiment-index/invoke"
    )
    assert FakeStructuredAsyncClient.last_request["json"] == {
        "symbol": "ETH",
        "chain": "ethereum",
        "lookback_hours": 24,
    }
    assert FakeStructuredAsyncClient.last_request["headers"][
        "X-Synapse-Request-Id"
    ] == "req-sentiment-001"
    assert FakeStructuredAsyncClient.last_request["headers"][
        "X-Synapse-Service-Id"
    ] == "svc_web3_sentiment_index"
    assert len(
        FakeStructuredAsyncClient.last_request["headers"]["X-Synapse-Signature"]
    ) == 64
    assert FakeStructuredAsyncClient.last_request["timeout"] == 8.0


def test_generate_response_v2_returns_required_field_error_for_structured_service(
    monkeypatch,
) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_structured_service_definition(), _runtime_credential(raw_token))
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = 10.0

    monkeypatch.setattr(forwarding_budget, "_get_redis_client", _async_none)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            forwarding_service.generate_response_v2(
                storage,
                InferenceRequest(serviceId="svc_web3_sentiment_index"),
                "svc_web3_sentiment_index",
                raw_token,
                "req-sentiment-missing-001",
            )
        )

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == {
        "code": "REQUEST_REQUIRED_FIELDS_MISSING",
        "message": "service svc_web3_sentiment_index requires fields: symbol",
        "serviceId": "svc_web3_sentiment_index",
        "missingFields": ["symbol"],
    }


def test_agent_discovery_supports_query_or_tag_union_matching(monkeypatch) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_service_definition(), _runtime_credential(raw_token))

    with _http_runtime_client(monkeypatch, storage) as client:
        discovery_http = client.post(
            "/api/v1/agent/discovery/search",
            json={
                "query": "svc.echo",
                "tags": ["missing-tag", "inspiration"],
                "pageSize": 5,
                "sort": "best_match",
            },
            headers={"X-Request-Id": "req-http-disc-search-001"},
        )

    assert discovery_http.status_code == 200
    discovery_response = AgentDiscoverySearchResponse.model_validate(
        discovery_http.json()
    )
    assert discovery_response.requestId == "req-http-disc-search-001"
    assert discovery_response.count == 1
    assert discovery_response.totalCount == 1
    assert discovery_response.results[0].service_id == "svc.echo"


def test_agent_discovery_supports_empty_query_pagination(monkeypatch) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_service_definition(), _runtime_credential(raw_token))

    with _http_runtime_client(monkeypatch, storage) as client:
        discovery_http = client.post(
            "/api/v1/agent/discovery/search",
            json={
                "query": "",
                "page": 1,
                "pageSize": 1,
                "sort": "best_match",
            },
            headers={"X-Request-Id": "req-http-disc-empty-001"},
        )

    assert discovery_http.status_code == 200
    discovery_response = AgentDiscoverySearchResponse.model_validate(
        discovery_http.json()
    )
    assert discovery_response.requestId == "req-http-disc-empty-001"
    assert discovery_response.count == 1
    assert discovery_response.page == 1
    assert discovery_response.pageSize == 1
    assert discovery_response.totalCount == 1
    assert discovery_response.hasMore is False
