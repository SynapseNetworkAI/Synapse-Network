from __future__ import annotations

import pytest

from src.core.config import settings
from src.services.community import support_lark


class FakeResponse:
    status_code = 200


class FakeAsyncClient:
    calls: list[dict] = []

    def __init__(self, *, timeout, trust_env) -> None:
        self.timeout = timeout
        self.trust_env = trust_env

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args) -> None:
        return None

    async def post(self, url, *, json):
        self.calls.append({"url": url, "json": json})
        return FakeResponse()


@pytest.mark.asyncio
async def test_support_lark_card_is_signed_and_redacted(monkeypatch) -> None:
    FakeAsyncClient.calls = []
    monkeypatch.setattr(settings, "support_lark_enabled", True, raising=False)
    monkeypatch.setattr(settings, "support_lark_webhook_url", "https://lark.test/support", raising=False)
    monkeypatch.setattr(settings, "support_lark_secret", "signing-secret", raising=False)
    monkeypatch.setattr(settings, "support_lark_timeout_sec", 3, raising=False)
    monkeypatch.setattr(settings, "environment", "staging", raising=False)
    monkeypatch.setattr(support_lark.httpx, "AsyncClient", FakeAsyncClient)

    sent = await support_lark.send_support_case_lark_card(
        feedback_id="fbk_123",
        support_task_id="frt_123",
        category="billing_support",
        priority="high",
        owner_wallet="0xabc0000000000000000000000000000000000000",
        route="/dashboard/billing/credits",
        message="Please help. privateKey=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        source="dashboard",
    )

    assert sent is True
    body = FakeAsyncClient.calls[0]["json"]
    content = body["card"]["elements"][0]["text"]["content"]
    assert body["sign"]
    assert "SUPPORT_CASE_CREATED" in content
    assert "NO_ACTION_REQUIRED" in content
    assert "[REDACTED_HEX]" in content
    assert "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" not in content
