from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from time import perf_counter
from typing import Literal

from app.core.config import get_settings
from app.core.log_config import logger
from app.schemas.sentiment import EmptyPayloadExcerpt, ErrorRecord, RawFeedRecord
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
REFRESH_REASON_REQUEST = "request"
REFRESH_REASON_SCHEDULER = "scheduler"
FRESHNESS_STATE_FRESH = "fresh"
FRESHNESS_STATE_STALE = "stale-but-servable"
FRESHNESS_STATE_EXPIRED = "expired"
SOURCE_FRESHNESS = {
    "alternative_me": 1800,
    "coingecko": 45,
    "binance_market_data": 8,
}


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

_snapshot_cache: dict[tuple[str, str, int, bool], SentimentResponse] = {}
_in_flight_async_repairs: set[str] = set()
_background_repair_tasks: set[asyncio.Task[None]] = set()
UTC_OFFSET_SUFFIX = "+00:00"
service_logger = logger.bind(component="sentiment_refresh")


def _error_code_value(error: object) -> str | None:
    if isinstance(error, ErrorRecord):
        return error.code
    if isinstance(error, dict):
        code = error.get("code")
        return str(code) if code is not None else None
    code = getattr(error, "code", None)
    return str(code) if code is not None else None


def _response_error_codes(response: SentimentResponse) -> list[str]:
    return [code for error in response.errors if (code := _error_code_value(error))]


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _to_zulu(value: datetime) -> str:
    return value.isoformat().replace(UTC_OFFSET_SUFFIX, "Z")


def _parse_zulu(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", UTC_OFFSET_SUFFIX))


def _snapshot_key(payload: SentimentRequest) -> str:
    chain_slug = payload.chain.replace("-", "_")
    narrative_flag = "narrative_on" if payload.include_narrative else "narrative_off"
    return f"{payload.symbol.lower()}__{chain_slug}__{payload.lookback_hours}h__{narrative_flag}"


def _freshness_windows() -> tuple[int, int, int]:
    settings = get_settings()
    fresh_ttl_s = max(0, settings.sentiment_scheduler_fresh_ttl_s)
    stale_ttl_s = max(fresh_ttl_s, settings.sentiment_scheduler_stale_ttl_s)
    hard_expire_s = max(stale_ttl_s, settings.sentiment_scheduler_hard_expire_s)
    return fresh_ttl_s, stale_ttl_s, hard_expire_s


def _snapshot_age(response: SentimentResponse, *, now: datetime | None = None) -> timedelta:
    current_time = now or _now_utc()
    generated_at = _parse_zulu(response.freshness.generated_at)
    age = current_time - generated_at
    if age < timedelta(0):
        return timedelta(0)
    return age


def _freshness_state(
    response: SentimentResponse, *, now: datetime | None = None
) -> Literal["fresh", "stale-but-servable", "expired"]:
    age_seconds = _snapshot_age(response, now=now).total_seconds()
    fresh_ttl_s, stale_ttl_s, _ = _freshness_windows()
    if age_seconds <= fresh_ttl_s:
        return FRESHNESS_STATE_FRESH
    if age_seconds <= stale_ttl_s:
        return FRESHNESS_STATE_STALE
    return FRESHNESS_STATE_EXPIRED


def _cache_hit_response(response: SentimentResponse) -> SentimentResponse:
    return response.model_copy(
        update={
            "freshness": response.freshness.model_copy(update={"cache_hit": True})
        }
    )


def _schedule_async_refresh(payload: SentimentRequest) -> None:
    snapshot_key = _snapshot_key(payload)
    if snapshot_key in _in_flight_async_repairs:
        return
    _in_flight_async_repairs.add(snapshot_key)

    async def _run() -> None:
        try:
            await refresh_sentiment_snapshot(payload, reason=REFRESH_REASON_REQUEST)
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "Asynchronous stale snapshot repair failed"
                f" | snapshot_key={snapshot_key}"
                f" | error={exc}"
            )
        finally:
            _in_flight_async_repairs.discard(snapshot_key)

    task = asyncio.create_task(_run(), name=f"sentiment-stale-repair:{snapshot_key}")
    _background_repair_tasks.add(task)
    task.add_done_callback(_background_repair_tasks.discard)


def _servable_snapshot_response(
    payload: SentimentRequest,
    response: SentimentResponse,
    *,
    now: datetime,
) -> SentimentResponse | None:
    state = _freshness_state(response, now=now)
    if state == FRESHNESS_STATE_EXPIRED:
        return None
    if state == FRESHNESS_STATE_STALE:
        _schedule_async_refresh(payload)
    return _cache_hit_response(response)


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
) -> RawFeedRecord:
    return RawFeedRecord(
        symbol=payload.symbol,
        chain=payload.chain,
        sourceName=source_name,
        success=False,
        fetchedAt=_to_zulu(_now_utc()),
        sourceTimestamp=None,
        latencyMs=None,
        retryCount=max(0, get_settings().sentiment_source_max_attempts - 1),
        timeoutMs=timeout_ms,
        httpStatus=None,
        payloadHash=None,
        payloadExcerpt=EmptyPayloadExcerpt(),
        errorCode=error_code,
        errorMessage=error_message,
    )


async def _fetch_live_sources(
    payload: SentimentRequest,
) -> tuple[
    sentiment_adapters.AlternativeMeSentimentSnapshot | None,
    sentiment_adapters.CoinGeckoMarketSnapshot | None,
    sentiment_adapters.BinanceMarketSnapshot | None,
    list[RawFeedRecord],
    list[ErrorRecord],
]:
    snapshot_key = _snapshot_key(payload)
    results = await asyncio.gather(
        sentiment_adapters.fetch_alternative_me_sentiment(),
        sentiment_adapters.fetch_coingecko_market_snapshot(payload.symbol),
        sentiment_adapters.fetch_binance_market_snapshot(payload.symbol),
        return_exceptions=True,
    )
    alternative_snapshot: sentiment_adapters.AlternativeMeSentimentSnapshot | None = None
    coingecko_snapshot: sentiment_adapters.CoinGeckoMarketSnapshot | None = None
    binance_snapshot: sentiment_adapters.BinanceMarketSnapshot | None = None
    raw_feed_records: list[RawFeedRecord] = []
    errors: list[ErrorRecord] = []
    settings = get_settings()

    alternative_result, coingecko_result, binance_result = results
    if isinstance(alternative_result, BaseException):
        service_logger.warning(
            "Sentiment source fetch failed"
            f" | snapshot_key={snapshot_key}"
            " | source=alternative_me"
            f" | error={alternative_result}"
        )
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
            RawFeedRecord(
                symbol=payload.symbol,
                chain=payload.chain,
                sourceName="alternative_me",
                success=True,
                fetchedAt=_to_zulu(alternative_snapshot.fetched_at),
                sourceTimestamp=_to_zulu(alternative_snapshot.source_timestamp),
                latencyMs=alternative_snapshot.latency_ms,
                retryCount=alternative_snapshot.retry_count,
                timeoutMs=alternative_snapshot.timeout_ms,
                httpStatus=alternative_snapshot.http_status,
                payloadHash=alternative_snapshot.payload_hash,
                freshnessSec=alternative_snapshot.freshness_sec,
                payloadExcerpt=alternative_snapshot.payload_excerpt,
                errorCode=None,
                errorMessage=None,
            )
        )

    if isinstance(coingecko_result, BaseException):
        service_logger.warning(
            "Sentiment source fetch failed"
            f" | snapshot_key={snapshot_key}"
            " | source=coingecko"
            f" | symbol={payload.symbol}"
            f" | error={coingecko_result}"
        )
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
            RawFeedRecord(
                symbol=payload.symbol,
                chain=payload.chain,
                sourceName="coingecko",
                success=True,
                fetchedAt=_to_zulu(coingecko_snapshot.fetched_at),
                sourceTimestamp=_to_zulu(coingecko_snapshot.source_timestamp),
                latencyMs=coingecko_snapshot.latency_ms,
                retryCount=coingecko_snapshot.retry_count,
                timeoutMs=coingecko_snapshot.timeout_ms,
                httpStatus=coingecko_snapshot.http_status,
                payloadHash=coingecko_snapshot.payload_hash,
                freshnessSec=coingecko_snapshot.freshness_sec,
                payloadExcerpt=coingecko_snapshot.payload_excerpt,
                errorCode=None,
                errorMessage=None,
            )
        )

    if isinstance(binance_result, BaseException):
        service_logger.warning(
            "Sentiment source fetch failed"
            f" | snapshot_key={snapshot_key}"
            " | source=binance_market_data"
            f" | symbol={payload.symbol}"
            f" | error={binance_result}"
        )
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
            RawFeedRecord(
                symbol=payload.symbol,
                chain=payload.chain,
                sourceName="binance_market_data",
                success=True,
                fetchedAt=_to_zulu(binance_snapshot.fetched_at),
                sourceTimestamp=_to_zulu(binance_snapshot.source_timestamp),
                latencyMs=binance_snapshot.latency_ms,
                retryCount=binance_snapshot.retry_count,
                timeoutMs=binance_snapshot.timeout_ms,
                httpStatus=binance_snapshot.http_status,
                payloadHash=binance_snapshot.payload_hash,
                freshnessSec=binance_snapshot.freshness_sec,
                payloadExcerpt=binance_snapshot.payload_excerpt,
                errorCode=None,
                errorMessage=None,
            )
        )

    successful_sources = [record.source_name for record in raw_feed_records if record.success]
    failed_sources = [record.source_name for record in raw_feed_records if not record.success]
    service_logger.info(
        "Sentiment live source collection finished"
        f" | snapshot_key={snapshot_key}"
        f" | symbol={payload.symbol}"
        f" | chain={payload.chain}"
        f" | successful_sources={successful_sources}"
        f" | failed_sources={failed_sources}"
        f" | source_count={len(successful_sources)}"
        f" | error_count={len(errors)}"
    )

    return (
        alternative_snapshot,
        coingecko_snapshot,
        binance_snapshot,
        raw_feed_records,
        errors,
    )


async def refresh_sentiment_snapshot(
    payload: SentimentRequest,
    *,
    reason: Literal["request", "scheduler"] = REFRESH_REASON_REQUEST,
) -> SentimentResponse:
    refresh_started_at = perf_counter()
    repository = get_sentiment_repository()
    cache_key = (
        payload.symbol,
        payload.chain,
        payload.lookback_hours,
        payload.include_narrative,
    )
    snapshot_key = _snapshot_key(payload)

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
                    message=(
                        "Returning the latest persisted sentiment snapshot "
                        f"because all live sources failed during {reason} refresh."
                    ),
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
            _snapshot_cache[cache_key] = fallback_response
            _log_refresh_result(
                snapshot_key=snapshot_key,
                payload=payload,
                response=fallback_response,
                reason=reason,
                duration_ms=int((perf_counter() - refresh_started_at) * 1000),
                fallback_used=True,
                live_successful_sources=[
                    record.source_name for record in raw_feed_records if record.success
                ],
                live_failed_sources=[
                    record.source_name for record in raw_feed_records if not record.success
                ],
            )
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
    _snapshot_cache[cache_key] = response
    _log_refresh_result(
        snapshot_key=snapshot_key,
        payload=payload,
        response=response,
        reason=reason,
        duration_ms=int((perf_counter() - refresh_started_at) * 1000),
        fallback_used=False,
        live_successful_sources=[
            record.source_name for record in raw_feed_records if record.success
        ],
        live_failed_sources=[
            record.source_name for record in raw_feed_records if not record.success
        ],
    )
    return response


def _log_refresh_result(
    *,
    snapshot_key: str,
    payload: SentimentRequest,
    response: SentimentResponse,
    reason: Literal["request", "scheduler"],
    duration_ms: int,
    fallback_used: bool,
    live_successful_sources: list[str],
    live_failed_sources: list[str],
) -> None:
    service_logger.info(
        "Sentiment refresh completed"
        f" | snapshot_key={snapshot_key}"
        f" | symbol={payload.symbol}"
        f" | chain={payload.chain}"
        f" | reason={reason}"
        f" | sentiment_score={response.result.sentiment_score}"
        f" | sentiment_label={response.result.sentiment_label}"
        f" | trend_direction={response.result.trend_direction}"
        f" | volatility_signal={response.result.volatility_signal}"
        f" | source_names={[source.name for source in response.sources]}"
        f" | live_successful_sources={live_successful_sources}"
        f" | live_failed_sources={live_failed_sources}"
        f" | fallback_used={fallback_used}"
        f" | error_codes={_response_error_codes(response)}"
        f" | duration_ms={duration_ms}"
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
    cache_key = (
        payload.symbol,
        payload.chain,
        payload.lookback_hours,
        payload.include_narrative,
    )
    snapshot_key = _snapshot_key(payload)
    repository = get_sentiment_repository()
    cached = _snapshot_cache.get(cache_key)
    now = _now_utc()
    if cached is not None:
        cached_response = _servable_snapshot_response(payload, cached, now=now)
        if cached_response is not None:
            return cached_response
        _snapshot_cache.pop(cache_key, None)

    stored_snapshot = repository.load_snapshot(snapshot_key)
    if stored_snapshot is not None:
        _snapshot_cache[cache_key] = stored_snapshot
        stored_response = _servable_snapshot_response(payload, stored_snapshot, now=now)
        if stored_response is not None:
            return stored_response
    return await refresh_sentiment_snapshot(payload, reason=REFRESH_REASON_REQUEST)
