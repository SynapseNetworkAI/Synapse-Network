from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.sentiment import (
    ErrorRecord,
    FreshnessRecord,
    ServiceDescriptor,
    SourceRecord,
)


class ProtocolFundamentalBriefRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    protocol: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="Protocol name, slug, or token ticker for lookup.",
    )
    chain: str | None = Field(
        default=None,
        description="Optional chain filter for multi-chain protocols.",
    )
    peer_set: list[str] = Field(default_factory=list, max_length=5)
    lookback_days: int = Field(default=30, ge=1, le=90)

    @field_validator("protocol")
    @classmethod
    def validate_protocol(cls, value: str) -> str:
        normalized = str(value or "").strip()
        if not normalized:
            raise ValueError("protocol must not be empty")
        return normalized

    @field_validator("chain")
    @classmethod
    def validate_chain(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip().lower()
        return normalized or None

    @field_validator("peer_set")
    @classmethod
    def validate_peer_set(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for item in value:
            cleaned = str(item or "").strip()
            if not cleaned:
                raise ValueError("peer_set items must not be empty")
            peer_key = cleaned.lower()
            if peer_key in seen:
                continue
            normalized.append(cleaned)
            seen.add(peer_key)
        return normalized


class ProtocolFundamentalBriefResult(BaseModel):
    protocol: str
    price_summary: str
    tvl_summary: str
    revenue_signals: list[str] = Field(min_length=1, max_length=5)
    peer_comparison: list[str] = Field(default_factory=list, max_length=5)
    risk_flags: list[str] = Field(min_length=1, max_length=5)
    operator_view: str


class DefiLlamaPayloadExcerpt(BaseModel):
    model_config = ConfigDict(extra="forbid")

    protocol_slug: str = Field(alias="protocolSlug")
    display_name: str = Field(alias="displayName")
    category: str | None = None
    tvl_usd: float | None = Field(default=None, alias="tvlUsd")
    chain_count: int = Field(alias="chainCount")
    fees_24h_usd: float | None = Field(default=None, alias="fees24hUsd")
    revenue_24h_usd: float | None = Field(default=None, alias="revenue24hUsd")


class DexScreenerPayloadExcerpt(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chain_id: str = Field(alias="chainId")
    pair_address: str = Field(alias="pairAddress")
    dex_id: str = Field(alias="dexId")
    base_symbol: str = Field(alias="baseSymbol")
    quote_symbol: str = Field(alias="quoteSymbol")
    liquidity_usd: float = Field(alias="liquidityUsd")
    volume_24h_usd: float = Field(alias="volume24hUsd")


class ProtocolFundamentalBriefResponse(BaseModel):
    service: ServiceDescriptor
    sources: list[SourceRecord] = Field(default_factory=list)
    freshness: FreshnessRecord
    result: ProtocolFundamentalBriefResult
    errors: list[ErrorRecord] = Field(default_factory=list)