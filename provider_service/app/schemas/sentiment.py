from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


SUPPORTED_SYMBOLS = {"BTC", "ETH", "SOL"}
SUPPORTED_CHAINS = {"market-wide", "ethereum", "solana", "base"}


class SentimentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str = Field(
        ...,
        min_length=2,
        max_length=20,
        description="Token symbol or market symbol, such as BTC, ETH, SOL.",
    )
    chain: str = Field(
        default="market-wide",
        description="Optional chain scope, such as ethereum, solana, base.",
    )
    lookback_hours: int = Field(default=24, ge=1, le=168)
    include_narrative: bool = True

    @field_validator("symbol")
    @classmethod
    def validate_symbol(cls, value: str) -> str:
        normalized = str(value or "").strip().upper()
        if normalized not in SUPPORTED_SYMBOLS:
            raise ValueError(
                f"symbol must be one of {', '.join(sorted(SUPPORTED_SYMBOLS))}"
            )
        return normalized

    @field_validator("chain")
    @classmethod
    def validate_chain(cls, value: str) -> str:
        normalized = str(value or "").strip().lower() or "market-wide"
        if normalized not in SUPPORTED_CHAINS:
            raise ValueError(
                f"chain must be one of {', '.join(sorted(SUPPORTED_CHAINS))}"
            )
        return normalized


class ServiceDescriptor(BaseModel):
    service_id: str = Field(alias="serviceId")
    service_name: str = Field(alias="serviceName")
    version: str


class SourceRecord(BaseModel):
    name: str
    freshness_sec: int = Field(alias="freshnessSec")


class FreshnessRecord(BaseModel):
    generated_at: str = Field(alias="generatedAt")
    max_source_age_sec: int = Field(alias="maxSourceAgeSec")
    cache_hit: bool = Field(alias="cacheHit")


class SentimentResult(BaseModel):
    symbol: str
    sentiment_score: int
    sentiment_label: Literal[
        "extreme_fear",
        "fear",
        "neutral",
        "greed",
        "extreme_greed",
    ]
    trend_direction: Literal["up", "down", "sideways"]
    volatility_signal: Literal["low", "medium", "high"]
    market_temperature: str
    reasoning_bullets: list[str] = Field(min_length=2, max_length=5)
    action_hint: str


class ErrorRecord(BaseModel):
    code: str
    message: str


class EmptyPayloadExcerpt(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AlternativeMePayloadExcerpt(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: int
    classification: str
    timestamp: int


class CoinGeckoPayloadExcerpt(BaseModel):
    model_config = ConfigDict(extra="forbid")

    price_usd: float = Field(alias="priceUsd")
    change_24h_pct: float = Field(alias="change24hPct")
    volume_24h_usd: float = Field(alias="volume24hUsd")
    market_cap_rank: int | None = Field(alias="marketCapRank")


class BinancePayloadExcerpt(BaseModel):
    model_config = ConfigDict(extra="forbid")

    market_symbol: str = Field(alias="marketSymbol")
    last_price_usd: float = Field(alias="lastPriceUsd")
    price_change_pct: float = Field(alias="priceChangePct")
    quote_volume_usd: float = Field(alias="quoteVolumeUsd")
    kline_count: int = Field(alias="klineCount")


PayloadExcerpt = (
    AlternativeMePayloadExcerpt
    | CoinGeckoPayloadExcerpt
    | BinancePayloadExcerpt
    | EmptyPayloadExcerpt
)


class RawFeedRecord(BaseModel):
    symbol: str
    chain: str
    source_name: str = Field(alias="sourceName")
    success: bool
    fetched_at: str = Field(alias="fetchedAt")
    source_timestamp: str | None = Field(alias="sourceTimestamp")
    latency_ms: int | None = Field(alias="latencyMs")
    retry_count: int = Field(alias="retryCount")
    timeout_ms: int | None = Field(alias="timeoutMs")
    http_status: int | None = Field(alias="httpStatus")
    payload_hash: str | None = Field(alias="payloadHash")
    freshness_sec: int | None = Field(default=None, alias="freshnessSec")
    payload_excerpt: PayloadExcerpt = Field(
        default_factory=EmptyPayloadExcerpt,
        alias="payloadExcerpt",
    )
    error_code: str | None = Field(alias="errorCode")
    error_message: str | None = Field(alias="errorMessage")


SchedulerJobStatus = Literal["idle", "running", "cooldown", "failed"]


class SchedulerJobRecord(BaseModel):
    snapshot_key: str = Field(alias="snapshotKey")
    symbol: str
    chain: str
    lookback_hours: int = Field(alias="lookbackHours")
    include_narrative: bool = Field(alias="includeNarrative")
    job_owner: str | None = Field(default=None, alias="jobOwner")
    job_status: SchedulerJobStatus = Field(default="idle", alias="jobStatus")
    lease_expires_at: str | None = Field(default=None, alias="leaseExpiresAt")
    last_started_at: str | None = Field(default=None, alias="lastStartedAt")
    last_finished_at: str | None = Field(default=None, alias="lastFinishedAt")
    last_success_at: str | None = Field(default=None, alias="lastSuccessAt")
    last_failure_at: str | None = Field(default=None, alias="lastFailureAt")
    last_error_code: str | None = Field(default=None, alias="lastErrorCode")
    last_error_message: str | None = Field(default=None, alias="lastErrorMessage")
    consecutive_failures: int = Field(default=0, alias="consecutiveFailures")
    next_run_at: str | None = Field(default=None, alias="nextRunAt")
    last_refresh_reason: str | None = Field(default=None, alias="lastRefreshReason")
    updated_at: str | None = Field(default=None, alias="updatedAt")


class SentimentResponse(BaseModel):
    service: ServiceDescriptor
    sources: list[SourceRecord]
    freshness: FreshnessRecord
    result: SentimentResult
    errors: list[ErrorRecord] = Field(default_factory=list)
