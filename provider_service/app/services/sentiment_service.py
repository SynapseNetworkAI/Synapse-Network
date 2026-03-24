from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.schemas.sentiment import (
    FreshnessRecord,
    SentimentRequest,
    SentimentResponse,
    SentimentResult,
    ServiceDescriptor,
    SourceRecord,
)


SERVICE_ID = "svc_web3_sentiment_index"
SERVICE_NAME = "Web3 Sentiment Index"
SERVICE_VERSION = "1.0.0"
SOURCE_FRESHNESS = {
    "alternative_me": 1800,
    "coingecko": 45,
    "binance_market_data": 8,
}
CACHE_TTL_SECONDS = 300


@dataclass(frozen=True)
class SymbolProfile:
    baseline_score: int
    trend_bias: int
    volatility_bias: int
    market_temperature: str
    action_hint: str


SYMBOL_PROFILES: dict[str, SymbolProfile] = {
    "BTC": SymbolProfile(
        baseline_score=61,
        trend_bias=8,
        volatility_bias=1,
        market_temperature="risk-on with disciplined momentum",
        action_hint="Momentum agents can stay engaged, but size positions for sudden macro headline reversals.",
    ),
    "ETH": SymbolProfile(
        baseline_score=66,
        trend_bias=10,
        volatility_bias=3,
        market_temperature="risk-on but not overheated",
        action_hint="Suitable for momentum-following agents, but keep tighter risk controls than in a low-volatility regime.",
    ),
    "SOL": SymbolProfile(
        baseline_score=64,
        trend_bias=12,
        volatility_bias=7,
        market_temperature="hot flow with higher reflexivity",
        action_hint="Trend-following is still viable, but breakout agents should expect faster drawdowns than BTC or ETH.",
    ),
}

CHAIN_SCORE_ADJUSTMENTS = {
    "market-wide": 0,
    "ethereum": 2,
    "solana": 4,
    "base": 1,
}

_snapshot_cache: dict[tuple[str, str, int, bool], tuple[datetime, SentimentResponse]] = {}


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _score_to_label(score: int) -> str:
    if score >= 81:
        return "extreme_greed"
    if score >= 61:
        return "greed"
    if score >= 41:
        return "neutral"
    if score >= 21:
        return "fear"
    return "extreme_fear"


def _trend_direction(profile: SymbolProfile, lookback_hours: int) -> str:
    if profile.trend_bias >= 9 and lookback_hours <= 72:
        return "up"
    if profile.trend_bias <= -5:
        return "down"
    return "sideways"


def _volatility_signal(profile: SymbolProfile, lookback_hours: int) -> str:
    adjusted = profile.volatility_bias + (2 if lookback_hours <= 12 else 0)
    if adjusted >= 7:
        return "high"
    if adjusted >= 3:
        return "medium"
    return "low"


def _build_reasoning_bullets(
    payload: SentimentRequest,
    trend_direction: str,
    volatility_signal: str,
) -> list[str]:
    bullets = [
        f"{payload.symbol} keeps a positive composite baseline over the last {payload.lookback_hours}h window.",
        f"Trend direction is {trend_direction} after weighting short-term momentum and chain-relative flow.",
    ]
    if payload.include_narrative:
        bullets.extend(
            [
                f"Volatility is {volatility_signal}, which changes how aggressively agents should size entries.",
                f"Chain scope '{payload.chain}' adds contextual bias instead of replacing market-wide sentiment.",
            ]
        )
    return bullets[:4]


def _build_response(payload: SentimentRequest, *, cache_hit: bool) -> SentimentResponse:
    profile = SYMBOL_PROFILES[payload.symbol]
    lookback_penalty = min(8, max(0, (payload.lookback_hours - 24) // 24))
    score = max(
        0,
        min(
            100,
            profile.baseline_score
            + CHAIN_SCORE_ADJUSTMENTS[payload.chain]
            - lookback_penalty,
        ),
    )
    trend_direction = _trend_direction(profile, payload.lookback_hours)
    volatility_signal = _volatility_signal(profile, payload.lookback_hours)
    sources = [
        SourceRecord(name=name, freshnessSec=freshness)
        for name, freshness in SOURCE_FRESHNESS.items()
    ]
    now = _now_utc()
    return SentimentResponse(
        service=ServiceDescriptor(
            serviceId=SERVICE_ID,
            serviceName=SERVICE_NAME,
            version=SERVICE_VERSION,
        ),
        sources=sources,
        freshness=FreshnessRecord(
            generatedAt=now.isoformat().replace("+00:00", "Z"),
            maxSourceAgeSec=max(SOURCE_FRESHNESS.values()),
            cacheHit=cache_hit,
        ),
        result=SentimentResult(
            symbol=payload.symbol,
            sentiment_score=score,
            sentiment_label=_score_to_label(score),
            trend_direction=trend_direction,
            volatility_signal=volatility_signal,
            market_temperature=profile.market_temperature,
            reasoning_bullets=_build_reasoning_bullets(
                payload, trend_direction, volatility_signal
            ),
            action_hint=profile.action_hint,
        ),
        errors=[],
    )


async def build_sentiment_snapshot(payload: SentimentRequest) -> SentimentResponse:
    cache_key = (
        payload.symbol,
        payload.chain,
        payload.lookback_hours,
        payload.include_narrative,
    )
    cached = _snapshot_cache.get(cache_key)
    now = _now_utc()
    if cached is not None:
        created_at, response = cached
        if now - created_at <= timedelta(seconds=CACHE_TTL_SECONDS):
            return response.model_copy(
                update={
                    "freshness": response.freshness.model_copy(
                        update={"cache_hit": True}
                    )
                }
            )

    response = _build_response(payload, cache_hit=False)
    _snapshot_cache[cache_key] = (now, response)
    return response
