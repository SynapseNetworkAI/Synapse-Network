# pyright: reportMissingImports=false

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.schemas.protocol_fundamental_brief import ProtocolFundamentalBriefRequest  # noqa: E402
from app.services.protocol_fundamental_brief.aggregator import (  # noqa: E402
    build_structured_brief_result,
)
from app.services.protocol_fundamental_brief.aliases import normalize_protocol_query  # noqa: E402
from app.services.protocol_fundamental_brief.domain import (  # noqa: E402
    ChainTvlSlice,
    DefiLlamaProtocolObservation,
    DexScreenerMarketObservation,
)


def _defillama_observation(
    *,
    protocol_display_name: str,
    tvl_usd_current: float,
    tvl_change_7d_pct: float,
    tvl_change_30d_pct: float,
    revenue_30d_usd: float,
) -> DefiLlamaProtocolObservation:
    return DefiLlamaProtocolObservation(
        freshness_sec=120,
        source_timestamp="2026-03-24T12:00:00Z",
        fetched_at="2026-03-24T12:01:00Z",
        latency_ms=50,
        retry_count=0,
        timeout_ms=3000,
        http_status=200,
        payload_hash=f"{protocol_display_name}-hash",
        protocol_slug=protocol_display_name.lower(),
        protocol_display_name=protocol_display_name,
        protocol_symbol=protocol_display_name[:4].upper(),
        category="Lending",
        supported_chains=("ethereum", "arbitrum"),
        chain_tvl_breakdown=(
            ChainTvlSlice(chain="Ethereum", tvl_usd=tvl_usd_current * 0.62),
            ChainTvlSlice(chain="Arbitrum", tvl_usd=tvl_usd_current * 0.38),
        ),
        tvl_usd_current=tvl_usd_current,
        tvl_change_1d_pct=0.5,
        tvl_change_7d_pct=tvl_change_7d_pct,
        tvl_change_30d_pct=tvl_change_30d_pct,
        fees_24h_usd=120_000.0,
        fees_7d_usd=840_000.0,
        fees_30d_usd=3_300_000.0,
        revenue_24h_usd=60_000.0,
        revenue_7d_usd=420_000.0,
        revenue_30d_usd=revenue_30d_usd,
        excerpt={
            "protocolSlug": protocol_display_name.lower(),
            "displayName": protocol_display_name,
            "category": "Lending",
            "tvlUsd": tvl_usd_current,
            "chainCount": 2,
            "fees24hUsd": 120_000.0,
            "revenue24hUsd": 60_000.0,
        },
    )


def _market_observation() -> DexScreenerMarketObservation:
    return DexScreenerMarketObservation(
        freshness_sec=30,
        source_timestamp="2026-03-24T12:00:30Z",
        fetched_at="2026-03-24T12:01:00Z",
        latency_ms=40,
        retry_count=0,
        timeout_ms=3000,
        http_status=200,
        payload_hash="dex-hash",
        chain_id="ethereum",
        pair_address="0xpair",
        dex_id="uniswap",
        base_token_symbol="AAVE",
        quote_token_symbol="USDC",
        labels=("bluechip",),
        spot_price_usd=96.2,
        price_change_5m_pct=0.2,
        price_change_1h_pct=0.7,
        price_change_6h_pct=1.8,
        price_change_24h_pct=4.3,
        volume_24h_usd=12_800_000.0,
        buy_txn_24h=1812,
        sell_txn_24h=1654,
        liquidity_usd=5_400_000.0,
        market_cap_usd=1_500_000_000.0,
        fdv_usd=1_700_000_000.0,
        pair_age_days=240,
        excerpt={
            "chainId": "ethereum",
            "pairAddress": "0xpair",
            "dexId": "uniswap",
            "baseSymbol": "AAVE",
            "quoteSymbol": "USDC",
            "liquidityUsd": 5_400_000.0,
            "volume24hUsd": 12_800_000.0,
        },
    )


def test_normalize_protocol_query_handles_common_aliases():
    assert normalize_protocol_query("aave protocol") == "Aave"
    assert normalize_protocol_query("uni") == "Uniswap"
    assert normalize_protocol_query("Lido Finance") == "Lido"


def test_build_structured_brief_result_generates_peer_comparison_and_operator_view():
    payload = ProtocolFundamentalBriefRequest.model_validate(
        {
            "protocol": "Aave",
            "chain": "ethereum",
            "peer_set": ["Compound", "Morpho"],
            "lookback_days": 30,
        }
    )
    result = build_structured_brief_result(
        payload,
        observations=(
            _defillama_observation(
                protocol_display_name="Aave",
                tvl_usd_current=5_200_000_000.0,
                tvl_change_7d_pct=2.2,
                tvl_change_30d_pct=6.3,
                revenue_30d_usd=1_800_000.0,
            ),
            _market_observation(),
        ),
        errors=[],
        peer_observations=(
            _defillama_observation(
                protocol_display_name="Compound",
                tvl_usd_current=2_100_000_000.0,
                tvl_change_7d_pct=0.6,
                tvl_change_30d_pct=1.4,
                revenue_30d_usd=900_000.0,
            ),
            _defillama_observation(
                protocol_display_name="Morpho",
                tvl_usd_current=1_600_000_000.0,
                tvl_change_7d_pct=1.1,
                tvl_change_30d_pct=2.1,
                revenue_30d_usd=650_000.0,
            ),
        ),
    )

    assert result.protocol == "Aave"
    assert "price context is positive" in result.price_summary
    assert "TVL is slightly expanding" in result.tvl_summary
    assert any("selected peer median" in item for item in result.peer_comparison)
    assert "screening brief" in result.operator_view