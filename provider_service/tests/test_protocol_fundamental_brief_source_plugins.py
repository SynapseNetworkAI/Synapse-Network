# pyright: reportMissingImports=false

import asyncio
from datetime import UTC, datetime
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.schemas.protocol_fundamental_brief import (  # noqa: E402
    DefiLlamaPayloadExcerpt,
    DexScreenerPayloadExcerpt,
    ProtocolFundamentalBriefRequest,
)
from app.services.protocol_fundamental_brief import adapters as brief_adapters  # noqa: E402
from app.services.protocol_fundamental_brief import plugins as brief_plugins  # noqa: E402


def test_protocol_source_plugin_registry_declares_capabilities():
    plugins = brief_plugins.list_protocol_source_plugins()

    assert [plugin.source_name for plugin in plugins] == [
        "defillama_protocol",
        "dexscreener_market",
    ]
    assert plugins[0].capabilities == (
        "protocol_identity",
        "tvl_context",
        "revenue_activity_context",
        "risk_context",
    )
    assert plugins[1].capabilities == (
        "price_context",
        "revenue_activity_context",
        "risk_context",
    )


def test_defillama_plugin_fetch_maps_capability_observation(monkeypatch):
    async def _fake_defillama(protocol: str):
        await asyncio.sleep(0)
        return brief_adapters.DefiLlamaProtocolSnapshot(
            protocol_query=protocol,
            protocol_slug="aave",
            display_name="Aave",
            protocol_symbol="AAVE",
            category="Lending",
            supported_chains=("Ethereum", "Arbitrum"),
            chain_tvl_breakdown={"Ethereum": 3_400_000_000.0},
            tvl_usd_current=5_200_000_000.0,
            tvl_change_1d_pct=2.1,
            tvl_change_7d_pct=-5.3,
            tvl_change_30d_pct=4.8,
            fees_24h_usd=320_000.0,
            fees_7d_usd=2_180_000.0,
            fees_30d_usd=8_900_000.0,
            revenue_24h_usd=180_000.0,
            revenue_7d_usd=1_100_000.0,
            revenue_30d_usd=4_300_000.0,
            source_timestamp=datetime(2026, 3, 24, 12, 0, tzinfo=UTC),
            fetched_at=datetime(2026, 3, 24, 12, 5, tzinfo=UTC),
            http_status=200,
            latency_ms=85,
            retry_count=0,
            timeout_ms=4000,
            payload_hash="defillama-plugin-hash",
            payload_excerpt=DefiLlamaPayloadExcerpt(
                protocolSlug="aave",
                displayName="Aave",
                category="Lending",
                tvlUsd=5_200_000_000.0,
                chainCount=2,
                fees24hUsd=320_000.0,
                revenue24hUsd=180_000.0,
            ),
        )

    monkeypatch.setattr(
        brief_adapters,
        "fetch_defillama_protocol_snapshot",
        _fake_defillama,
    )
    payload = ProtocolFundamentalBriefRequest.model_validate({"protocol": "Aave"})

    observation = asyncio.run(brief_plugins.list_protocol_source_plugins()[0].fetch(payload))

    assert observation.source_name == "defillama_protocol"
    assert observation.supports("protocol_identity") is True
    assert observation.supports("tvl_context") is True
    assert observation.protocol_slug == "aave"
    assert observation.tvl_usd_current == pytest.approx(5_200_000_000.0)


def test_dexscreener_plugin_fetch_maps_capability_observation(monkeypatch):
    async def _fake_dexscreener(protocol: str, *, chain: str | None = None):
        await asyncio.sleep(0)
        return brief_adapters.DexScreenerMarketSnapshot(
            protocol_query=protocol,
            chain_id=chain or "ethereum",
            pair_address="0x-eth-best",
            dex_id="uniswap",
            base_token_symbol="AAVE",
            quote_token_symbol="USDC",
            labels=("v3",),
            spot_price_usd=96.2,
            price_change_5m_pct=0.1,
            price_change_1h_pct=0.8,
            price_change_6h_pct=2.1,
            price_change_24h_pct=3.4,
            volume_24h_usd=12_800_000.0,
            buy_txn_24h=1812,
            sell_txn_24h=1654,
            liquidity_usd=5_400_000.0,
            market_cap_usd=1_450_000_000.0,
            fdv_usd=1_520_000_000.0,
            pair_created_at=datetime(2024, 1, 1, tzinfo=UTC),
            source_timestamp=datetime(2026, 3, 24, 12, 5, tzinfo=UTC),
            fetched_at=datetime(2026, 3, 24, 12, 5, tzinfo=UTC),
            http_status=200,
            latency_ms=55,
            retry_count=0,
            timeout_ms=3000,
            payload_hash="dex-plugin-hash",
            payload_excerpt=DexScreenerPayloadExcerpt(
                chainId=chain or "ethereum",
                pairAddress="0x-eth-best",
                dexId="uniswap",
                baseSymbol="AAVE",
                quoteSymbol="USDC",
                liquidityUsd=5_400_000.0,
                volume24hUsd=12_800_000.0,
            ),
        )

    monkeypatch.setattr(
        brief_adapters,
        "fetch_dexscreener_market_snapshot",
        _fake_dexscreener,
    )
    payload = ProtocolFundamentalBriefRequest.model_validate(
        {"protocol": "Aave", "chain": "ethereum"}
    )

    observation = asyncio.run(brief_plugins.list_protocol_source_plugins()[1].fetch(payload))

    assert observation.source_name == "dexscreener_market"
    assert observation.supports("price_context") is True
    assert observation.supports("risk_context") is True
    assert observation.pair_address == "0x-eth-best"
    assert observation.spot_price_usd == pytest.approx(96.2)