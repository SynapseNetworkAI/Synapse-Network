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
from app.schemas.sentiment import SentimentRequest, SentimentResponse  # noqa: E402
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
            payload_excerpt={"value": 72, "classification": "greed"},
        )

    async def _fake_coingecko(symbol: str):
        await asyncio.sleep(0)
        return sentiment_adapters.CoinGeckoMarketSnapshot(
            symbol=symbol,
            price_usd=3520.12,
            change_24h_pct=4.2,
            volume_24h_usd=18_200_000_000.0,
            market_cap_rank=2,
            source_timestamp=datetime(2026, 3, 24, 12, 9, 30, tzinfo=UTC),
            fetched_at=datetime(2026, 3, 24, 12, 10, tzinfo=UTC),
            http_status=200,
            latency_ms=95,
            retry_count=0,
            timeout_ms=2000,
            payload_hash="cg-hash",
            payload_excerpt={
                "priceUsd": 3520.12,
                "change24hPct": 4.2,
                "volume24hUsd": 18_200_000_000.0,
                "marketCapRank": 2,
            },
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
            payload_excerpt={
                "marketSymbol": f"{symbol}USDT",
                "lastPriceUsd": 3518.75,
                "priceChangePct": 4.8,
                "quoteVolumeUsd": 29_500_000_000.0,
                "klineCount": 12,
            },
        )

    monkeypatch.setattr(
        sentiment_adapters,
        "fetch_alternative_me_sentiment",
        _fake_alternative_me,
    )
    monkeypatch.setattr(
        sentiment_adapters,
        "fetch_coingecko_market_snapshot",
        _fake_coingecko,
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
        "coingecko",
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

    async def _boom_coingecko(symbol: str):
        await asyncio.sleep(0)
        raise RuntimeError(f"coingecko unavailable for {symbol}")

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
        "fetch_coingecko_market_snapshot",
        _boom_coingecko,
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
        "COINGECKO_UNAVAILABLE",
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

    sentiment_service._snapshot_cache.clear()

    async def _boom_alternative_me():
        await asyncio.sleep(0)
        raise RuntimeError("alt source timeout")

    async def _boom_coingecko(symbol: str):
        await asyncio.sleep(0)
        raise RuntimeError(f"coingecko unavailable for {symbol}")

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
        "fetch_coingecko_market_snapshot",
        _boom_coingecko,
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
        "COINGECKO_UNAVAILABLE",
        "BINANCE_UNAVAILABLE",
        "SENTIMENT_SNAPSHOT_FALLBACK_USED",
    }


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
            {
                "symbol": "ETH",
                "chain": "ethereum",
                "sourceName": "alternative_me",
                "success": True,
                "fetchedAt": "2026-03-24T12:10:00Z",
                "sourceTimestamp": "2026-03-24T12:00:00Z",
                "latencyMs": 100,
                "retryCount": 0,
                "timeoutMs": 2000,
                "httpStatus": 200,
                "payloadHash": "hash-1",
                "payloadExcerpt": {"value": 72},
                "errorCode": None,
                "errorMessage": None,
            }
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
            records: list[dict],
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
        ("save", "eth__ethereum__24h__narrative_on"),
        ("append", "eth__ethereum__24h__narrative_on"),
    ]
