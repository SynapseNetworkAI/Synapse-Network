# pyright: reportMissingImports=false

import asyncio
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.schemas.sentiment import RawFeedRecord, SentimentRequest, SentimentResponse  # noqa: E402
from app.services import sentiment_service  # noqa: E402


def _payload() -> SentimentRequest:
    return SentimentRequest.model_validate(
        {
            "symbol": "ETH",
            "chain": "ethereum",
            "lookback_hours": 24,
            "include_narrative": True,
        }
    )


def _response_with_age(age_seconds: int) -> SentimentResponse:
    generated_at = datetime.now(UTC) - timedelta(seconds=age_seconds)
    return SentimentResponse.model_validate(
        {
            "service": {
                "serviceId": "svc_web3_sentiment_index",
                "serviceName": "Web3 Sentiment Index",
                "version": "1.0.0",
            },
            "sources": [{"name": "alternative_me", "freshnessSec": 30}],
            "freshness": {
                "generatedAt": generated_at.isoformat().replace("+00:00", "Z"),
                "maxSourceAgeSec": 30,
                "cacheHit": False,
            },
            "result": {
                "symbol": "ETH",
                "sentiment_score": 68,
                "sentiment_label": "greed",
                "trend_direction": "up",
                "volatility_signal": "medium",
                "market_temperature": "risk-on but not overheated",
                "reasoning_bullets": ["sample 1", "sample 2"],
                "action_hint": "sample",
            },
            "errors": [],
        }
    )


class StubRepository:
    def __init__(self, stored_snapshot: SentimentResponse | None) -> None:
        self.stored_snapshot = stored_snapshot

    def save_snapshot(self, snapshot_key: str, payload: SentimentRequest, response: SentimentResponse) -> None:
        self.stored_snapshot = response

    def load_snapshot(self, snapshot_key: str) -> SentimentResponse | None:
        return self.stored_snapshot

    def append_raw_feed_records(self, snapshot_key: str, payload: SentimentRequest, records: list[RawFeedRecord]) -> None:
        return None


def test_build_sentiment_snapshot_returns_fresh_persisted_snapshot(monkeypatch):
    payload = _payload()
    repository = StubRepository(_response_with_age(30))
    sentiment_service._snapshot_cache.clear()

    monkeypatch.setattr(sentiment_service, "get_sentiment_repository", lambda: repository)

    async def _unexpected_refresh(*args, **kwargs):
        raise AssertionError("fresh snapshot should not trigger sync refresh")

    monkeypatch.setattr(sentiment_service, "refresh_sentiment_snapshot", _unexpected_refresh)

    response = asyncio.run(sentiment_service.build_sentiment_snapshot(payload))

    assert response.freshness.cache_hit is True
    assert response.result.symbol == "ETH"


def test_build_sentiment_snapshot_returns_stale_snapshot_and_schedules_repair(monkeypatch):
    payload = _payload()
    repository = StubRepository(_response_with_age(180))
    scheduled: list[str] = []
    sentiment_service._snapshot_cache.clear()

    monkeypatch.setattr(sentiment_service, "get_sentiment_repository", lambda: repository)
    monkeypatch.setattr(
        sentiment_service,
        "_schedule_async_refresh",
        lambda queued_payload: scheduled.append(sentiment_service._snapshot_key(queued_payload)),
    )

    async def _unexpected_refresh(*args, **kwargs):
        raise AssertionError("stale-but-servable snapshot should not trigger sync refresh")

    monkeypatch.setattr(sentiment_service, "refresh_sentiment_snapshot", _unexpected_refresh)

    response = asyncio.run(sentiment_service.build_sentiment_snapshot(payload))

    assert response.freshness.cache_hit is True
    assert scheduled == ["eth__ethereum__24h__narrative_on"]


def test_build_sentiment_snapshot_sync_refreshes_hard_expired_snapshot(monkeypatch):
    payload = _payload()
    repository = StubRepository(_response_with_age(1200))
    sentiment_service._snapshot_cache.clear()
    calls: list[str] = []
    unexpected_schedule: list[str] = []

    monkeypatch.setattr(sentiment_service, "get_sentiment_repository", lambda: repository)
    monkeypatch.setattr(
        sentiment_service,
        "_schedule_async_refresh",
        lambda queued_payload: unexpected_schedule.append(
            sentiment_service._snapshot_key(queued_payload)
        ),
    )

    async def _fake_refresh(payload: SentimentRequest, *, reason: str):
        await asyncio.sleep(0)
        calls.append(reason)
        return _response_with_age(0)

    monkeypatch.setattr(sentiment_service, "refresh_sentiment_snapshot", _fake_refresh)

    response = asyncio.run(sentiment_service.build_sentiment_snapshot(payload))

    assert response.freshness.cache_hit is False
    assert calls == [sentiment_service.REFRESH_REASON_REQUEST]
    assert unexpected_schedule == []