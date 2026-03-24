# pyright: reportMissingImports=false

import asyncio
from datetime import UTC, datetime
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.schemas.sentiment import (  # noqa: E402
    AlternativeMePayloadExcerpt,
    BinancePayloadExcerpt,
    SentimentRequest,
)
from app.services.sentiment import adapters as sentiment_adapters  # noqa: E402
from app.services.sentiment import plugins as sentiment_plugins  # noqa: E402


def test_sentiment_source_plugin_registry_declares_capabilities():
    plugins = sentiment_plugins.list_sentiment_source_plugins()

    assert [plugin.source_name for plugin in plugins] == [
        "alternative_me",
        "binance_market_data",
    ]
    assert plugins[0].capabilities == ("baseline_sentiment",)
    assert plugins[1].capabilities == (
        "price_momentum",
        "volume_heat",
        "realized_volatility",
    )


def test_alternative_me_plugin_fetch_maps_capability_observation(monkeypatch):
    async def _fake_alternative_me():
        await asyncio.sleep(0)
        return sentiment_adapters.AlternativeMeSentimentSnapshot(
            value=68,
            classification="greed",
            source_timestamp=datetime(2026, 3, 24, 12, 0, tzinfo=UTC),
            fetched_at=datetime(2026, 3, 24, 12, 5, tzinfo=UTC),
            http_status=200,
            latency_ms=55,
            retry_count=0,
            timeout_ms=2000,
            payload_hash="alt-plugin-hash",
            payload_excerpt=AlternativeMePayloadExcerpt(
                value=68,
                classification="greed",
                timestamp=1710931200,
            ),
        )

    monkeypatch.setattr(
        sentiment_adapters,
        "fetch_alternative_me_sentiment",
        _fake_alternative_me,
    )
    payload = SentimentRequest.model_validate({"symbol": "ETH"})

    observation = asyncio.run(
        sentiment_plugins.list_sentiment_source_plugins()[0].fetch(payload)
    )

    assert observation.source_name == "alternative_me"
    assert observation.supports("baseline_sentiment") is True
    assert observation.baseline_score == 68
    assert observation.baseline_classification == "greed"
    assert observation.last_price_usd is None


def test_binance_plugin_fetch_maps_capability_observation(monkeypatch):
    async def _fake_binance(symbol: str):
        await asyncio.sleep(0)
        return sentiment_adapters.BinanceMarketSnapshot(
            symbol=symbol,
            market_symbol=f"{symbol}USDT",
            last_price_usd=3518.75,
            price_change_pct=4.8,
            quote_volume_usd=29_500_000_000.0,
            realized_volatility_pct=1.82,
            source_timestamp=datetime(2026, 3, 24, 12, 4, 55, tzinfo=UTC),
            fetched_at=datetime(2026, 3, 24, 12, 5, tzinfo=UTC),
            http_status=200,
            latency_ms=48,
            retry_count=0,
            timeout_ms=1000,
            payload_hash="binance-plugin-hash",
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
        "fetch_binance_market_snapshot",
        _fake_binance,
    )
    payload = SentimentRequest.model_validate({"symbol": "ETH"})

    observation = asyncio.run(
        sentiment_plugins.list_sentiment_source_plugins()[1].fetch(payload)
    )

    assert observation.source_name == "binance_market_data"
    assert observation.supports("price_momentum") is True
    assert observation.supports("volume_heat") is True
    assert observation.supports("realized_volatility") is True
    assert observation.price_change_pct == 4.8
    assert observation.quote_volume_usd == 29_500_000_000.0
    assert observation.realized_volatility_pct == 1.82