from __future__ import annotations

from dataclasses import dataclass
from statistics import median

from app.schemas.protocol_fundamental_brief import (
    ProtocolFundamentalBriefRequest,
    ProtocolFundamentalBriefResult,
)
from app.schemas.sentiment import ErrorRecord
from app.services.protocol_fundamental_brief.domain import (
    ChainTvlSlice,
    DefiLlamaProtocolObservation,
    DexScreenerMarketObservation,
    ProtocolBriefObservation,
)


@dataclass(frozen=True)
class StructuredBriefContext:
    protocol_name: str
    price_summary: str
    tvl_summary: str
    revenue_signals: list[str]
    peer_comparison: list[str]
    risk_flags: list[str]
    operator_view: str


def build_structured_brief(
    payload: ProtocolFundamentalBriefRequest,
    *,
    observations: tuple[ProtocolBriefObservation, ...],
    errors: list[ErrorRecord],
    peer_observations: tuple[DefiLlamaProtocolObservation, ...] = (),
) -> StructuredBriefContext:
    defillama_observation = _defillama_observation(observations)
    market_observation = _market_observation(observations)
    protocol_name = _protocol_name(payload, defillama_observation)
    price_summary = _price_summary(protocol_name, market_observation)
    tvl_summary = _tvl_summary(protocol_name, payload.chain, defillama_observation)
    revenue_signals = _revenue_signals(
        protocol_name,
        defillama_observation,
        market_observation,
    )
    peer_comparison = _peer_comparison(
        payload,
        protocol_name,
        defillama_observation,
        peer_observations,
    )
    risk_flags = _risk_flags(
        protocol_name,
        defillama_observation,
        market_observation,
        errors,
    )
    operator_view = _operator_view(
        protocol_name,
        defillama_observation,
        market_observation,
        errors,
    )
    return StructuredBriefContext(
        protocol_name=protocol_name,
        price_summary=price_summary,
        tvl_summary=tvl_summary,
        revenue_signals=revenue_signals[:5],
        peer_comparison=peer_comparison[:5],
        risk_flags=risk_flags[:5],
        operator_view=operator_view,
    )


def build_structured_brief_result(
    payload: ProtocolFundamentalBriefRequest,
    *,
    observations: tuple[ProtocolBriefObservation, ...],
    errors: list[ErrorRecord],
    peer_observations: tuple[DefiLlamaProtocolObservation, ...] = (),
) -> ProtocolFundamentalBriefResult:
    brief = build_structured_brief(
        payload,
        observations=observations,
        errors=errors,
        peer_observations=peer_observations,
    )
    return ProtocolFundamentalBriefResult(
        protocol=brief.protocol_name,
        price_summary=brief.price_summary,
        tvl_summary=brief.tvl_summary,
        revenue_signals=brief.revenue_signals,
        peer_comparison=brief.peer_comparison,
        risk_flags=brief.risk_flags,
        operator_view=brief.operator_view,
    )


def _defillama_observation(
    observations: tuple[ProtocolBriefObservation, ...],
) -> DefiLlamaProtocolObservation | None:
    for observation in observations:
        if isinstance(observation, DefiLlamaProtocolObservation):
            return observation
    return None


def _market_observation(
    observations: tuple[ProtocolBriefObservation, ...],
) -> DexScreenerMarketObservation | None:
    for observation in observations:
        if isinstance(observation, DexScreenerMarketObservation):
            return observation
    return None


def _protocol_name(
    payload: ProtocolFundamentalBriefRequest,
    defillama_observation: DefiLlamaProtocolObservation | None,
) -> str:
    if defillama_observation is not None and defillama_observation.protocol_display_name:
        return defillama_observation.protocol_display_name
    return payload.protocol


def _format_usd(value: float | None) -> str:
    if value is None:
        return "n/a"
    if value >= 1_000_000_000:
        return f"${value / 1_000_000_000:.2f}B"
    if value >= 1_000_000:
        return f"${value / 1_000_000:.2f}M"
    if value >= 1_000:
        return f"${value / 1_000:.2f}K"
    return f"${value:.2f}"


def _format_pct(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value:+.1f}%"


def _momentum_label(value: float | None) -> str:
    if value is None:
        return "mixed"
    if value >= 8:
        return "strongly positive"
    if value >= 2:
        return "positive"
    if value <= -8:
        return "strongly negative"
    if value <= -2:
        return "negative"
    return "mixed"


def _liquidity_label(liquidity_usd: float) -> str:
    if liquidity_usd >= 10_000_000:
        return "deep"
    if liquidity_usd >= 2_000_000:
        return "adequate"
    if liquidity_usd >= 500_000:
        return "thin"
    return "fragile"


def _tvl_trend_label(change_pct: float | None) -> str:
    if change_pct is None:
        return "stable to mixed"
    if change_pct >= 8:
        return "expanding"
    if change_pct >= 2:
        return "slightly expanding"
    if change_pct <= -12:
        return "contracting"
    if change_pct <= -3:
        return "softening"
    return "stable to mixed"


def _top_chain(chain_tvl_breakdown: tuple[ChainTvlSlice, ...]) -> tuple[str | None, float | None]:
    if not chain_tvl_breakdown:
        return None, None
    total_tvl = sum(max(slice_.tvl_usd, 0.0) for slice_ in chain_tvl_breakdown)
    if total_tvl <= 0:
        return None, None
    dominant_chain = max(chain_tvl_breakdown, key=lambda slice_: slice_.tvl_usd)
    return dominant_chain.chain, dominant_chain.tvl_usd / total_tvl


def _chain_scope_text(
    chain: str | None,
    defillama_observation: DefiLlamaProtocolObservation,
) -> str:
    dominant_chain, dominant_share = _top_chain(defillama_observation.chain_tvl_breakdown)
    if chain:
        chain_slice = next(
            (
                slice_
                for slice_ in defillama_observation.chain_tvl_breakdown
                if slice_.chain.lower() == chain.lower()
            ),
            None,
        )
        if chain_slice is not None and defillama_observation.tvl_usd_current:
            share = chain_slice.tvl_usd / defillama_observation.tvl_usd_current
            return f"requested chain {chain} contributes about {share:.0%} of tracked TVL"
        return f"requested chain {chain} is not isolated in the latest chain breakdown"
    if dominant_chain is None or dominant_share is None:
        return "cross-chain concentration is unavailable"
    if dominant_share >= 0.75:
        return f"TVL is concentrated on {dominant_chain} ({dominant_share:.0%} share)"
    return f"TVL is distributed across {max(len(defillama_observation.supported_chains), 1)} tracked chains"


def _price_summary(
    protocol_name: str,
    market_observation: DexScreenerMarketObservation | None,
) -> str:
    if market_observation is None:
        return (
            f"Price context is degraded for {protocol_name} because DexScreener market data is unavailable for this request."
        )
    turnover = (
        market_observation.volume_24h_usd / market_observation.liquidity_usd
        if market_observation.liquidity_usd > 0
        else None
    )
    turnover_text = "n/a" if turnover is None else f"{turnover:.2f}x"
    return (
        f"{protocol_name} price context is {_momentum_label(market_observation.price_change_24h_pct)} "
        f"on {market_observation.chain_id} via {market_observation.dex_id}: spot {_format_usd(market_observation.spot_price_usd)}, "
        f"24h change {_format_pct(market_observation.price_change_24h_pct)}, liquidity {_format_usd(market_observation.liquidity_usd)} "
        f"({ _liquidity_label(market_observation.liquidity_usd) } depth) and 24h volume {_format_usd(market_observation.volume_24h_usd)} "
        f"({turnover_text} turnover vs liquidity)."
    )


def _tvl_summary(
    protocol_name: str,
    chain: str | None,
    defillama_observation: DefiLlamaProtocolObservation | None,
) -> str:
    if defillama_observation is None:
        return (
            f"TVL context is degraded for {protocol_name} because DefiLlama protocol data is unavailable for this request."
        )
    reference_change = (
        defillama_observation.tvl_change_30d_pct
        if defillama_observation.tvl_change_30d_pct is not None
        else defillama_observation.tvl_change_7d_pct
    )
    return (
        f"{protocol_name} TVL is {_tvl_trend_label(reference_change)} at {_format_usd(defillama_observation.tvl_usd_current)}; "
        f"{_chain_scope_text(chain, defillama_observation)}; 7d {_format_pct(defillama_observation.tvl_change_7d_pct)} and "
        f"30d {_format_pct(defillama_observation.tvl_change_30d_pct)}."
    )


def _revenue_signals(
    protocol_name: str,
    defillama_observation: DefiLlamaProtocolObservation | None,
    market_observation: DexScreenerMarketObservation | None,
) -> list[str]:
    signals: list[str] = []
    if defillama_observation is not None:
        fees_anchor = (
            defillama_observation.fees_30d_usd
            if defillama_observation.fees_30d_usd is not None
            else defillama_observation.fees_24h_usd
        )
        revenue_anchor = (
            defillama_observation.revenue_30d_usd
            if defillama_observation.revenue_30d_usd is not None
            else defillama_observation.revenue_24h_usd
        )
        if fees_anchor is not None or revenue_anchor is not None:
            signals.append(
                f"DefiLlama fee coverage remains live for {protocol_name}: fees {_format_usd(fees_anchor)} and revenue {_format_usd(revenue_anchor)} in the latest available window."
            )
        else:
            signals.append(
                f"Direct fee and revenue coverage is partial for {protocol_name}, so the brief leans more on TVL and market activity proxies."
            )
    if market_observation is not None:
        total_txns = market_observation.buy_txn_24h + market_observation.sell_txn_24h
        turnover = (
            market_observation.volume_24h_usd / market_observation.liquidity_usd
            if market_observation.liquidity_usd > 0
            else None
        )
        turnover_text = "n/a" if turnover is None else f"{turnover:.2f}x"
        signals.append(
            f"Market activity proxy is active on DexScreener with {_format_usd(market_observation.volume_24h_usd)} 24h volume, {total_txns} 24h transactions and {turnover_text} turnover vs liquidity."
        )
    if not signals:
        signals.append(
            f"Revenue and activity coverage is degraded for {protocol_name} because both protocol-level and market-level sources are unavailable."
        )
    return signals


def _peer_comparison(
    payload: ProtocolFundamentalBriefRequest,
    protocol_name: str,
    defillama_observation: DefiLlamaProtocolObservation | None,
    peer_observations: tuple[DefiLlamaProtocolObservation, ...],
) -> list[str]:
    if not payload.peer_set:
        return []
    if defillama_observation is None or not peer_observations:
        return [
            f"Peer comparison is degraded for {protocol_name} because protocol-level peer data is unavailable for the selected peer set."
        ]

    comparisons: list[str] = []
    _append_peer_tvl_trend_comparison(comparisons, defillama_observation, peer_observations)
    _append_peer_tvl_scale_comparison(comparisons, defillama_observation, peer_observations)
    _append_peer_revenue_comparison(comparisons, defillama_observation, peer_observations)

    if not comparisons:
        peer_names = ", ".join(observation.protocol_display_name for observation in peer_observations)
        comparisons.append(
            f"Peer comparison resolved protocol identity for {peer_names}, but comparable 30d TVL or revenue metrics were incomplete in the latest window."
        )
    return comparisons


def _append_peer_tvl_trend_comparison(
    comparisons: list[str],
    defillama_observation: DefiLlamaProtocolObservation,
    peer_observations: tuple[DefiLlamaProtocolObservation, ...],
) -> None:
    peer_tvl_changes = [
        observation.tvl_change_30d_pct
        for observation in peer_observations
        if observation.tvl_change_30d_pct is not None
    ]
    if defillama_observation.tvl_change_30d_pct is None or not peer_tvl_changes:
        return
    peer_median_change = median(peer_tvl_changes)
    relation = "stronger" if defillama_observation.tvl_change_30d_pct >= peer_median_change else "weaker"
    comparisons.append(
        f"30d TVL trend is {relation} than the selected peer median ({_format_pct(defillama_observation.tvl_change_30d_pct)} vs {_format_pct(peer_median_change)})."
    )


def _append_peer_tvl_scale_comparison(
    comparisons: list[str],
    defillama_observation: DefiLlamaProtocolObservation,
    peer_observations: tuple[DefiLlamaProtocolObservation, ...],
) -> None:
    peer_tvls = [
        observation.tvl_usd_current
        for observation in peer_observations
        if observation.tvl_usd_current is not None
    ]
    if defillama_observation.tvl_usd_current is None or not peer_tvls:
        return
    peer_median_tvl = median(peer_tvls)
    relation = "above" if defillama_observation.tvl_usd_current >= peer_median_tvl else "below"
    comparisons.append(
        f"Current protocol scale sits {relation} the selected peer median on TVL ({_format_usd(defillama_observation.tvl_usd_current)} vs {_format_usd(peer_median_tvl)})."
    )


def _append_peer_revenue_comparison(
    comparisons: list[str],
    defillama_observation: DefiLlamaProtocolObservation,
    peer_observations: tuple[DefiLlamaProtocolObservation, ...],
) -> None:
    peer_revenue = [
        observation.revenue_30d_usd
        for observation in peer_observations
        if observation.revenue_30d_usd is not None
    ]
    if defillama_observation.revenue_30d_usd is None or not peer_revenue:
        return
    peer_median_revenue = median(peer_revenue)
    relation = "ahead of" if defillama_observation.revenue_30d_usd >= peer_median_revenue else "behind"
    comparisons.append(
        f"30d revenue run-rate is {relation} the selected peer median ({_format_usd(defillama_observation.revenue_30d_usd)} vs {_format_usd(peer_median_revenue)})."
    )


def _risk_flags(
    protocol_name: str,
    defillama_observation: DefiLlamaProtocolObservation | None,
    market_observation: DexScreenerMarketObservation | None,
    errors: list[ErrorRecord],
) -> list[str]:
    risk_flags: list[str] = []
    if defillama_observation is not None:
        dominant_chain, dominant_share = _top_chain(defillama_observation.chain_tvl_breakdown)
        if dominant_chain is not None and dominant_share is not None and dominant_share >= 0.75:
            risk_flags.append(
                f"TVL concentration risk is elevated because about {dominant_share:.0%} of tracked liquidity sits on {dominant_chain}."
            )
        if (
            defillama_observation.tvl_change_30d_pct is not None
            and defillama_observation.tvl_change_30d_pct <= -12
        ):
            risk_flags.append(
                f"TVL contraction risk is live because 30d TVL is down {_format_pct(defillama_observation.tvl_change_30d_pct)}."
            )
    if market_observation is not None:
        if market_observation.liquidity_usd < 1_000_000:
            risk_flags.append(
                f"Liquidity depth is shallow for the selected market pair at {_format_usd(market_observation.liquidity_usd)}."
            )
        if market_observation.pair_age_days is not None and market_observation.pair_age_days < 30:
            risk_flags.append(
                f"Selected trading pair is still young at {market_observation.pair_age_days} days, which raises market structure risk."
            )
    if errors:
        risk_flags.append(
            f"Upstream degradation is active for {protocol_name}: {', '.join(error.code for error in errors)}."
        )
    if not risk_flags:
        risk_flags.append(
            f"No acute liquidity or source-integrity risk flags were triggered for {protocol_name} in the latest observation window."
        )
    return risk_flags


def _operator_view(
    protocol_name: str,
    defillama_observation: DefiLlamaProtocolObservation | None,
    market_observation: DexScreenerMarketObservation | None,
    errors: list[ErrorRecord],
) -> str:
    if defillama_observation is None and market_observation is None:
        return (
            f"Live brief generation is degraded for {protocol_name}; rely on cached context or retry before using this object for research screening."
        )

    positive_signals = _positive_signal_count(defillama_observation, market_observation)
    caution_signals = _caution_signal_count(
        defillama_observation,
        market_observation,
        errors,
    )

    if positive_signals >= 2 and caution_signals == 0:
        return (
            f"Useful as a fast screening brief for {protocol_name}; live protocol and market signals are broadly constructive before deeper due diligence."
        )
    if caution_signals >= 2:
        return (
            f"Screen {protocol_name} with caution; weakening live signals or degraded sources suggest deeper diligence before treating this as a strong candidate."
        )
    return (
        f"{protocol_name} shows mixed live signals; this brief is suitable for triage, but the next research step should verify source quality and protocol-specific context."
    )


def _positive_signal_count(
    defillama_observation: DefiLlamaProtocolObservation | None,
    market_observation: DexScreenerMarketObservation | None,
) -> int:
    positive_signals = 0
    if defillama_observation is not None and (defillama_observation.tvl_change_30d_pct or 0) > 0:
        positive_signals += 1
    if market_observation is not None and (market_observation.price_change_24h_pct or 0) > 0:
        positive_signals += 1
    return positive_signals


def _caution_signal_count(
    defillama_observation: DefiLlamaProtocolObservation | None,
    market_observation: DexScreenerMarketObservation | None,
    errors: list[ErrorRecord],
) -> int:
    caution_signals = len(errors)
    if market_observation is not None and market_observation.liquidity_usd < 1_000_000:
        caution_signals += 1
    if defillama_observation is not None and (defillama_observation.tvl_change_30d_pct or 0) <= -12:
        caution_signals += 1
    return caution_signals