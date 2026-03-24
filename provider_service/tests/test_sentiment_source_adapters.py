# pyright: reportMissingImports=false

import asyncio
import sys
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.sentiment.adapters import (  # noqa: E402
    fetch_alternative_me_sentiment,
    fetch_binance_market_snapshot,
    fetch_coingecko_market_snapshot,
)


def test_alternative_me_adapter_parses_live_shape():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/fng/"
        assert request.url.params["limit"] == "1"
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "value": "74",
                        "value_classification": "Greed",
                        "timestamp": "1710931200",
                    }
                ]
            },
        )

    client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://api.alternative.me",
    )
    try:
        snapshot = asyncio.run(fetch_alternative_me_sentiment(client=client))
    finally:
        asyncio.run(client.aclose())

    assert snapshot.value == 74
    assert snapshot.classification == "greed"
    assert snapshot.http_status == 200
    assert snapshot.retry_count == 0
    assert snapshot.timeout_ms == 2000
    assert snapshot.payload_hash
    assert snapshot.freshness_sec >= 0


def test_coingecko_adapter_parses_market_snapshot():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v3/coins/markets"
        assert request.url.params["ids"] == "ethereum"
        assert request.url.params["vs_currency"] == "usd"
        return httpx.Response(
            200,
            json=[
                {
                    "current_price": 3520.12,
                    "price_change_percentage_24h_in_currency": 4.2,
                    "total_volume": 18200000000,
                    "market_cap_rank": 2,
                    "last_updated": "2026-03-24T12:00:00Z",
                }
            ],
        )

    client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://api.coingecko.com/api/v3",
    )
    try:
        snapshot = asyncio.run(
            fetch_coingecko_market_snapshot("ETH", client=client)
        )
    finally:
        asyncio.run(client.aclose())

    assert snapshot.symbol == "ETH"
    assert snapshot.price_usd == pytest.approx(3520.12)
    assert snapshot.change_24h_pct == pytest.approx(4.2)
    assert snapshot.market_cap_rank == 2
    assert snapshot.http_status == 200
    assert snapshot.retry_count == 0
    assert snapshot.payload_hash
    assert snapshot.freshness_sec >= 0


def test_binance_adapter_parses_ticker_and_klines_for_volatility():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v3/ticker/24hr":
            assert request.url.params["symbol"] == "ETHUSDT"
            return httpx.Response(
                200,
                json={
                    "lastPrice": "3518.75",
                    "priceChangePercent": "4.8",
                    "quoteVolume": "29500000000",
                },
            )
        if request.url.path == "/api/v3/klines":
            assert request.url.params["symbol"] == "ETHUSDT"
            assert request.url.params["interval"] == "5m"
            return httpx.Response(
                200,
                json=[
                    [0, "3490", "3500", "3480", "3495", "10", 1710930900000, "0", 0, "0", "0", "0"],
                    [0, "3495", "3502", "3490", "3501", "10", 1710931200000, "0", 0, "0", "0", "0"],
                    [0, "3501", "3515", "3498", "3512", "10", 1710931500000, "0", 0, "0", "0", "0"],
                    [0, "3512", "3524", "3508", "3518", "10", 1710931800000, "0", 0, "0", "0", "0"],
                ],
            )
        raise AssertionError(f"Unexpected Binance path: {request.url.path}")

    client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://api.binance.com",
    )
    try:
        snapshot = asyncio.run(fetch_binance_market_snapshot("ETH", client=client))
    finally:
        asyncio.run(client.aclose())

    assert snapshot.symbol == "ETH"
    assert snapshot.market_symbol == "ETHUSDT"
    assert snapshot.last_price_usd == pytest.approx(3518.75)
    assert snapshot.price_change_pct == pytest.approx(4.8)
    assert snapshot.quote_volume_usd == pytest.approx(29_500_000_000.0)
    assert snapshot.realized_volatility_pct > 0
    assert snapshot.http_status == 200
    assert snapshot.retry_count == 0
    assert snapshot.timeout_ms == 1000
    assert snapshot.payload_hash
    assert snapshot.freshness_sec >= 0


def test_coingecko_adapter_retries_once_before_success():
    attempts = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["count"] += 1
        if attempts["count"] == 1:
            return httpx.Response(503, json={"error": "temporary"})
        return httpx.Response(
            200,
            json=[
                {
                    "current_price": 3520.12,
                    "price_change_percentage_24h_in_currency": 4.2,
                    "total_volume": 18200000000,
                    "market_cap_rank": 2,
                    "last_updated": "2026-03-24T12:00:00Z",
                }
            ],
        )

    client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://api.coingecko.com/api/v3",
    )
    try:
        snapshot = asyncio.run(fetch_coingecko_market_snapshot("ETH", client=client))
    finally:
        asyncio.run(client.aclose())

    assert attempts["count"] == 2
    assert snapshot.retry_count == 1