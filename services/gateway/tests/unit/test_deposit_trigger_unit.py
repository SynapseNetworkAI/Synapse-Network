from __future__ import annotations

import pytest

from src.core import config
from src.core.config import settings
from src.services.platform.tasks.deposit_indexer.trigger import post_deposit_indexer_trigger


class _FakeAsyncResponse:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code


class _FakeAsyncClient:
    calls: list[dict[str, object]] = []
    status_code = 200

    def __init__(self, *, timeout: float, trust_env: bool) -> None:
        self.timeout = timeout
        self.trust_env = trust_env

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url: str, *, headers: dict[str, str], json: dict[str, str]):
        self.calls.append(
            {
                "url": url,
                "headers": headers,
                "json": json,
                "timeout": self.timeout,
                "trust_env": self.trust_env,
            }
        )
        return _FakeAsyncResponse(self.status_code)


@pytest.mark.asyncio
async def test_deposit_trigger_posts_with_delay_and_shared_secret(monkeypatch) -> None:
    sleep_calls: list[float] = []

    async def _fake_sleep(delay: float) -> None:
        sleep_calls.append(delay)

    _FakeAsyncClient.calls = []
    monkeypatch.setattr(settings, "deposit_indexer_trigger_enabled", True, raising=False)
    monkeypatch.setattr(settings, "internal_trigger_secret", "unit-secret", raising=False)
    monkeypatch.setattr(
        settings,
        "deposit_indexer_trigger_url",
        "https://gateway.test/internal/jobs/deposit-indexer/trigger",
        raising=False,
    )
    monkeypatch.setattr(settings, "deposit_indexer_trigger_delay_sec", 4.0, raising=False)
    monkeypatch.setattr(settings, "deposit_indexer_trigger_timeout_sec", 2.5, raising=False)
    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.trigger.httpx.AsyncClient",
        _FakeAsyncClient,
    )
    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.trigger.asyncio.sleep",
        _fake_sleep,
    )

    assert (
        await post_deposit_indexer_trigger(
            source="deposit_intent_registered",
            triggered_by="unit.test",
            tx_hash="0xABC",
        )
        is True
    )
    assert sleep_calls == [4.0]
    assert _FakeAsyncClient.calls == [
        {
            "url": "https://gateway.test/internal/jobs/deposit-indexer/trigger",
            "headers": {"X-Synapse-Internal-Token": "unit-secret"},
            "json": {
                "source": "deposit_intent_registered",
                "triggeredBy": "unit.test",
                "txHash": "0xabc",
            },
            "timeout": 2.5,
            "trust_env": False,
        }
    ]


@pytest.mark.asyncio
async def test_deposit_trigger_handles_disabled_and_http_failure(monkeypatch) -> None:
    monkeypatch.setattr(settings, "deposit_indexer_trigger_enabled", False, raising=False)
    assert await post_deposit_indexer_trigger(source="unit", triggered_by="test") is False

    _FakeAsyncClient.status_code = 503
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(settings, "deposit_indexer_trigger_enabled", True, raising=False)
    monkeypatch.setattr(settings, "internal_trigger_secret", "unit-secret", raising=False)
    monkeypatch.setattr(
        settings,
        "deposit_indexer_trigger_url",
        "https://gateway.test/internal/jobs/deposit-indexer/trigger",
        raising=False,
    )
    monkeypatch.setattr(settings, "deposit_indexer_trigger_delay_sec", 0.0, raising=False)
    monkeypatch.setattr(settings, "deposit_indexer_trigger_timeout_sec", 1.0, raising=False)
    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.trigger.httpx.AsyncClient",
        _FakeAsyncClient,
    )

    assert await post_deposit_indexer_trigger(source="unit", triggered_by="test") is False


def test_prod_settings_refuse_loopback_deposit_trigger_url(monkeypatch) -> None:
    monkeypatch.setattr(config.Settings, "environment", "prod", raising=False)
    monkeypatch.setattr(config.Settings, "deposit_indexer_trigger_enabled", True, raising=False)
    monkeypatch.setattr(
        config.Settings,
        "deposit_indexer_trigger_url",
        "http://127.0.0.1:8000/internal/jobs/deposit-indexer/trigger",
        raising=False,
    )
    monkeypatch.setattr(
        config.Settings,
        "consumer_withdraw_maturity_enforcement_enabled",
        True,
        raising=False,
    )
    monkeypatch.setattr(
        config.Settings,
        "provider_withdraw_maturity_enforcement_enabled",
        True,
        raising=False,
    )

    with pytest.raises(RuntimeError, match="DEPOSIT_INDEXER_TRIGGER_URL_LOOPBACK_FORBIDDEN"):
        config.Settings()
