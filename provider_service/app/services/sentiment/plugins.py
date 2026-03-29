from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable, Literal

from app.core.config import get_settings
from app.schemas.sentiment import RawFeedRecord, SentimentRequest
from app.services.sentiment import adapters as sentiment_adapters


UTC_OFFSET_SUFFIX = "+00:00"


SentimentCapability = Literal[
    "baseline_sentiment",
    "price_momentum",
    "volume_heat",
    "realized_volatility",
]


@dataclass(frozen=True)
class SentimentSourceObservation:
    source_name: str
    display_name: str
    capabilities: tuple[SentimentCapability, ...]
    freshness_sec: int
    source_timestamp: str
    fetched_at: str
    latency_ms: int
    retry_count: int
    timeout_ms: int
    http_status: int
    payload_hash: str
    payload_excerpt: object
    baseline_score: int | None = None
    baseline_classification: str | None = None
    market_symbol: str | None = None
    last_price_usd: float | None = None
    price_change_pct: float | None = None
    quote_volume_usd: float | None = None
    realized_volatility_pct: float | None = None

    def supports(self, capability: SentimentCapability) -> bool:
        return capability in self.capabilities

    def to_raw_feed_record(self, payload: SentimentRequest) -> RawFeedRecord:
        return RawFeedRecord(
            symbol=payload.symbol,
            chain=payload.chain,
            sourceName=self.source_name,
            success=True,
            fetchedAt=self.fetched_at,
            sourceTimestamp=self.source_timestamp,
            latencyMs=self.latency_ms,
            retryCount=self.retry_count,
            timeoutMs=self.timeout_ms,
            httpStatus=self.http_status,
            payloadHash=self.payload_hash,
            freshnessSec=self.freshness_sec,
            payloadExcerpt=self.payload_excerpt,
            errorCode=None,
            errorMessage=None,
        )


@dataclass(frozen=True)
class SentimentSourcePlugin:
    source_name: str
    display_name: str
    capabilities: tuple[SentimentCapability, ...]
    error_code: str
    error_message_prefix: str
    timeout_ms_factory: Callable[[], int]
    fetch: Callable[[SentimentRequest], Awaitable[SentimentSourceObservation]]

    def timeout_ms(self) -> int:
        return self.timeout_ms_factory()


def _settings_timeout_ms(value: float) -> int:
    return int(value * 1000)


async def _fetch_alternative_me_observation(
    payload: SentimentRequest,
) -> SentimentSourceObservation:
    _ = payload
    snapshot = await sentiment_adapters.fetch_alternative_me_sentiment()
    return SentimentSourceObservation(
        source_name="alternative_me",
        display_name="Alternative.me",
        capabilities=("baseline_sentiment",),
        freshness_sec=snapshot.freshness_sec,
        source_timestamp=snapshot.source_timestamp.isoformat().replace(UTC_OFFSET_SUFFIX, "Z"),
        fetched_at=snapshot.fetched_at.isoformat().replace(UTC_OFFSET_SUFFIX, "Z"),
        latency_ms=snapshot.latency_ms,
        retry_count=snapshot.retry_count,
        timeout_ms=snapshot.timeout_ms,
        http_status=snapshot.http_status,
        payload_hash=snapshot.payload_hash,
        payload_excerpt=snapshot.payload_excerpt,
        baseline_score=snapshot.value,
        baseline_classification=snapshot.classification,
    )


async def _fetch_binance_observation(
    payload: SentimentRequest,
) -> SentimentSourceObservation:
    snapshot = await sentiment_adapters.fetch_binance_market_snapshot(payload.symbol)
    return SentimentSourceObservation(
        source_name="binance_market_data",
        display_name="Binance",
        capabilities=("price_momentum", "volume_heat", "realized_volatility"),
        freshness_sec=snapshot.freshness_sec,
        source_timestamp=snapshot.source_timestamp.isoformat().replace(UTC_OFFSET_SUFFIX, "Z"),
        fetched_at=snapshot.fetched_at.isoformat().replace(UTC_OFFSET_SUFFIX, "Z"),
        latency_ms=snapshot.latency_ms,
        retry_count=snapshot.retry_count,
        timeout_ms=snapshot.timeout_ms,
        http_status=snapshot.http_status,
        payload_hash=snapshot.payload_hash,
        payload_excerpt=snapshot.payload_excerpt,
        market_symbol=snapshot.market_symbol,
        last_price_usd=snapshot.last_price_usd,
        price_change_pct=snapshot.price_change_pct,
        quote_volume_usd=snapshot.quote_volume_usd,
        realized_volatility_pct=snapshot.realized_volatility_pct,
    )


def list_sentiment_source_plugins() -> tuple[SentimentSourcePlugin, ...]:
    settings = get_settings()
    return (
        SentimentSourcePlugin(
            source_name="alternative_me",
            display_name="Alternative.me",
            capabilities=("baseline_sentiment",),
            error_code="ALTERNATIVE_ME_UNAVAILABLE",
            error_message_prefix="Alternative.me feed unavailable",
            timeout_ms_factory=lambda: _settings_timeout_ms(settings.alternative_me_timeout_s),
            fetch=_fetch_alternative_me_observation,
        ),
        SentimentSourcePlugin(
            source_name="binance_market_data",
            display_name="Binance",
            capabilities=("price_momentum", "volume_heat", "realized_volatility"),
            error_code="BINANCE_UNAVAILABLE",
            error_message_prefix="Binance market feed unavailable",
            timeout_ms_factory=lambda: _settings_timeout_ms(settings.binance_timeout_s),
            fetch=_fetch_binance_observation,
        ),
    )