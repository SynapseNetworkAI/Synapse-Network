from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


SUPPORTED_SYMBOLS = {"BTC", "ETH", "SOL"}
SUPPORTED_CHAINS = {"market-wide", "ethereum", "solana", "base"}


class SentimentRequest(BaseModel):
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


class SentimentResponse(BaseModel):
    service: ServiceDescriptor
    sources: list[SourceRecord]
    freshness: FreshnessRecord
    result: SentimentResult
    errors: list[ErrorRecord] = Field(default_factory=list)
