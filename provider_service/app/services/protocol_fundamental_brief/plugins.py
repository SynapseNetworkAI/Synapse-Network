from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable

from app.core.config import get_settings
from app.schemas.protocol_fundamental_brief import ProtocolFundamentalBriefRequest
from app.services.protocol_fundamental_brief import adapters as brief_adapters
from app.services.protocol_fundamental_brief.domain import (
    ChainTvlSlice,
    DefiLlamaProtocolObservation,
    DexScreenerMarketObservation,
    ProtocolBriefObservation,
    ProtocolCapability,
)


@dataclass(frozen=True)
class ProtocolSourcePlugin:
    source_name: str
    display_name: str
    capabilities: tuple[ProtocolCapability, ...]
    error_code: str
    error_message_prefix: str
    timeout_ms_factory: Callable[[], int]
    fetch: Callable[[ProtocolFundamentalBriefRequest], Awaitable[ProtocolBriefObservation]]

    def timeout_ms(self) -> int:
        return self.timeout_ms_factory()


def _settings_timeout_ms(value: float) -> int:
    return int(value * 1000)


def _to_zulu(value) -> str:
    return value.isoformat().replace("+00:00", "Z")


async def _fetch_defillama_observation(
    payload: ProtocolFundamentalBriefRequest,
) -> DefiLlamaProtocolObservation:
    snapshot = await brief_adapters.fetch_defillama_protocol_snapshot(payload.protocol)
    return DefiLlamaProtocolObservation(
        freshness_sec=snapshot.freshness_sec,
        source_timestamp=_to_zulu(snapshot.source_timestamp),
        fetched_at=_to_zulu(snapshot.fetched_at),
        latency_ms=snapshot.latency_ms,
        retry_count=snapshot.retry_count,
        timeout_ms=snapshot.timeout_ms,
        http_status=snapshot.http_status,
        payload_hash=snapshot.payload_hash,
        protocol_slug=snapshot.protocol_slug,
        protocol_display_name=snapshot.display_name,
        protocol_symbol=snapshot.protocol_symbol,
        category=snapshot.category,
        supported_chains=snapshot.supported_chains,
        chain_tvl_breakdown=tuple(
            ChainTvlSlice(chain=chain_name, tvl_usd=tvl_usd)
            for chain_name, tvl_usd in snapshot.chain_tvl_breakdown.items()
        ),
        tvl_usd_current=snapshot.tvl_usd_current,
        tvl_change_1d_pct=snapshot.tvl_change_1d_pct,
        tvl_change_7d_pct=snapshot.tvl_change_7d_pct,
        tvl_change_30d_pct=snapshot.tvl_change_30d_pct,
        fees_24h_usd=snapshot.fees_24h_usd,
        fees_7d_usd=snapshot.fees_7d_usd,
        fees_30d_usd=snapshot.fees_30d_usd,
        revenue_24h_usd=snapshot.revenue_24h_usd,
        revenue_7d_usd=snapshot.revenue_7d_usd,
        revenue_30d_usd=snapshot.revenue_30d_usd,
        excerpt=snapshot.payload_excerpt,
    )


async def _fetch_dexscreener_observation(
    payload: ProtocolFundamentalBriefRequest,
) -> DexScreenerMarketObservation:
    snapshot = await brief_adapters.fetch_dexscreener_market_snapshot(
        payload.protocol,
        chain=payload.chain,
    )
    return DexScreenerMarketObservation(
        freshness_sec=snapshot.freshness_sec,
        source_timestamp=_to_zulu(snapshot.source_timestamp),
        fetched_at=_to_zulu(snapshot.fetched_at),
        latency_ms=snapshot.latency_ms,
        retry_count=snapshot.retry_count,
        timeout_ms=snapshot.timeout_ms,
        http_status=snapshot.http_status,
        payload_hash=snapshot.payload_hash,
        chain_id=snapshot.chain_id,
        pair_address=snapshot.pair_address,
        dex_id=snapshot.dex_id,
        base_token_symbol=snapshot.base_token_symbol,
        quote_token_symbol=snapshot.quote_token_symbol,
        labels=snapshot.labels,
        spot_price_usd=snapshot.spot_price_usd,
        price_change_5m_pct=snapshot.price_change_5m_pct,
        price_change_1h_pct=snapshot.price_change_1h_pct,
        price_change_6h_pct=snapshot.price_change_6h_pct,
        price_change_24h_pct=snapshot.price_change_24h_pct,
        volume_24h_usd=snapshot.volume_24h_usd,
        buy_txn_24h=snapshot.buy_txn_24h,
        sell_txn_24h=snapshot.sell_txn_24h,
        liquidity_usd=snapshot.liquidity_usd,
        market_cap_usd=snapshot.market_cap_usd,
        fdv_usd=snapshot.fdv_usd,
        pair_age_days=snapshot.pair_age_days,
        excerpt=snapshot.payload_excerpt,
    )


def list_protocol_source_plugins() -> tuple[ProtocolSourcePlugin, ...]:
    settings = get_settings()
    return (
        ProtocolSourcePlugin(
            source_name="defillama_protocol",
            display_name="DefiLlama",
            capabilities=(
                "protocol_identity",
                "tvl_context",
                "revenue_activity_context",
                "risk_context",
            ),
            error_code="DEFILLAMA_PROTOCOL_UNAVAILABLE",
            error_message_prefix="DefiLlama protocol feed unavailable",
            timeout_ms_factory=lambda: _settings_timeout_ms(settings.defillama_timeout_s),
            fetch=_fetch_defillama_observation,
        ),
        ProtocolSourcePlugin(
            source_name="dexscreener_market",
            display_name="DexScreener",
            capabilities=("price_context", "revenue_activity_context", "risk_context"),
            error_code="DEXSCREENER_MARKET_UNAVAILABLE",
            error_message_prefix="DexScreener market feed unavailable",
            timeout_ms_factory=lambda: _settings_timeout_ms(settings.dexscreener_timeout_s),
            fetch=_fetch_dexscreener_observation,
        ),
    )