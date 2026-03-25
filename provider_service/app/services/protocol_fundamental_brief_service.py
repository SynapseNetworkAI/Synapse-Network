from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from app.core.config import get_settings
from app.schemas.protocol_fundamental_brief import (
    ProtocolFundamentalBriefRequest,
    ProtocolFundamentalBriefResponse,
    ProtocolFundamentalBriefResult,
)
from app.schemas.sentiment import ErrorRecord, FreshnessRecord, ServiceDescriptor
from app.services.protocol_fundamental_brief.cache import ProtocolBriefSnapshotCache
from app.services.protocol_fundamental_brief.domain import (
    DefiLlamaProtocolObservation,
    DexScreenerMarketObservation,
    ProtocolBriefObservation,
    ProtocolBriefRawFeedRecord,
    ProtocolBriefSnapshotKey,
    ProtocolBriefSnapshotRecord,
    to_zulu,
)
from app.services.protocol_fundamental_brief import plugins as brief_plugins
from app.services.protocol_fundamental_brief.repository import get_protocol_brief_repository


SERVICE_ID = "svc_protocol_fundamental_brief"
SERVICE_NAME = "Protocol Fundamental Brief"
SERVICE_VERSION = "1.0.0"
REFRESH_REASON_REQUEST = "request"


_snapshot_cache = ProtocolBriefSnapshotCache()
_in_flight_refresh_tasks: dict[str, asyncio.Task[ProtocolFundamentalBriefResponse]] = {}


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _format_usd(value: float | None) -> str:
    if value is None:
        return "n/a"
    if value >= 1_000_000_000:
        return f"${value / 1_000_000_000:.2f}B"
    if value >= 1_000_000:
        return f"${value / 1_000_000:.2f}M"
    if value >= 1_000:
        return f"${value / 1_000:.2f}K"
    return f"${value:.2f}"


async def _collect_live_observations(
    payload: ProtocolFundamentalBriefRequest,
) -> tuple[
    tuple[ProtocolBriefObservation, ...],
    list[ProtocolBriefRawFeedRecord],
    list[ErrorRecord],
]:
    plugins = brief_plugins.list_protocol_source_plugins()
    snapshot_key = ProtocolBriefSnapshotKey.from_request(payload)
    results = await asyncio.gather(
        *(plugin.fetch(payload) for plugin in plugins),
        return_exceptions=True,
    )
    observations: list[ProtocolBriefObservation] = []
    raw_feed_records: list[ProtocolBriefRawFeedRecord] = []
    errors: list[ErrorRecord] = []

    for plugin, result in zip(plugins, results, strict=True):
        if isinstance(result, BaseException):
            raw_feed_records.append(
                ProtocolBriefRawFeedRecord.build_failure(
                    brief_key=snapshot_key.value,
                    payload=payload,
                    source_name=plugin.source_name,
                    retry_count=max(0, get_settings().protocol_brief_source_max_attempts - 1),
                    timeout_ms=plugin.timeout_ms(),
                    error_code=plugin.error_code,
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
        raw_feed_records.append(
            result.to_raw_feed_record(brief_key=snapshot_key.value, payload=payload)
        )
    return tuple(observations), raw_feed_records, errors


def _observation_by_source(
    observations: tuple[ProtocolBriefObservation, ...],
    source_name: str,
) -> ProtocolBriefObservation | None:
    for observation in observations:
        if observation.source_name == source_name:
            return observation
    return None


def _price_preview(
    payload: ProtocolFundamentalBriefRequest,
    market_observation: DexScreenerMarketObservation | None,
) -> str:
    if market_observation is None:
        return (
            "Phase 2 preview: DexScreener market context is not available yet for this request, "
            f"so live price preview for {payload.protocol} remains unavailable."
        )

    spot_price = _format_usd(market_observation.spot_price_usd)
    liquidity = _format_usd(market_observation.liquidity_usd)
    volume_24h = _format_usd(market_observation.volume_24h_usd)
    return (
        "Phase 2 preview: DexScreener selected "
        f"{market_observation.base_token_symbol}/{market_observation.quote_token_symbol} on {market_observation.dex_id} "
        f"({market_observation.chain_id}) at {spot_price}, with liquidity {liquidity} and 24h volume {volume_24h}."
    )


def _tvl_preview(
    payload: ProtocolFundamentalBriefRequest,
    defillama_observation: DefiLlamaProtocolObservation | None,
) -> str:
    if defillama_observation is None:
        return (
            "Phase 2 preview: DefiLlama protocol context is not available yet for this request, "
            f"so live TVL preview for {payload.protocol} remains unavailable."
        )

    tvl = _format_usd(defillama_observation.tvl_usd_current)
    category = defillama_observation.category or "unknown category"
    change_7d = defillama_observation.tvl_change_7d_pct
    change_text = (
        f"7d change {change_7d:.2f}%" if isinstance(change_7d, (int, float)) else "7d change unavailable"
    )
    return (
        "Phase 2 preview: DefiLlama resolved "
        f"{defillama_observation.protocol_display_name or payload.protocol} as {category}, with current TVL {tvl} and {change_text}."
    )


def _revenue_preview(
    defillama_observation: DefiLlamaProtocolObservation | None,
    market_observation: DexScreenerMarketObservation | None,
) -> list[str]:
    signals: list[str] = []
    if defillama_observation is not None:
        signals.append(
            "Phase 2 preview: DefiLlama fee/revenue signals are connected "
            f"(fees 24h {_format_usd(defillama_observation.fees_24h_usd)}, "
            f"revenue 24h {_format_usd(defillama_observation.revenue_24h_usd)})."
        )
    if market_observation is not None:
        signals.append(
            "Phase 2 preview: DexScreener trading activity proxy is connected "
            f"(24h volume {_format_usd(market_observation.volume_24h_usd)}, "
            f"buys {market_observation.buy_txn_24h}, sells {market_observation.sell_txn_24h})."
        )
    if not signals:
        signals.append(
            "Phase 2 preview: live revenue and activity sources are unavailable, so this request remains on degraded preview mode."
        )
    return signals[:5]


def _peer_preview(payload: ProtocolFundamentalBriefRequest) -> list[str]:
    if not payload.peer_set:
        return []
    peer_list = ", ".join(payload.peer_set)
    return [
        "Phase 2 preview: peer comparison scaffolding is preserved, but full peer-set aggregation lands in Phase 3; "
        f"requested peers: {peer_list}."
    ]


def _risk_preview(
    observations: tuple[ProtocolBriefObservation, ...],
    errors: list[ErrorRecord],
) -> list[str]:
    risk_flags = [
        "Phase 2 preview only: source adapters and plugin registry are live, but final rule-based risk aggregation has not landed yet."
    ]
    if errors:
        failed_codes = ", ".join(error.code for error in errors)
        risk_flags.append(
            f"One or more upstream sources degraded during this request: {failed_codes}."
        )
    if observations:
        connected_sources = ", ".join(observation.source_name for observation in observations)
        risk_flags.append(
            f"Connected preview sources for this request: {connected_sources}."
        )
    return risk_flags[:5]


def _build_response(
    payload: ProtocolFundamentalBriefRequest,
    *,
    cache_hit: bool,
    observations: tuple[ProtocolBriefObservation, ...],
    errors: list[ErrorRecord],
) -> ProtocolFundamentalBriefResponse:
    defillama_observation = _observation_by_source(observations, "defillama_protocol")
    market_observation = _observation_by_source(observations, "dexscreener_market")
    sources = [observation.to_source_record() for observation in observations]

    return ProtocolFundamentalBriefResponse(
        service=ServiceDescriptor(
            serviceId=SERVICE_ID,
            serviceName=SERVICE_NAME,
            version=SERVICE_VERSION,
        ),
        sources=sources,
        freshness=FreshnessRecord(
            generatedAt=to_zulu(_now_utc()),
            maxSourceAgeSec=max((source.freshness_sec for source in sources), default=0),
            cacheHit=cache_hit,
        ),
        result=ProtocolFundamentalBriefResult(
            protocol=payload.protocol,
            price_summary=_price_preview(
                payload,
                market_observation
                if isinstance(market_observation, DexScreenerMarketObservation)
                else None,
            ),
            tvl_summary=_tvl_preview(
                payload,
                defillama_observation
                if isinstance(defillama_observation, DefiLlamaProtocolObservation)
                else None,
            ),
            revenue_signals=_revenue_preview(
                defillama_observation
                if isinstance(defillama_observation, DefiLlamaProtocolObservation)
                else None,
                market_observation
                if isinstance(market_observation, DexScreenerMarketObservation)
                else None,
            ),
            peer_comparison=_peer_preview(payload),
            risk_flags=_risk_preview(observations, errors),
            operator_view=(
                "Phase 2 is live: source adapters and capability plugins are connected, sources/freshness/errors now reflect upstream collection, "
                "and protocol brief snapshots now support typed repository persistence plus cache-backed fallback while the response body remains a preview contract until Phase 3 aggregation lands."
            ),
        ),
        errors=errors,
    )


async def refresh_protocol_fundamental_brief(
    payload: ProtocolFundamentalBriefRequest,
) -> ProtocolFundamentalBriefResponse:
    snapshot_key = ProtocolBriefSnapshotKey.from_request(payload)
    existing_refresh = _in_flight_refresh_tasks.get(snapshot_key.value)
    current_task = asyncio.current_task()
    if existing_refresh is not None and existing_refresh is not current_task:
        return await asyncio.shield(existing_refresh)

    async def _run_refresh() -> ProtocolFundamentalBriefResponse:
        repository = get_protocol_brief_repository()
        observations, raw_feed_records, errors = await _collect_live_observations(payload)
        if not observations:
            stored_snapshot = repository.load_snapshot(snapshot_key.value)
            repository.append_raw_feed_records(raw_feed_records)
            if stored_snapshot is not None:
                fallback_response = stored_snapshot.as_cache_hit_response().model_copy(
                    update={
                        "errors": [
                            *stored_snapshot.response.errors,
                            *errors,
                            ErrorRecord(
                                code="PROTOCOL_BRIEF_SNAPSHOT_FALLBACK_USED",
                                message=(
                                    "Returning the latest persisted protocol brief snapshot because all live sources failed during request refresh."
                                ),
                            ),
                        ]
                    }
                )
                fallback_record = stored_snapshot.model_copy(update={"response": fallback_response})
                _snapshot_cache.put(fallback_record)
                return fallback_response
        response = _build_response(
            payload,
            cache_hit=False,
            observations=observations,
            errors=errors,
        )
        record = ProtocolBriefSnapshotRecord.from_live_response(
            snapshot_key=snapshot_key,
            request=payload,
            response=response,
            observations=observations,
            cache_ttl_s=get_settings().protocol_brief_cache_ttl_s,
        )
        repository.save_snapshot(record)
        repository.append_raw_feed_records(raw_feed_records)
        _snapshot_cache.put(record)
        return response

    refresh_task = asyncio.create_task(
        _run_refresh(),
        name=f"protocol-brief-refresh:{snapshot_key.value}:{REFRESH_REASON_REQUEST}",
    )
    _in_flight_refresh_tasks[snapshot_key.value] = refresh_task
    try:
        return await asyncio.shield(refresh_task)
    finally:
        if _in_flight_refresh_tasks.get(snapshot_key.value) is refresh_task:
            _in_flight_refresh_tasks.pop(snapshot_key.value, None)


async def build_protocol_fundamental_brief(
    payload: ProtocolFundamentalBriefRequest,
) -> ProtocolFundamentalBriefResponse:
    snapshot_key = ProtocolBriefSnapshotKey.from_request(payload)
    now = _now_utc()
    cached_snapshot = _snapshot_cache.get(snapshot_key.value, now=now)
    if cached_snapshot is not None:
        return cached_snapshot.as_cache_hit_response()

    repository = get_protocol_brief_repository()
    stored_snapshot = repository.load_snapshot(snapshot_key.value)
    if stored_snapshot is not None and not stored_snapshot.is_expired(now=now):
        _snapshot_cache.put(stored_snapshot)
        return stored_snapshot.as_cache_hit_response()

    return await refresh_protocol_fundamental_brief(payload)