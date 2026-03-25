# pyright: reportMissingImports=false

import asyncio
import sys
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.protocol_fundamental_brief.adapters import (  # noqa: E402
    fetch_defillama_protocol_snapshot,
    fetch_dexscreener_market_snapshot,
)


def test_defillama_adapter_parses_protocol_identity_and_tvl_shape():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/protocols":
            return httpx.Response(
                200,
                request=request,
                json=[
                    {
                        "name": "Aave",
                        "slug": "aave",
                        "symbol": "AAVE",
                        "category": "Lending",
                        "chains": ["Ethereum", "Arbitrum"],
                        "tvl": 5_200_000_000,
                        "change_1d": 2.1,
                        "change_7d": -5.3,
                    }
                ],
            )
        if request.url.path == "/protocol/aave":
            return httpx.Response(
                200,
                request=request,
                json={
                    "name": "Aave",
                    "slug": "aave",
                    "symbol": "AAVE",
                    "chains": ["Ethereum", "Arbitrum"],
                    "category": "Lending",
                    "tvl": 5_200_000_000,
                    "change_1d": 2.1,
                    "change_7d": -5.3,
                    "currentChainTvls": {
                        "Ethereum": 3_400_000_000,
                        "Arbitrum": 1_800_000_000,
                    },
                    "totalDataChart": [
                        [1708300800000, 4_960_000_000],
                        [1710892800000, 5_200_000_000],
                    ],
                },
            )
        if request.url.path == "/summary/fees/aave":
            return httpx.Response(
                200,
                request=request,
                json={
                    "total24h": 320_000,
                    "total7d": 2_180_000,
                    "total30d": 8_900_000,
                    "total24hRevenue": 180_000,
                    "total7dRevenue": 1_100_000,
                    "total30dRevenue": 4_300_000,
                },
            )
        raise AssertionError(f"Unexpected DefiLlama path: {request.url.path}")

    client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://api.llama.fi",
    )
    try:
        snapshot = asyncio.run(fetch_defillama_protocol_snapshot("Aave", client=client))
    finally:
        asyncio.run(client.aclose())

    assert snapshot.protocol_slug == "aave"
    assert snapshot.display_name == "Aave"
    assert snapshot.category == "Lending"
    assert snapshot.supported_chains == ("Ethereum", "Arbitrum")
    assert snapshot.chain_tvl_breakdown["Ethereum"] == pytest.approx(3_400_000_000)
    assert snapshot.tvl_usd_current == pytest.approx(5_200_000_000)
    assert snapshot.fees_24h_usd == pytest.approx(320_000)
    assert snapshot.revenue_24h_usd == pytest.approx(180_000)
    assert snapshot.http_status == 200
    assert snapshot.payload_excerpt.protocol_slug == "aave"
    assert snapshot.payload_hash


def test_defillama_adapter_prefers_canonical_slug_when_symbol_is_ambiguous():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/protocols":
            return httpx.Response(
                200,
                request=request,
                json=[
                    {
                        "name": "Aave V3",
                        "slug": "aave-v3",
                        "symbol": "AAVE",
                        "category": "Lending",
                        "chains": ["Ethereum", "Arbitrum"],
                        "tvl": 5_200_000_000,
                    },
                    {
                        "name": "Aave V2",
                        "slug": "aave-v2",
                        "symbol": "AAVE",
                        "category": "Lending",
                        "chains": ["Ethereum"],
                        "tvl": 120_000_000,
                    },
                ],
            )
        if request.url.path == "/protocol/aave-v3":
            return httpx.Response(
                200,
                request=request,
                json={
                    "name": "Aave V3",
                    "slug": "aave-v3",
                    "symbol": "AAVE",
                    "chains": ["Ethereum", "Arbitrum"],
                    "category": "Lending",
                    "tvl": 5_200_000_000,
                    "totalDataChart": [
                        [1708300800000, 4_960_000_000],
                        [1710892800000, 5_200_000_000],
                    ],
                },
            )
        if request.url.path == "/summary/fees/aave-v3":
            return httpx.Response(
                200,
                request=request,
                json={"total24h": 320_000, "total24hRevenue": 180_000},
            )
        raise AssertionError(f"Unexpected DefiLlama path: {request.url.path}")

    client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://api.llama.fi",
    )
    try:
        snapshot = asyncio.run(fetch_defillama_protocol_snapshot("Aave", client=client))
    finally:
        asyncio.run(client.aclose())

    assert snapshot.protocol_slug == "aave-v3"
    assert snapshot.display_name == "Aave V3"
    assert snapshot.tvl_usd_current == pytest.approx(5_200_000_000)


def test_dexscreener_adapter_selects_highest_liquidity_pair_on_requested_chain():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/latest/dex/search"
        assert request.url.params["q"] == "Aave"
        return httpx.Response(
            200,
            request=request,
            json={
                "pairs": [
                    {
                        "chainId": "base",
                        "pairAddress": "0x-base-low",
                        "dexId": "aerodrome",
                        "baseToken": {"symbol": "AAVE"},
                        "quoteToken": {"symbol": "USDC"},
                        "liquidity": {"usd": 150_000},
                        "volume": {"h24": 800_000},
                        "txns": {"h24": {"buys": 40, "sells": 35}},
                        "priceUsd": "96.2",
                        "priceChange": {"m5": 0.1, "h1": 0.8, "h6": 2.1, "h24": 3.4},
                        "marketCap": 1_450_000_000,
                        "fdv": 1_520_000_000,
                        "pairCreatedAt": 1700000000000,
                    },
                    {
                        "chainId": "ethereum",
                        "pairAddress": "0x-eth-best",
                        "dexId": "uniswap",
                        "baseToken": {"symbol": "AAVE"},
                        "quoteToken": {"symbol": "USDC"},
                        "liquidity": {"usd": 5_400_000},
                        "volume": {"h24": 12_800_000},
                        "txns": {"h24": {"buys": 1812, "sells": 1654}},
                        "priceUsd": "96.2",
                        "priceChange": {"m5": 0.1, "h1": 0.8, "h6": 2.1, "h24": 3.4},
                        "marketCap": 1_450_000_000,
                        "fdv": 1_520_000_000,
                        "pairCreatedAt": 1700000000000,
                    },
                ]
            },
        )

    client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="https://api.dexscreener.com",
    )
    try:
        snapshot = asyncio.run(
            fetch_dexscreener_market_snapshot("Aave", chain="ethereum", client=client)
        )
    finally:
        asyncio.run(client.aclose())

    assert snapshot.chain_id == "ethereum"
    assert snapshot.pair_address == "0x-eth-best"
    assert snapshot.dex_id == "uniswap"
    assert snapshot.spot_price_usd == pytest.approx(96.2)
    assert snapshot.volume_24h_usd == pytest.approx(12_800_000)
    assert snapshot.buy_txn_24h == 1812
    assert snapshot.sell_txn_24h == 1654
    assert snapshot.payload_excerpt.pair_address == "0x-eth-best"
    assert snapshot.payload_hash