from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.sentiment import (
    ErrorRecord,
    FreshnessRecord,
    ServiceDescriptor,
    SourceRecord,
)


class WhaleFlowMonitorRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(
        ...,
        min_length=1,
        max_length=120,
        description="Token symbol or contract address.",
    )
    chain: str = Field(
        ...,
        min_length=1,
        max_length=40,
        description="Chain scope, such as ethereum, base, arbitrum.",
    )
    window_minutes: int = Field(default=60, ge=5, le=1440)
    min_usd_value: float = Field(default=100000, ge=10000)
    limit: int = Field(default=10, ge=1, le=50)

    @field_validator("token")
    @classmethod
    def validate_token(cls, value: str) -> str:
        normalized = str(value or "").strip()
        if not normalized:
            raise ValueError("token must not be empty")
        return normalized

    @field_validator("chain")
    @classmethod
    def validate_chain(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if not normalized:
            raise ValueError("chain must not be empty")
        return normalized


class WhaleFlowEvent(BaseModel):
    timestamp: str
    usd_value: float
    direction: str
    wallet_tags: list[str] = Field(default_factory=list)
    summary: str


class WhaleFlowMonitorResult(BaseModel):
    token: str
    chain: str
    net_direction: str
    market_impact_guess: str
    watchlist_matches: list[str] = Field(default_factory=list)
    events: list[WhaleFlowEvent] = Field(default_factory=list)


class WhaleFlowMonitorResponse(BaseModel):
    service: ServiceDescriptor
    sources: list[SourceRecord] = Field(default_factory=list)
    freshness: FreshnessRecord
    result: WhaleFlowMonitorResult
    errors: list[ErrorRecord] = Field(default_factory=list)
