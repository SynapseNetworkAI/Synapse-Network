# pyright: reportMissingImports=false

import asyncio
from datetime import UTC, datetime
import hashlib
import hmac
import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.main import app  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.schemas.sentiment import (  # noqa: E402
    AlternativeMePayloadExcerpt,
    BinancePayloadExcerpt,
    RawFeedRecord,
    SentimentRequest,
    SentimentResponse,
)
from app.services.sentiment.repository import FileBackedSentimentRepository  # noqa: E402
from app.services.sentiment import adapters as sentiment_adapters  # noqa: E402
from app.services.sentiment import repository as sentiment_repository  # noqa: E402
from app.services import sentiment_service  # noqa: E402


def _signed_headers(payload: dict) -> dict[str, str]:
    settings = get_settings()
    service_id = sentiment_service.SERVICE_ID
    signed_at = "1710931200"
    body = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    digest = hashlib.sha256(body).hexdigest()
    canonical = f"{service_id}.{signed_at}.{digest}"
    signature = hmac.new(
        settings.gateway_provider_signature_secret.encode("utf-8"),
        canonical.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Synapse-Service-Id": service_id,
        "X-Synapse-Signed-At": signed_at,
        "X-Synapse-Signature": signature,
    }


@pytest.fixture(autouse=True)
def stub_live_sentiment_sources(monkeypatch, tmp_path):
    repository = FileBackedSentimentRepository(tmp_path / "sentiment-storage")
    sentiment_repository.get_sentiment_repository.cache_clear()
    monkeypatch.setattr(
        sentiment_repository,
        "get_sentiment_repository",
        lambda: repository,
    )
    monkeypatch.setattr(
        sentiment_service,
        "get_sentiment_repository",
        lambda: repository,
    )

    async def _fake_alternative_me():
        await asyncio.sleep(0)
        return sentiment_adapters.AlternativeMeSentimentSnapshot(
            value=72,
            classification="greed",
            source_timestamp=datetime(2026, 3, 24, 12, 0, tzinfo=UTC),
            fetched_at=datetime(2026, 3, 24, 12, 10, tzinfo=UTC),
            http_status=200,
            latency_ms=80,
            retry_count=0,
            timeout_ms=2000,
            payload_hash="alt-hash",
            payload_excerpt=AlternativeMePayloadExcerpt(
                value=72,
                classification="greed",
                timestamp=1710931200,
            ),
        )

    async def _fake_binance(symbol: str):
        await asyncio.sleep(0)
        return sentiment_adapters.BinanceMarketSnapshot(
            symbol=symbol,
            market_symbol=f"{symbol}USDT",
            last_price_usd=3518.75,
            price_change_pct=4.8,
            quote_volume_usd=29_500_000_000.0,
            realized_volatility_pct=1.82,
            source_timestamp=datetime(2026, 3, 24, 12, 9, 55, tzinfo=UTC),
            fetched_at=datetime(2026, 3, 24, 12, 10, tzinfo=UTC),
            http_status=200,
            latency_ms=70,
            retry_count=0,
            timeout_ms=1000,
            payload_hash="bn-hash",
            payload_excerpt=BinancePayloadExcerpt(
                marketSymbol=f"{symbol}USDT",
                lastPriceUsd=3518.75,
                priceChangePct=4.8,
                quoteVolumeUsd=29_500_000_000.0,
                klineCount=12,
            ),
        )

    monkeypatch.setattr(
        sentiment_adapters,
        "fetch_alternative_me_sentiment",
        _fake_alternative_me,
    )
    monkeypatch.setattr(
        sentiment_adapters,
        "fetch_binance_market_snapshot",
        _fake_binance,
    )
    sentiment_service._snapshot_cache.clear()


def test_web3_sentiment_index_returns_structured_response_and_cache_hit():
    client = TestClient(app)

    payload = {
        "symbol": "ETH",
        "chain": "ethereum",
        "lookback_hours": 24,
        "include_narrative": True,
    }

    first_response = client.post(
        "/provider-services/web3-sentiment-index/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )
    assert first_response.status_code == 200
    first_body = first_response.json()

    assert first_body["service"]["serviceId"] == "svc_web3_sentiment_index"
    assert first_body["service"]["serviceName"] == "Web3 Sentiment Index"
    assert first_body["freshness"]["cacheHit"] is False
    assert {item["name"] for item in first_body["sources"]} == {
        "alternative_me",
        "binance_market_data",
    }
    assert first_body["result"]["symbol"] == "ETH"
    assert 0 <= first_body["result"]["sentiment_score"] <= 100
    assert first_body["result"]["trend_direction"] in {"up", "down", "sideways"}
    assert first_body["result"]["volatility_signal"] in {"low", "medium", "high"}
    assert len(first_body["result"]["reasoning_bullets"]) >= 2
    assert first_body["errors"] == []

    second_response = client.post(
        "/provider-services/web3-sentiment-index/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )
    assert second_response.status_code == 200
    second_body = second_response.json()
    assert second_body["freshness"]["cacheHit"] is True


def test_web3_sentiment_index_smoke_path_preserves_request_id_header():
    client = TestClient(app)

    payload = {"symbol": "BTC"}
    response = client.post(
        "/provider-services/web3-sentiment-index/invoke",
        json=payload,
        headers={
            **_signed_headers(payload),
            "X-Request-Id": "req-provider-registration-smoke",
        },
    )

    assert response.status_code == 200
    assert response.headers["X-Request-Id"] == "req-provider-registration-smoke"
    body = response.json()
    assert body["service"]["serviceId"] == "svc_web3_sentiment_index"
    assert body["result"]["symbol"] == "BTC"
    assert body["freshness"]["cacheHit"] is False


def test_web3_sentiment_index_rejects_unsupported_symbol():
    client = TestClient(app)

    response = client.post(
        "/provider-services/web3-sentiment-index/invoke",
        json={"symbol": "DOGE"},
        headers=_signed_headers({"symbol": "DOGE"}),
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert any("symbol must be one of" in entry["msg"] for entry in detail)


def test_web3_sentiment_index_requires_gateway_signature():
    client = TestClient(app)

    response = client.post(
        "/provider-services/web3-sentiment-index/invoke",
        json={"symbol": "ETH"},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "GATEWAY_SIGNATURE_REQUIRED"


def test_web3_sentiment_index_rejects_invalid_gateway_signature():
    client = TestClient(app)

    payload = {"symbol": "ETH"}
    headers = _signed_headers(payload)
    headers["X-Synapse-Signature"] = "bad-signature"

    response = client.post(
        "/provider-services/web3-sentiment-index/invoke",
        json=payload,
        headers=headers,
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "GATEWAY_SIGNATURE_INVALID"


def test_web3_sentiment_index_allows_unsigned_request_when_signature_check_disabled(monkeypatch):
    settings = get_settings().model_copy(
        update={"gateway_provider_signature_enabled": False}
    )
    monkeypatch.setattr("app.core.gateway_auth.get_settings", lambda: settings)

    client = TestClient(app)

    response = client.post(
        "/provider-services/web3-sentiment-index/invoke",
        json={"symbol": "ETH"},
    )

    assert response.status_code == 200
    assert response.json()["service"]["serviceId"] == "svc_web3_sentiment_index"


def test_refresh_summary_log_tolerates_dict_shaped_errors(monkeypatch):
    entries: list[str] = []

    class FakeLogger:
        def info(self, message: str) -> None:
            entries.append(message)

    monkeypatch.setattr(sentiment_service, "service_logger", FakeLogger())

    response = SentimentResponse.model_validate(
        {
            "service": {
                "serviceId": "svc_web3_sentiment_index",
                "serviceName": "Web3 Sentiment Index",
                "version": "1.0.0",
            },
            "sources": [{"name": "alternative_me", "freshnessSec": 30}],
            "freshness": {
                "generatedAt": "2026-03-24T12:00:00Z",
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
    ).model_copy(
        update={
            "errors": [
                {"code": "UPSTREAM_TIMEOUT", "message": "simulated dict error"}
            ]
        }
    )

    sentiment_service._log_refresh_result(
        snapshot_key="eth__ethereum__24h__narrative_on",
        payload=SentimentRequest.model_validate(
            {
                "symbol": "ETH",
                "chain": "ethereum",
                "lookback_hours": 24,
                "include_narrative": True,
            }
        ),
        response=response,
        reason=sentiment_service.REFRESH_REASON_SCHEDULER,
        duration_ms=123,
        fallback_used=False,
        live_successful_sources=["alternative_me"],
        live_failed_sources=["binance_market_data"],
    )

    assert len(entries) == 1
    assert "error_codes=['UPSTREAM_TIMEOUT']" in entries[0]


def test_web3_sentiment_index_rejects_unexpected_fields():
    client = TestClient(app)

    payload = {"symbol": "ETH", "unexpected": "boom"}
    response = client.post(
        "/provider-services/web3-sentiment-index/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert any(entry["loc"][-1] == "unexpected" for entry in detail)


def test_web3_sentiment_index_falls_back_when_live_sources_fail(monkeypatch):
    async def _boom_alternative_me():
        await asyncio.sleep(0)
        raise RuntimeError("alt source timeout")

    async def _boom_binance(symbol: str):
        await asyncio.sleep(0)
        raise RuntimeError(f"binance unavailable for {symbol}")

    monkeypatch.setattr(
        sentiment_adapters,
        "fetch_alternative_me_sentiment",
        _boom_alternative_me,
    )
    monkeypatch.setattr(
        sentiment_adapters,
        "fetch_binance_market_snapshot",
        _boom_binance,
    )

    client = TestClient(app)
    payload = {"symbol": "SOL", "chain": "solana"}
    response = client.post(
        "/provider-services/web3-sentiment-index/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["result"]["symbol"] == "SOL"
    assert body["sources"] == []
    assert {entry["code"] for entry in body["errors"]} == {
        "ALTERNATIVE_ME_UNAVAILABLE",
        "BINANCE_UNAVAILABLE",
    }


def test_web3_sentiment_index_uses_persisted_snapshot_when_all_live_sources_fail(
    monkeypatch,
):
    client = TestClient(app)
    payload = {
        "symbol": "ETH",
        "chain": "ethereum",
        "lookback_hours": 24,
        "include_narrative": True,
    }

    first_response = client.post(
        "/provider-services/web3-sentiment-index/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )
    assert first_response.status_code == 200

    snapshot_request = SentimentRequest.model_validate(payload)
    snapshot_key = sentiment_service._snapshot_key(snapshot_request)
    repository = sentiment_service.get_sentiment_repository()
    stored_snapshot = repository.load_snapshot(snapshot_key)
    assert stored_snapshot is not None
    repository.save_snapshot(
        snapshot_key,
        snapshot_request,
        stored_snapshot.model_copy(
            update={
                "freshness": stored_snapshot.freshness.model_copy(
                    update={"generated_at": "2026-03-24T00:00:00Z"}
                )
            }
        ),
    )

    sentiment_service._snapshot_cache.clear()

    async def _boom_alternative_me():
        await asyncio.sleep(0)
        raise RuntimeError("alt source timeout")

    async def _boom_binance(symbol: str):
        await asyncio.sleep(0)
        raise RuntimeError(f"binance unavailable for {symbol}")

    monkeypatch.setattr(
        sentiment_adapters,
        "fetch_alternative_me_sentiment",
        _boom_alternative_me,
    )
    monkeypatch.setattr(
        sentiment_adapters,
        "fetch_binance_market_snapshot",
        _boom_binance,
    )

    fallback_response = client.post(
        "/provider-services/web3-sentiment-index/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )
    assert fallback_response.status_code == 200
    body = fallback_response.json()
    assert body["freshness"]["cacheHit"] is True
    assert body["result"]["symbol"] == "ETH"
    assert {entry["code"] for entry in body["errors"]} >= {
        "ALTERNATIVE_ME_UNAVAILABLE",
        "BINANCE_UNAVAILABLE",
        "SENTIMENT_SNAPSHOT_FALLBACK_USED",
    }


def test_web3_sentiment_index_discards_legacy_coingecko_snapshot(monkeypatch, tmp_path):
    repository = FileBackedSentimentRepository(tmp_path / "sentiment-storage")
    monkeypatch.setattr(
        sentiment_repository,
        "get_sentiment_repository",
        lambda: repository,
    )
    monkeypatch.setattr(
        sentiment_service,
        "get_sentiment_repository",
        lambda: repository,
    )
    sentiment_service._snapshot_cache.clear()

    payload = SentimentRequest.model_validate(
        {
            "symbol": "BTC",
            "chain": "market-wide",
            "lookback_hours": 24,
            "include_narrative": True,
        }
    )
    snapshot_key = sentiment_service._snapshot_key(payload)
    repository.save_snapshot(
        snapshot_key,
        payload,
        SentimentResponse.model_validate(
            {
                "service": {
                    "serviceId": "svc_web3_sentiment_index",
                    "serviceName": "Web3 Sentiment Index",
                    "version": "1.0.0",
                },
                "sources": [
                    {"name": "alternative_me", "freshnessSec": 60},
                    {"name": "coingecko", "freshnessSec": 45},
                ],
                "freshness": {
                    "generatedAt": "2026-03-24T12:00:00Z",
                    "maxSourceAgeSec": 60,
                    "cacheHit": False,
                },
                "result": {
                    "symbol": "BTC",
                    "sentiment_score": 50,
                    "sentiment_label": "neutral",
                    "trend_direction": "sideways",
                    "volatility_signal": "low",
                    "market_temperature": "balanced with selective risk appetite",
                    "reasoning_bullets": [
                        "Alternative.me baseline is 50/100 with 'neutral' risk appetite.",
                        "CoinGecko shows BTC at $50,000.00 with 2.00% 24h change.",
                    ],
                    "action_hint": "sample",
                },
                "errors": [
                    {
                        "code": "COINGECKO_UNAVAILABLE",
                        "message": "legacy persisted error",
                    }
                ],
            }
        ),
    )

    client = TestClient(app)
    response = client.post(
        "/provider-services/web3-sentiment-index/invoke",
        json={"symbol": "BTC"},
        headers=_signed_headers({"symbol": "BTC"}),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["freshness"]["cacheHit"] is False
    assert {source["name"] for source in body["sources"]} == {
        "alternative_me",
        "binance_market_data",
    }
    assert all(error["code"] != "COINGECKO_UNAVAILABLE" for error in body["errors"])
    assert all("coingecko" not in bullet.lower() for bullet in body["result"]["reasoning_bullets"])


def test_web3_sentiment_index_persists_raw_feed_records(tmp_path):
    repository = FileBackedSentimentRepository(tmp_path / "sentiment-storage")
    snapshot_key = "eth__ethereum__24h__narrative_on"
    repository.append_raw_feed_records(
        snapshot_key,
        SentimentRequest.model_validate(
            {
                "symbol": "ETH",
                "chain": "ethereum",
                "lookback_hours": 24,
                "include_narrative": True,
            }
        ),
        [
            RawFeedRecord(
                symbol="ETH",
                chain="ethereum",
                sourceName="alternative_me",
                success=True,
                fetchedAt="2026-03-24T12:10:00Z",
                sourceTimestamp="2026-03-24T12:00:00Z",
                latencyMs=100,
                retryCount=0,
                timeoutMs=2000,
                httpStatus=200,
                payloadHash="hash-1",
                payloadExcerpt={
                    "value": 72,
                    "classification": "greed",
                    "timestamp": 1710931200,
                },
                errorCode=None,
                errorMessage=None,
            )
        ],
    )

    raw_feed_file = repository.raw_feeds_dir / f"{snapshot_key}.jsonl"
    assert raw_feed_file.exists()
    lines = raw_feed_file.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    assert '"sourceName": "alternative_me"' in lines[0]


def test_web3_sentiment_index_saves_snapshot_before_appending_raw_feed_records(
    monkeypatch,
):
    events: list[tuple[str, str]] = []

    class OrderedRepository:
        def __init__(self) -> None:
            self.saved_snapshot_keys: set[str] = set()

        def save_snapshot(
            self,
            snapshot_key: str,
            payload: SentimentRequest,
            response: SentimentResponse,
        ) -> None:
            assert payload.symbol == "ETH"
            assert response.result.symbol == "ETH"
            self.saved_snapshot_keys.add(snapshot_key)
            events.append(("save", snapshot_key))

        def load_snapshot(self, snapshot_key: str) -> SentimentResponse | None:
            events.append(("load", snapshot_key))
            return None

        def append_raw_feed_records(
            self,
            snapshot_key: str,
            payload: SentimentRequest,
            records: list[RawFeedRecord],
        ) -> None:
            assert payload.symbol == "ETH"
            assert records
            assert snapshot_key in self.saved_snapshot_keys
            events.append(("append", snapshot_key))

    repository = OrderedRepository()
    monkeypatch.setattr(
        sentiment_repository,
        "get_sentiment_repository",
        lambda: repository,
    )
    monkeypatch.setattr(
        sentiment_service,
        "get_sentiment_repository",
        lambda: repository,
    )
    sentiment_service._snapshot_cache.clear()

    client = TestClient(app)
    payload = {
        "symbol": "ETH",
        "chain": "ethereum",
        "lookback_hours": 24,
        "include_narrative": True,
    }

    response = client.post(
        "/provider-services/web3-sentiment-index/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 200
    assert events == [
        ("load", "eth__ethereum__24h__narrative_on"),
        ("save", "eth__ethereum__24h__narrative_on"),
        ("append", "eth__ethereum__24h__narrative_on"),
    ]


def test_refresh_sentiment_snapshot_logs_final_result(monkeypatch):
    entries: list[str] = []

    class FakeLogger:
        def info(self, message: str) -> None:
            entries.append(message)

        def warning(self, message: str) -> None:
            entries.append(message)

        def error(self, message: str) -> None:
            entries.append(message)

    payload = SentimentRequest.model_validate(
        {
            "symbol": "ETH",
            "chain": "ethereum",
            "lookback_hours": 24,
            "include_narrative": True,
        }
    )

    monkeypatch.setattr(sentiment_service, "service_logger", FakeLogger())

    response = asyncio.run(
        sentiment_service.refresh_sentiment_snapshot(
            payload,
            reason=sentiment_service.REFRESH_REASON_REQUEST,
        )
    )

    assert response.result.symbol == "ETH"
    result_logs = [message for message in entries if "Sentiment refresh completed" in message]
    assert len(result_logs) == 1
    assert "snapshot_key=eth__ethereum__24h__narrative_on" in result_logs[0]
    assert "reason=request" in result_logs[0]
    assert "sentiment_score=" in result_logs[0]
    assert "source_names=['alternative_me', 'binance_market_data']" in result_logs[0]
    assert "duration_ms=" in result_logs[0]
