from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.protocol_fundamental_brief import (
    DefiLlamaPayloadExcerpt,
    DexScreenerPayloadExcerpt,
    ProtocolFundamentalBriefRequest,
    ProtocolFundamentalBriefResponse,
)
from app.schemas.sentiment import EmptyPayloadExcerpt, SourceRecord


ProtocolCapability = Literal[
    "protocol_identity",
    "price_context",
    "tvl_context",
    "revenue_activity_context",
    "risk_context",
]

SNAPSHOT_KEY_SEGMENT_PATTERN = re.compile(r"[^a-z0-9]+")


def parse_zulu_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def to_zulu(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _snapshot_key_segment(value: str | None, *, fallback: str) -> str:
    normalized = SNAPSHOT_KEY_SEGMENT_PATTERN.sub("_", str(value or "").strip().lower())
    trimmed = normalized.strip("_")
    return trimmed or fallback


class ProtocolBriefSnapshotKey(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    protocol_key: str
    chain_key: str
    lookback_days: int
    peer_keys: tuple[str, ...] = Field(default_factory=tuple)

    @classmethod
    def from_request(
        cls,
        payload: ProtocolFundamentalBriefRequest,
    ) -> ProtocolBriefSnapshotKey:
        peer_keys = tuple(
            sorted(_snapshot_key_segment(peer, fallback="peer") for peer in payload.peer_set)
        )
        return cls(
            protocol_key=_snapshot_key_segment(payload.protocol, fallback="protocol"),
            chain_key=_snapshot_key_segment(payload.chain, fallback="all_chains"),
            lookback_days=payload.lookback_days,
            peer_keys=peer_keys,
        )

    @property
    def value(self) -> str:
        peer_segment = "peers_none" if not self.peer_keys else f"peers_{'_'.join(self.peer_keys)}"
        return (
            f"{self.protocol_key}__{self.chain_key}__{self.lookback_days}d__{peer_segment}"
        )


class ChainTvlSlice(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    chain: str
    tvl_usd: float


class ProtocolBriefRawFeedRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    brief_key: str
    protocol: str
    chain: str | None = None
    source_name: str
    success: bool
    fetched_at: str
    source_timestamp: str | None = None
    latency_ms: int | None = None
    retry_count: int = 0
    timeout_ms: int | None = None
    http_status: int | None = None
    payload_hash: str | None = None
    payload_excerpt: DefiLlamaPayloadExcerpt | DexScreenerPayloadExcerpt | EmptyPayloadExcerpt
    error_code: str | None = None
    error_message: str | None = None

    @classmethod
    def build_failure(
        cls,
        *,
        brief_key: str,
        payload: ProtocolFundamentalBriefRequest,
        source_name: str,
        retry_count: int,
        timeout_ms: int,
        error_code: str,
        error_message: str,
    ) -> ProtocolBriefRawFeedRecord:
        return cls(
            brief_key=brief_key,
            protocol=payload.protocol,
            chain=payload.chain,
            source_name=source_name,
            success=False,
            fetched_at=to_zulu(datetime.now(UTC)),
            source_timestamp=None,
            latency_ms=None,
            retry_count=retry_count,
            timeout_ms=timeout_ms,
            http_status=None,
            payload_hash=None,
            payload_excerpt=EmptyPayloadExcerpt(),
            error_code=error_code,
            error_message=error_message,
        )


class ProtocolSourceObservation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    source_name: str
    source_display_name: str
    capabilities: tuple[ProtocolCapability, ...]
    freshness_sec: int = Field(ge=0)
    source_timestamp: str
    fetched_at: str
    latency_ms: int = Field(ge=0)
    retry_count: int = Field(ge=0)
    timeout_ms: int = Field(ge=0)
    http_status: int | None = None
    payload_hash: str

    def supports(self, capability: ProtocolCapability) -> bool:
        return capability in self.capabilities

    def to_source_record(self) -> SourceRecord:
        return SourceRecord(name=self.source_name, freshnessSec=self.freshness_sec)

    def to_raw_feed_record(
        self,
        *,
        brief_key: str,
        payload: ProtocolFundamentalBriefRequest,
    ) -> ProtocolBriefRawFeedRecord:
        return ProtocolBriefRawFeedRecord(
            brief_key=brief_key,
            protocol=payload.protocol,
            chain=payload.chain,
            source_name=self.source_name,
            success=True,
            fetched_at=self.fetched_at,
            source_timestamp=self.source_timestamp,
            latency_ms=self.latency_ms,
            retry_count=self.retry_count,
            timeout_ms=self.timeout_ms,
            http_status=self.http_status,
            payload_hash=self.payload_hash,
            payload_excerpt=self.payload_excerpt(),
            error_code=None,
            error_message=None,
        )

    def payload_excerpt(self) -> DefiLlamaPayloadExcerpt | DexScreenerPayloadExcerpt:
        raise NotImplementedError


class DefiLlamaProtocolObservation(ProtocolSourceObservation):
    source_name: Literal["defillama_protocol"] = "defillama_protocol"
    source_display_name: Literal["DefiLlama"] = "DefiLlama"
    capabilities: tuple[ProtocolCapability, ...] = (
        "protocol_identity",
        "tvl_context",
        "revenue_activity_context",
        "risk_context",
    )
    protocol_slug: str
    protocol_display_name: str
    protocol_symbol: str | None = None
    category: str | None = None
    supported_chains: tuple[str, ...] = Field(default_factory=tuple)
    chain_tvl_breakdown: tuple[ChainTvlSlice, ...] = Field(default_factory=tuple)
    tvl_usd_current: float | None = None
    tvl_change_1d_pct: float | None = None
    tvl_change_7d_pct: float | None = None
    tvl_change_30d_pct: float | None = None
    fees_24h_usd: float | None = None
    fees_7d_usd: float | None = None
    fees_30d_usd: float | None = None
    revenue_24h_usd: float | None = None
    revenue_7d_usd: float | None = None
    revenue_30d_usd: float | None = None
    excerpt: DefiLlamaPayloadExcerpt

    def payload_excerpt(self) -> DefiLlamaPayloadExcerpt:
        return self.excerpt


class DexScreenerMarketObservation(ProtocolSourceObservation):
    source_name: Literal["dexscreener_market"] = "dexscreener_market"
    source_display_name: Literal["DexScreener"] = "DexScreener"
    capabilities: tuple[ProtocolCapability, ...] = (
        "price_context",
        "revenue_activity_context",
        "risk_context",
    )
    chain_id: str
    pair_address: str
    dex_id: str
    base_token_symbol: str
    quote_token_symbol: str
    labels: tuple[str, ...] = Field(default_factory=tuple)
    spot_price_usd: float | None = None
    price_change_5m_pct: float | None = None
    price_change_1h_pct: float | None = None
    price_change_6h_pct: float | None = None
    price_change_24h_pct: float | None = None
    volume_24h_usd: float
    buy_txn_24h: int
    sell_txn_24h: int
    liquidity_usd: float
    market_cap_usd: float | None = None
    fdv_usd: float | None = None
    pair_age_days: int | None = None
    excerpt: DexScreenerPayloadExcerpt

    def payload_excerpt(self) -> DexScreenerPayloadExcerpt:
        return self.excerpt


ProtocolBriefObservation = DefiLlamaProtocolObservation | DexScreenerMarketObservation


class ProtocolBriefSnapshotRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    brief_key: str
    request: ProtocolFundamentalBriefRequest
    response: ProtocolFundamentalBriefResponse
    source_generated_at: str | None = None
    expires_at: str | None = None

    @classmethod
    def from_live_response(
        cls,
        *,
        snapshot_key: ProtocolBriefSnapshotKey,
        request: ProtocolFundamentalBriefRequest,
        response: ProtocolFundamentalBriefResponse,
        observations: tuple[ProtocolBriefObservation, ...],
        cache_ttl_s: int,
    ) -> ProtocolBriefSnapshotRecord:
        source_generated_at = None
        if observations:
            latest_source_time = max(
                parse_zulu_datetime(observation.source_timestamp)
                for observation in observations
            )
            source_generated_at = to_zulu(latest_source_time)
        generated_at = parse_zulu_datetime(response.freshness.generated_at)
        expires_at = to_zulu(generated_at + timedelta(seconds=max(0, cache_ttl_s)))
        return cls(
            brief_key=snapshot_key.value,
            request=request,
            response=response,
            source_generated_at=source_generated_at,
            expires_at=expires_at,
        )

    def is_expired(self, *, now: datetime) -> bool:
        if self.expires_at is None:
            return False
        return parse_zulu_datetime(self.expires_at) <= now

    def as_cache_hit_response(self) -> ProtocolFundamentalBriefResponse:
        return self.response.model_copy(
            update={
                "freshness": self.response.freshness.model_copy(
                    update={"cache_hit": True}
                )
            }
        )