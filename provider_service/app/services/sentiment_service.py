from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal
from typing import Any

from app.core.config import get_settings
from app.schemas.sentiment import ErrorRecord
from app.services.sentiment import adapters as sentiment_adapters
from app.services.sentiment.repository import get_sentiment_repository
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
UTC_OFFSET_SUFFIX = "+00:00"


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _to_zulu(value: datetime) -> str:
    return value.isoformat().replace(UTC_OFFSET_SUFFIX, "Z")


def _snapshot_key(payload: SentimentRequest) -> str:
    chain_slug = payload.chain.replace("-", "_")
    narrative_flag = "narrative_on" if payload.include_narrative else "narrative_off"
    return f"{payload.symbol.lower()}__{chain_slug}__{payload.lookback_hours}h__{narrative_flag}"


def _score_to_label(
    score: int,
) -> Literal["extreme_fear", "fear", "neutral", "greed", "extreme_greed"]:
    if score >= 81:
        return "extreme_greed"
    if score >= 61:
        return "greed"
    if score >= 41:
        return "neutral"
    if score >= 21:
        return "fear"
    return "extreme_fear"


def _live_momentum_adjustment(change_24h_pct: float) -> int:
    if change_24h_pct >= 10:
        return 9
    if change_24h_pct >= 5:
        return 6
    if change_24h_pct >= 2:
        return 3
    if change_24h_pct <= -10:
        return -10
    if change_24h_pct <= -5:
        return -7
    if change_24h_pct <= -2:
        return -4
    return 0


def _volume_heat_adjustment(volume_24h_usd: float) -> int:
    if volume_24h_usd >= 25_000_000_000:
        return 4
    if volume_24h_usd >= 10_000_000_000:
        return 2
    if volume_24h_usd >= 2_000_000_000:
        return 1
    return 0


def _volatility_penalty(realized_volatility_pct: float) -> int:
    if realized_volatility_pct >= 2.5:
        return 8
    if realized_volatility_pct >= 1.5:
        return 5
    if realized_volatility_pct >= 0.8:
        return 2
    return 0


def _trend_direction_from_market(
    change_24h_pct: float, lookback_hours: int
) -> Literal["up", "down", "sideways"]:
    threshold = 1.0 if lookback_hours <= 24 else 2.0
    if change_24h_pct >= threshold:
        return "up"
    if change_24h_pct <= -threshold:
        return "down"
    return "sideways"


def _volatility_signal_from_market(
    realized_volatility_pct: float,
) -> Literal["low", "medium", "high"]:
    if realized_volatility_pct >= 2.5:
        return "high"
    if realized_volatility_pct >= 1.0:
        return "medium"
    return "low"


def _market_temperature(score: int, volatility_signal: str) -> str:
    if score >= 75 and volatility_signal == "high":
        return "risk-on and overheated"
    if score >= 60:
        return "risk-on but not overheated"
    if score >= 45:
        return "balanced with selective risk appetite"
    if volatility_signal == "high":
        return "defensive and unstable"
    return "risk-off with cautious positioning"


def _action_hint(score: int, volatility_signal: str) -> str:
    if score >= 70 and volatility_signal != "high":
        return "Momentum agents can stay active, but entries should still be gated by fresh price confirmation."
    if score >= 55:
        return "Trend-following is acceptable, but keep tighter invalidation and lower leverage than in a one-sided breakout market."
    if volatility_signal == "high":
        return "Use defensive sizing or avoid fresh exposure until the feed stabilizes."
    return "Prefer defensive or mean-reversion strategies until momentum and breadth improve."


def _trend_direction(
    profile: SymbolProfile, lookback_hours: int
) -> Literal["up", "down", "sideways"]:
    if profile.trend_bias >= 9 and lookback_hours <= 72:
        return "up"
    if profile.trend_bias <= -5:
        return "down"
    return "sideways"


def _volatility_signal(
    profile: SymbolProfile, lookback_hours: int
) -> Literal["low", "medium", "high"]:
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
    *,
    alternative_snapshot: sentiment_adapters.AlternativeMeSentimentSnapshot | None,
    coingecko_snapshot: sentiment_adapters.CoinGeckoMarketSnapshot | None,
    binance_snapshot: sentiment_adapters.BinanceMarketSnapshot | None,
) -> list[str]:
    bullets: list[str] = []
    if alternative_snapshot is not None:
        bullets.append(
            f"Alternative.me baseline is {alternative_snapshot.value}/100 with '{alternative_snapshot.classification}' risk appetite."
        )
    else:
        bullets.append(
            f"{payload.symbol} currently falls back to the provider's internal baseline model because the market baseline feed is unavailable."
        )
    if coingecko_snapshot is not None:
        bullets.append(
            f"CoinGecko shows {payload.symbol} at ${coingecko_snapshot.price_usd:,.2f} with {coingecko_snapshot.change_24h_pct:.2f}% 24h change."
        )
    else:
        bullets.append(
            f"Trend direction is {trend_direction} using fallback rules because token-level live market data is unavailable."
        )
    if binance_snapshot is not None and payload.include_narrative:
        bullets.append(
            f"Binance 5m kline realized volatility is {binance_snapshot.realized_volatility_pct:.2f}% with {binance_snapshot.quote_volume_usd:,.0f} quote volume over the 24h ticker window."
        )
    if payload.include_narrative:
        bullets.extend(
            [
                f"Volatility is {volatility_signal}, which changes how aggressively agents should size entries.",
                f"Chain scope '{payload.chain}' adds contextual bias instead of replacing market-wide sentiment.",
            ]
        )
    return bullets[:5]


def _error_raw_feed_record(
    *,
    payload: SentimentRequest,
    source_name: str,
    error_code: str,
    error_message: str,
    timeout_ms: int,
) -> dict[str, Any]:
    return {
        "symbol": payload.symbol,
        "chain": payload.chain,
        "sourceName": source_name,
        "success": False,
        "fetchedAt": _to_zulu(_now_utc()),
        "sourceTimestamp": None,
        "latencyMs": None,
        "retryCount": max(0, get_settings().sentiment_source_max_attempts - 1),
        "timeoutMs": timeout_ms,
        "httpStatus": None,
        "payloadHash": None,
        "payloadExcerpt": {},
        "errorCode": error_code,
        "errorMessage": error_message,
    }


async def _fetch_live_sources(
    payload: SentimentRequest,
) -> tuple[
    sentiment_adapters.AlternativeMeSentimentSnapshot | None,
    sentiment_adapters.CoinGeckoMarketSnapshot | None,
    sentiment_adapters.BinanceMarketSnapshot | None,
    list[dict[str, Any]],
    list[ErrorRecord],
]:
    results = await asyncio.gather(
        sentiment_adapters.fetch_alternative_me_sentiment(),
        sentiment_adapters.fetch_coingecko_market_snapshot(payload.symbol),
        sentiment_adapters.fetch_binance_market_snapshot(payload.symbol),
        return_exceptions=True,
    )
    alternative_snapshot: sentiment_adapters.AlternativeMeSentimentSnapshot | None = None
    coingecko_snapshot: sentiment_adapters.CoinGeckoMarketSnapshot | None = None
    binance_snapshot: sentiment_adapters.BinanceMarketSnapshot | None = None
    raw_feed_records: list[dict[str, Any]] = []
    errors: list[ErrorRecord] = []
    settings = get_settings()

    alternative_result, coingecko_result, binance_result = results
    if isinstance(alternative_result, BaseException):
        raw_feed_records.append(
            _error_raw_feed_record(
                payload=payload,
                source_name="alternative_me",
                error_code="ALTERNATIVE_ME_UNAVAILABLE",
                error_message=str(alternative_result),
                timeout_ms=int(settings.alternative_me_timeout_s * 1000),
            )
        )
        errors.append(
            ErrorRecord(
                code="ALTERNATIVE_ME_UNAVAILABLE",
                message=f"Alternative.me feed unavailable: {alternative_result}",
            )
        )
    else:
        alternative_snapshot = alternative_result
        raw_feed_records.append(
            {
                "symbol": payload.symbol,
                "chain": payload.chain,
                "sourceName": "alternative_me",
                "success": True,
                "fetchedAt": _to_zulu(alternative_snapshot.fetched_at),
                "sourceTimestamp": _to_zulu(alternative_snapshot.source_timestamp),
                "latencyMs": alternative_snapshot.latency_ms,
                "retryCount": alternative_snapshot.retry_count,
                "timeoutMs": alternative_snapshot.timeout_ms,
                "httpStatus": alternative_snapshot.http_status,
                "payloadHash": alternative_snapshot.payload_hash,
                "freshnessSec": alternative_snapshot.freshness_sec,
                "payloadExcerpt": alternative_snapshot.payload_excerpt,
                "errorCode": None,
                "errorMessage": None,
            }
        )

    if isinstance(coingecko_result, BaseException):
        raw_feed_records.append(
            _error_raw_feed_record(
                payload=payload,
                source_name="coingecko",
                error_code="COINGECKO_UNAVAILABLE",
                error_message=str(coingecko_result),
                timeout_ms=int(settings.coingecko_timeout_s * 1000),
            )
        )
        errors.append(
            ErrorRecord(
                code="COINGECKO_UNAVAILABLE",
                message=f"CoinGecko feed unavailable: {coingecko_result}",
            )
        )
    else:
        coingecko_snapshot = coingecko_result
        raw_feed_records.append(
            {
                "symbol": payload.symbol,
                "chain": payload.chain,
                "sourceName": "coingecko",
                "success": True,
                "fetchedAt": _to_zulu(coingecko_snapshot.fetched_at),
                "sourceTimestamp": _to_zulu(coingecko_snapshot.source_timestamp),
                "latencyMs": coingecko_snapshot.latency_ms,
                "retryCount": coingecko_snapshot.retry_count,
                "timeoutMs": coingecko_snapshot.timeout_ms,
                "httpStatus": coingecko_snapshot.http_status,
                "payloadHash": coingecko_snapshot.payload_hash,
                "freshnessSec": coingecko_snapshot.freshness_sec,
                "payloadExcerpt": coingecko_snapshot.payload_excerpt,
                "errorCode": None,
                "errorMessage": None,
            }
        )

    if isinstance(binance_result, BaseException):
        raw_feed_records.append(
            _error_raw_feed_record(
                payload=payload,
                source_name="binance_market_data",
                error_code="BINANCE_UNAVAILABLE",
                error_message=str(binance_result),
                timeout_ms=int(settings.binance_timeout_s * 1000),
            )
        )
        errors.append(
            ErrorRecord(
                code="BINANCE_UNAVAILABLE",
                message=f"Binance market feed unavailable: {binance_result}",
            )
        )
    else:
        binance_snapshot = binance_result
        raw_feed_records.append(
            {
                "symbol": payload.symbol,
                "chain": payload.chain,
                "sourceName": "binance_market_data",
                "success": True,
                "fetchedAt": _to_zulu(binance_snapshot.fetched_at),
                "sourceTimestamp": _to_zulu(binance_snapshot.source_timestamp),
                "latencyMs": binance_snapshot.latency_ms,
                "retryCount": binance_snapshot.retry_count,
                "timeoutMs": binance_snapshot.timeout_ms,
                "httpStatus": binance_snapshot.http_status,
                "payloadHash": binance_snapshot.payload_hash,
                "freshnessSec": binance_snapshot.freshness_sec,
                "payloadExcerpt": binance_snapshot.payload_excerpt,
                "errorCode": None,
                "errorMessage": None,
            }
        )

    return (
        alternative_snapshot,
        coingecko_snapshot,
        binance_snapshot,
        raw_feed_records,
        errors,
    )


def _build_response(
    payload: SentimentRequest,
    *,
    cache_hit: bool,
    alternative_snapshot: sentiment_adapters.AlternativeMeSentimentSnapshot | None,
    coingecko_snapshot: sentiment_adapters.CoinGeckoMarketSnapshot | None,
    binance_snapshot: sentiment_adapters.BinanceMarketSnapshot | None,
    errors: list[ErrorRecord],
) -> SentimentResponse:
    profile = SYMBOL_PROFILES[payload.symbol]
    lookback_penalty = min(8, max(0, (payload.lookback_hours - 24) // 24))
    baseline_score = (
        alternative_snapshot.value if alternative_snapshot is not None else profile.baseline_score
    )
    momentum_adjustment = 0
    if coingecko_snapshot is not None:
        momentum_adjustment = _live_momentum_adjustment(
            coingecko_snapshot.change_24h_pct
        )
    elif binance_snapshot is not None:
        momentum_adjustment = _live_momentum_adjustment(
            binance_snapshot.price_change_pct
        )

    volume_heat_adjustment = 0
    if coingecko_snapshot is not None:
        volume_heat_adjustment = _volume_heat_adjustment(
            coingecko_snapshot.volume_24h_usd
        )
    elif binance_snapshot is not None:
        volume_heat_adjustment = _volume_heat_adjustment(
            binance_snapshot.quote_volume_usd
        )

    volatility_penalty = (
        _volatility_penalty(binance_snapshot.realized_volatility_pct)
        if binance_snapshot is not None
        else 0
    )
    score = max(
        0,
        min(
            100,
            baseline_score
            + momentum_adjustment
            + volume_heat_adjustment
            + CHAIN_SCORE_ADJUSTMENTS[payload.chain]
            - volatility_penalty
            - lookback_penalty,
        ),
    )
    trend_direction = _trend_direction(profile, payload.lookback_hours)
    if coingecko_snapshot is not None:
        trend_direction = _trend_direction_from_market(
            coingecko_snapshot.change_24h_pct, payload.lookback_hours
        )
    elif binance_snapshot is not None:
        trend_direction = _trend_direction_from_market(
            binance_snapshot.price_change_pct, payload.lookback_hours
        )
    volatility_signal = (
        _volatility_signal_from_market(binance_snapshot.realized_volatility_pct)
        if binance_snapshot is not None
        else _volatility_signal(profile, payload.lookback_hours)
    )
    sources: list[SourceRecord] = []
    if alternative_snapshot is not None:
        sources.append(
            SourceRecord(
                name="alternative_me",
                freshnessSec=alternative_snapshot.freshness_sec,
            )
        )
    if coingecko_snapshot is not None:
        sources.append(
            SourceRecord(
                name="coingecko",
                freshnessSec=coingecko_snapshot.freshness_sec,
            )
        )
    if binance_snapshot is not None:
        sources.append(
            SourceRecord(
                name="binance_market_data",
                freshnessSec=binance_snapshot.freshness_sec,
            )
        )
    now = _now_utc()
    return SentimentResponse(
        service=ServiceDescriptor(
            serviceId=SERVICE_ID,
            serviceName=SERVICE_NAME,
            version=SERVICE_VERSION,
        ),
        sources=sources,
        freshness=FreshnessRecord(
            generatedAt=_to_zulu(now),
            maxSourceAgeSec=max((source.freshness_sec for source in sources), default=0),
            cacheHit=cache_hit,
        ),
        result=SentimentResult(
            symbol=payload.symbol,
            sentiment_score=score,
            sentiment_label=_score_to_label(score),
            trend_direction=trend_direction,
            volatility_signal=volatility_signal,
            market_temperature=_market_temperature(score, volatility_signal),
            reasoning_bullets=_build_reasoning_bullets(
                payload,
                trend_direction,
                volatility_signal,
                alternative_snapshot=alternative_snapshot,
                coingecko_snapshot=coingecko_snapshot,
                binance_snapshot=binance_snapshot,
            ),
            action_hint=_action_hint(score, volatility_signal),
        ),
        errors=errors,
    )


async def build_sentiment_snapshot(payload: SentimentRequest) -> SentimentResponse:
    repository = get_sentiment_repository()
    cache_key = (
        payload.symbol,
        payload.chain,
        payload.lookback_hours,
        payload.include_narrative,
    )
    snapshot_key = _snapshot_key(payload)
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

    (
        alternative_snapshot,
        coingecko_snapshot,
        binance_snapshot,
        raw_feed_records,
        errors,
    ) = await _fetch_live_sources(payload)

    if (
        alternative_snapshot is None
        and coingecko_snapshot is None
        and binance_snapshot is None
    ):
        stored_snapshot = repository.load_snapshot(snapshot_key)
        if stored_snapshot is not None:
            fallback_errors = [
                *stored_snapshot.errors,
                *errors,
                ErrorRecord(
                    code="SENTIMENT_SNAPSHOT_FALLBACK_USED",
                    message="Returning the latest persisted sentiment snapshot because all live sources failed.",
                ),
            ]
            fallback_response = stored_snapshot.model_copy(
                update={
                    "freshness": stored_snapshot.freshness.model_copy(
                        update={"cache_hit": True}
                    ),
                    "errors": fallback_errors,
                }
            )
            repository.append_raw_feed_records(snapshot_key, payload, raw_feed_records)
            _snapshot_cache[cache_key] = (now, fallback_response)
            return fallback_response

    response = _build_response(
        payload,
        cache_hit=False,
        alternative_snapshot=alternative_snapshot,
        coingecko_snapshot=coingecko_snapshot,
        binance_snapshot=binance_snapshot,
        errors=errors,
    )
    repository.save_snapshot(snapshot_key, payload, response)
    repository.append_raw_feed_records(snapshot_key, payload, raw_feed_records)
    _snapshot_cache[cache_key] = (now, response)
    return response
