from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from app.core.config import get_settings
from app.schemas.protocol_fundamental_brief import (
    ProtocolFundamentalBriefRequest,
    ProtocolFundamentalBriefResponse,
)
from app.schemas.sentiment import ErrorRecord, FreshnessRecord, ServiceDescriptor
from app.services.protocol_fundamental_brief import aggregator as brief_aggregator
from app.services.protocol_fundamental_brief.aliases import normalize_protocol_query
from app.services.protocol_fundamental_brief.cache import ProtocolBriefSnapshotCache
from app.services.protocol_fundamental_brief.domain import (
    DefiLlamaProtocolObservation,
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


def _normalized_request(
    payload: ProtocolFundamentalBriefRequest,
) -> ProtocolFundamentalBriefRequest:
    normalized_protocol = normalize_protocol_query(payload.protocol)
    normalized_peers = [normalize_protocol_query(peer) for peer in payload.peer_set]
    if normalized_protocol == payload.protocol and normalized_peers == payload.peer_set:
        return payload
    return payload.model_copy(
        update={
            "protocol": normalized_protocol,
            "peer_set": normalized_peers,
        }
    )


async def _collect_live_observations(
    payload: ProtocolFundamentalBriefRequest,
) -> tuple[
    tuple[ProtocolBriefObservation, ...],
    list[ProtocolBriefRawFeedRecord],
    list[ErrorRecord],
]:
    plugins = brief_plugins.list_protocol_source_plugins()
    snapshot_key = ProtocolBriefSnapshotKey.from_request(payload)
    fetch_payload = _normalized_request(payload)
    results = await asyncio.gather(
        *(plugin.fetch(fetch_payload) for plugin in plugins),
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


def _defillama_plugin() -> brief_plugins.ProtocolSourcePlugin | None:
    for plugin in brief_plugins.list_protocol_source_plugins():
        if plugin.source_name == "defillama_protocol":
            return plugin
    return None


async def _collect_peer_observations(
    payload: ProtocolFundamentalBriefRequest,
) -> tuple[DefiLlamaProtocolObservation, ...]:
    if not payload.peer_set:
        return ()
    plugin = _defillama_plugin()
    if plugin is None:
        return ()
    peer_requests = tuple(
        payload.model_copy(update={"protocol": peer, "peer_set": []})
        for peer in _normalized_request(payload).peer_set
    )
    results = await asyncio.gather(
        *(plugin.fetch(peer_payload) for peer_payload in peer_requests),
        return_exceptions=True,
    )
    return tuple(
        result
        for result in results
        if isinstance(result, DefiLlamaProtocolObservation)
    )


def _build_response(
    payload: ProtocolFundamentalBriefRequest,
    *,
    cache_hit: bool,
    observations: tuple[ProtocolBriefObservation, ...],
    errors: list[ErrorRecord],
    peer_observations: tuple[DefiLlamaProtocolObservation, ...] = (),
) -> ProtocolFundamentalBriefResponse:
    sources = [observation.to_source_record() for observation in observations]
    brief_result = brief_aggregator.build_structured_brief_result(
        payload,
        observations=observations,
        errors=errors,
        peer_observations=peer_observations,
    )

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
        result=brief_result,
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
        peer_observations = await _collect_peer_observations(payload)
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
            peer_observations=peer_observations,
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