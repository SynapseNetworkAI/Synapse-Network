from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from time import perf_counter
from typing import Literal

from app.core.config import get_settings
from app.core.log_config import logger
from app.schemas.sentiment import EmptyPayloadExcerpt, ErrorRecord, RawFeedRecord
from app.services.sentiment import plugins as sentiment_plugins
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
_in_flight_refresh_tasks: dict[str, asyncio.Task[SentimentResponse]] = {}
UTC_OFFSET_SUFFIX = "+00:00"
service_logger = logger.bind(component="sentiment_refresh")


def _supported_live_source_names() -> frozenset[str]:
    return frozenset(
        plugin.source_name for plugin in sentiment_plugins.list_sentiment_source_plugins()
    )


def _supported_error_prefixes() -> tuple[str, ...]:
    plugin_prefixes = tuple(
        plugin.error_code.replace("UNAVAILABLE", "")
        for plugin in sentiment_plugins.list_sentiment_source_plugins()
        if plugin.error_code.endswith("UNAVAILABLE")
    )
    return (*plugin_prefixes, "SENTIMENT_SNAPSHOT_")


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


def _snapshot_compatibility_issues(response: SentimentResponse) -> list[str]:
    issues: list[str] = []
    supported_source_names = _supported_live_source_names()
    if any(source.name not in supported_source_names for source in response.sources):
        issues.append("unsupported_source_present")
    supported_error_prefixes = _supported_error_prefixes()
    if any(
        not code.startswith(supported_error_prefixes)
        for code in _response_error_codes(response)
    ):
        issues.append("unsupported_error_present")
    return issues


def _is_runtime_compatible_snapshot(response: SentimentResponse) -> bool:
    return not _snapshot_compatibility_issues(response)


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
    compatibility_issues = _snapshot_compatibility_issues(response)
    if compatibility_issues:
        service_logger.info(
            "Discarding legacy sentiment snapshot"
            f" | snapshot_key={_snapshot_key(payload)}"
            f" | compatibility_issues={compatibility_issues}"
        )
        return None
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
    baseline_observation: sentiment_plugins.SentimentSourceObservation | None,
    momentum_observation: sentiment_plugins.SentimentSourceObservation | None,
    volume_observation: sentiment_plugins.SentimentSourceObservation | None,
    volatility_observation: sentiment_plugins.SentimentSourceObservation | None,
) -> list[str]:
    bullets: list[str] = []
    if (
        baseline_observation is not None
        and baseline_observation.baseline_score is not None
        and baseline_observation.baseline_classification is not None
    ):
        bullets.append(
            f"{baseline_observation.display_name} baseline is {baseline_observation.baseline_score}/100 with '{baseline_observation.baseline_classification}' risk appetite."
        )
    else:
        bullets.append(
            f"{payload.symbol} currently falls back to the provider's internal baseline model because the market baseline feed is unavailable."
        )
    if (
        momentum_observation is not None
        and momentum_observation.last_price_usd is not None
        and momentum_observation.price_change_pct is not None
    ):
        bullets.append(
            f"{momentum_observation.display_name} shows {payload.symbol} at ${momentum_observation.last_price_usd:,.2f} with {momentum_observation.price_change_pct:.2f}% 24h change."
        )
    else:
        bullets.append(
            f"Trend direction is {trend_direction} using fallback rules because token-level live market data is unavailable."
        )
    narrative_market_observation = volatility_observation or volume_observation
    if (
        narrative_market_observation is not None
        and narrative_market_observation.realized_volatility_pct is not None
        and narrative_market_observation.quote_volume_usd is not None
        and payload.include_narrative
    ):
        bullets.append(
            f"{narrative_market_observation.display_name} realized volatility is {narrative_market_observation.realized_volatility_pct:.2f}% with {narrative_market_observation.quote_volume_usd:,.0f} quote volume over the latest market window."
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
    plugin: sentiment_plugins.SentimentSourcePlugin,
    error_message: str,
) -> RawFeedRecord:
    return RawFeedRecord(
        symbol=payload.symbol,
        chain=payload.chain,
        sourceName=plugin.source_name,
        success=False,
        fetchedAt=_to_zulu(_now_utc()),
        sourceTimestamp=None,
        latencyMs=None,
        retryCount=max(0, get_settings().sentiment_source_max_attempts - 1),
        timeoutMs=plugin.timeout_ms(),
        httpStatus=None,
        payloadHash=None,
        payloadExcerpt=EmptyPayloadExcerpt(),
        errorCode=plugin.error_code,
        errorMessage=error_message,
    )


async def _fetch_live_sources(
    payload: SentimentRequest,
) -> tuple[
    list[sentiment_plugins.SentimentSourceObservation],
    list[RawFeedRecord],
    list[ErrorRecord],
]:
    snapshot_key = _snapshot_key(payload)
    plugins = sentiment_plugins.list_sentiment_source_plugins()
    results = await asyncio.gather(
        *(plugin.fetch(payload) for plugin in plugins),
        return_exceptions=True,
    )
    observations: list[sentiment_plugins.SentimentSourceObservation] = []
    raw_feed_records: list[RawFeedRecord] = []
    errors: list[ErrorRecord] = []

    for plugin, result in zip(plugins, results, strict=True):
        if isinstance(result, BaseException):
            service_logger.warning(
                "Sentiment source fetch failed"
                f" | snapshot_key={snapshot_key}"
                f" | source={plugin.source_name}"
                f" | symbol={payload.symbol}"
                f" | error={result}"
            )
            raw_feed_records.append(
                _error_raw_feed_record(
                    payload=payload,
                    plugin=plugin,
                    error_message=str(result),
                )
            )
            errors.append(
                ErrorRecord(
                    code=plugin.error_code,
                    message=f"{plugin.error_message_prefix}: {result}",
                )
            )
            continue
        observations.append(result)
        raw_feed_records.append(result.to_raw_feed_record(payload))

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

    return (observations, raw_feed_records, errors)


def _select_observation_for_capability(
    observations: list[sentiment_plugins.SentimentSourceObservation],
    capability: sentiment_plugins.SentimentCapability,
) -> sentiment_plugins.SentimentSourceObservation | None:
    candidates = [
        observation for observation in observations if observation.supports(capability)
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda observation: observation.freshness_sec)


async def refresh_sentiment_snapshot(
    payload: SentimentRequest,
    *,
    reason: Literal["request", "scheduler"] = REFRESH_REASON_REQUEST,
) -> SentimentResponse:
    snapshot_key = _snapshot_key(payload)
    existing_refresh = _in_flight_refresh_tasks.get(snapshot_key)
    current_task = asyncio.current_task()
    if existing_refresh is not None and existing_refresh is not current_task:
        return await asyncio.shield(existing_refresh)

    async def _run_refresh() -> SentimentResponse:
        refresh_started_at = perf_counter()
        repository = get_sentiment_repository()
        cache_key = (
            payload.symbol,
            payload.chain,
            payload.lookback_hours,
            payload.include_narrative,
        )

        observations, raw_feed_records, errors = await _fetch_live_sources(payload)

        if not observations:
            stored_snapshot = repository.load_snapshot(snapshot_key)
            if stored_snapshot is not None and _is_runtime_compatible_snapshot(stored_snapshot):
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
            observations=observations,
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

    refresh_task = asyncio.create_task(
        _run_refresh(),
        name=f"sentiment-refresh:{snapshot_key}:{reason}",
    )
    _in_flight_refresh_tasks[snapshot_key] = refresh_task
    try:
        return await asyncio.shield(refresh_task)
    finally:
        if _in_flight_refresh_tasks.get(snapshot_key) is refresh_task:
            _in_flight_refresh_tasks.pop(snapshot_key, None)


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
    observations: list[sentiment_plugins.SentimentSourceObservation],
    errors: list[ErrorRecord],
) -> SentimentResponse:
    profile = SYMBOL_PROFILES[payload.symbol]
    lookback_penalty = min(8, max(0, (payload.lookback_hours - 24) // 24))
    baseline_observation = _select_observation_for_capability(
        observations, "baseline_sentiment"
    )
    momentum_observation = _select_observation_for_capability(
        observations, "price_momentum"
    )
    volume_observation = _select_observation_for_capability(observations, "volume_heat")
    volatility_observation = _select_observation_for_capability(
        observations, "realized_volatility"
    )
    baseline_score = (
        baseline_observation.baseline_score
        if baseline_observation is not None and baseline_observation.baseline_score is not None
        else profile.baseline_score
    )
    momentum_adjustment = 0
    if (
        momentum_observation is not None
        and momentum_observation.price_change_pct is not None
    ):
        momentum_adjustment = _live_momentum_adjustment(
            momentum_observation.price_change_pct
        )

    volume_heat_adjustment = 0
    if volume_observation is not None and volume_observation.quote_volume_usd is not None:
        volume_heat_adjustment = _volume_heat_adjustment(
            volume_observation.quote_volume_usd
        )

    volatility_penalty = (
        _volatility_penalty(volatility_observation.realized_volatility_pct)
        if (
            volatility_observation is not None
            and volatility_observation.realized_volatility_pct is not None
        )
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
    if (
        momentum_observation is not None
        and momentum_observation.price_change_pct is not None
    ):
        trend_direction = _trend_direction_from_market(
            momentum_observation.price_change_pct, payload.lookback_hours
        )
    volatility_signal = (
        _volatility_signal_from_market(volatility_observation.realized_volatility_pct)
        if (
            volatility_observation is not None
            and volatility_observation.realized_volatility_pct is not None
        )
        else _volatility_signal(profile, payload.lookback_hours)
    )
    sources = [
        SourceRecord(name=observation.source_name, freshnessSec=observation.freshness_sec)
        for observation in observations
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
                baseline_observation=baseline_observation,
                momentum_observation=momentum_observation,
                volume_observation=volume_observation,
                volatility_observation=volatility_observation,
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
        stored_response = _servable_snapshot_response(payload, stored_snapshot, now=now)
        if stored_response is not None:
            _snapshot_cache[cache_key] = stored_snapshot
            return stored_response
    return await refresh_sentiment_snapshot(payload, reason=REFRESH_REASON_REQUEST)
