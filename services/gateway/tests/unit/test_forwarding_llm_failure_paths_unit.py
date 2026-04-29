from __future__ import annotations

import asyncio
from decimal import Decimal

import pytest
from fastapi import HTTPException

from src.api.schemas.pydantic_models import AgentInvokeRequest
from src.domain.service_contract import RuntimePayloadRecord
from src.services.owner import forwarding_budget, forwarding_service, forwarding_upstream

from tests.unit.test_forwarding_runtime_service_unit import (
    FakeLlmAsyncClient,
    FakeStorage,
    _async_none,
    _llm_service_definition,
    _runtime_credential,
)


class FakeTimeoutLlmClient(FakeLlmAsyncClient):
    async def post(self, url: str, json: dict, headers: dict, timeout=None):
        _ = timeout
        await asyncio.sleep(0)
        type(self).last_request = {"url": url, "json": dict(json), "headers": dict(headers)}
        raise forwarding_upstream.httpx.ReadTimeout("llm provider timed out")


def test_invoke_v1_llm_upstream_timeout_releases_hold_and_marks_retryable(monkeypatch) -> None:
    raw_token = "agt_1234567890abcdef12345678"
    storage = FakeStorage(_llm_service_definition(), _runtime_credential(raw_token))
    storage.balance.ledger.ensure_consumer_wallet("0xabc").available_balance = Decimal("10.000000")

    monkeypatch.setattr(forwarding_budget, "_get_redis_client", _async_none)
    monkeypatch.setattr(forwarding_upstream.httpx, "AsyncClient", FakeTimeoutLlmClient)
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
                    idempotencyKey="llm-timeout-001",
                    costUsdc=Decimal("0"),
                    payload=RuntimePayloadRecord(
                        body={"messages": [{"role": "user", "content": "hi"}], "max_tokens": 10}
                    ),
                ),
                raw_token,
                "req-llm-timeout-001",
            )
        )

    assert exc_info.value.status_code == 504
    assert exc_info.value.detail["code"] == "SERVICE_TIMEOUT"
    assert storage.balance.ledger.consumer_available_balance("0xabc") == Decimal("10.000000")
    assert storage.balance.ledger.consumer_frozen_balance("0xabc") == Decimal("0.000000")
    assert storage.balance.ledger.provider_receivable_balance("0xdef") == Decimal("0")

    invocations = list(storage.execution.invocations.values())
    assert len(invocations) == 1
    assert invocations[0].status == "FAILED_RETRYABLE"
    assert invocations[0].error_code == "SERVICE_TIMEOUT"
    assert invocations[0].error_action == "retry"
