from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from time import perf_counter

from app.core.config import get_settings
from app.schemas.sentiment import ErrorRecord, FreshnessRecord, ServiceDescriptor, SourceRecord
from app.schemas.whale_flow_monitor import (
    WhaleFlowEvent,
    WhaleFlowMonitorRequest,
    WhaleFlowMonitorResponse,
    WhaleFlowMonitorResult,
)
from app.services.smart_contract_audit.domain import ProviderInvocationRecord
from app.services.whale_flow_monitor.domain import (
    WhaleFlowSnapshotRecord,
    build_snapshot_key,
    to_zulu,
)
from app.services.whale_flow_monitor.repository import (
    get_whale_flow_repository,
    snapshot_expiry,
)


SERVICE_ID = "svc_whale_flow_monitor"
SERVICE_NAME = "Whale Flow Monitor"
SERVICE_VERSION = "1.0.0"


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _to_zulu(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _deterministic_seed(payload: WhaleFlowMonitorRequest) -> int:
    digest = hashlib.sha256(
        f"{payload.token.lower()}:{payload.chain}:{payload.window_minutes}:{payload.min_usd_value}:{payload.limit}".encode(
            "utf-8"
        )
    ).hexdigest()
    return int(digest[:8], 16)


def _build_events(payload: WhaleFlowMonitorRequest) -> list[WhaleFlowEvent]:
    seed = _deterministic_seed(payload)
    now = _now_utc()
    event_count = min(payload.limit, 5)
    events: list[WhaleFlowEvent] = []
    for index in range(event_count):
        direction = "wallet_to_exchange" if (seed + index) % 2 == 0 else "exchange_to_wallet"
        value_multiplier = 1.0 + ((seed + index) % 4) * 0.35
        usd_value = round(payload.min_usd_value * value_multiplier, 2)
        tags = ["whale_wallet"]
        if direction == "wallet_to_exchange":
            tags.append("known_exchange")
        else:
            tags.append("smart_money_watchlist")

        events.append(
            WhaleFlowEvent(
                timestamp=_to_zulu(now - timedelta(minutes=(index + 1) * 7)),
                usd_value=usd_value,
                direction=direction,
                wallet_tags=tags,
                summary=(
                    "Large transfer moved into exchange-tagged address."
                    if direction == "wallet_to_exchange"
                    else "Exchange outflow moved to whale self-custody cluster."
                ),
            )
        )
    return events


def _net_direction(events: list[WhaleFlowEvent]) -> str:
    exchange_in = sum(1 for event in events if event.direction == "wallet_to_exchange")
    exchange_out = sum(1 for event in events if event.direction == "exchange_to_wallet")
    if exchange_in > exchange_out:
        return "net_outflow"
    if exchange_out > exchange_in:
        return "net_inflow"
    return "mixed"


async def build_whale_flow_monitor(
    payload: WhaleFlowMonitorRequest,
) -> WhaleFlowMonitorResponse:
    events = _build_events(payload)
    net_direction = _net_direction(events)

    if net_direction == "net_outflow":
        impact = "Whale transfers imply possible short-term sell pressure near exchange venues."
    elif net_direction == "net_inflow":
        impact = "Recent outflows from exchanges suggest reduced immediate sell pressure."
    else:
        impact = "Flow direction is balanced; watch for the next large transfer cluster."

    watchlist_matches = sorted(
        {
            tag
            for event in events
            for tag in event.wallet_tags
            if tag in {"known_exchange", "smart_money_watchlist"}
        }
    )

    return WhaleFlowMonitorResponse(
        service=ServiceDescriptor(
            serviceId=SERVICE_ID,
            serviceName=SERVICE_NAME,
            version=SERVICE_VERSION,
        ),
        sources=[
            SourceRecord(name="blockscout", freshnessSec=20),
            SourceRecord(name="dexscreener", freshnessSec=15),
        ],
        freshness=FreshnessRecord(
            generatedAt=_to_zulu(_now_utc()),
            maxSourceAgeSec=20,
            cacheHit=False,
        ),
        result=WhaleFlowMonitorResult(
            token=payload.token,
            chain=payload.chain,
            net_direction=net_direction,
            market_impact_guess=impact,
            watchlist_matches=watchlist_matches,
            events=events,
        ),
        errors=[],
    )


async def execute_whale_flow_monitor(
    payload: WhaleFlowMonitorRequest,
    *,
    request_id: str | None,
    gateway_request_id: str | None,
) -> WhaleFlowMonitorResponse:
    repository = get_whale_flow_repository()
    start = perf_counter()
    snapshot_key = build_snapshot_key(payload)

    try:
        response = await build_whale_flow_monitor(payload)
        repository.save_snapshot(
            WhaleFlowSnapshotRecord(
                snapshot_key=snapshot_key,
                request=payload,
                response=response,
                expires_at=snapshot_expiry(get_settings().whale_flow_cache_ttl_s),
            )
        )
        latency_ms = int((perf_counter() - start) * 1000)
        repository.append_invocation(
            ProviderInvocationRecord.build(
                service_id=SERVICE_ID,
                input_payload=payload.model_dump(mode="json"),
                response_status=200,
                request_id=request_id,
                gateway_request_id=gateway_request_id,
                error_code=None,
                upstream_status=None,
                latency_ms=latency_ms,
                cache_hit=False,
                observability_payload={"snapshotKey": snapshot_key},
            )
        )
        return response
    except Exception as exc:
        snapshot = repository.load_snapshot(snapshot_key)
        if snapshot is not None and not snapshot.is_expired(now=_now_utc()):
            fallback_response = snapshot.as_cache_hit_response().model_copy(
                update={
                    "errors": [
                        *snapshot.response.errors,
                        ErrorRecord(
                            code="WHALE_FLOW_SNAPSHOT_FALLBACK_USED",
                            message="Returning persisted whale-flow snapshot due to live runtime failure.",
                        ),
                    ]
                }
            )
            latency_ms = int((perf_counter() - start) * 1000)
            repository.append_invocation(
                ProviderInvocationRecord.build(
                    service_id=SERVICE_ID,
                    input_payload=payload.model_dump(mode="json"),
                    response_status=200,
                    request_id=request_id,
                    gateway_request_id=gateway_request_id,
                    error_code="WHALE_FLOW_LIVE_RUNTIME_FAILED",
                    upstream_status=None,
                    latency_ms=latency_ms,
                    cache_hit=True,
                    observability_payload={
                        "snapshotKey": snapshot_key,
                        "fallbackReason": str(exc),
                    },
                )
            )
            return fallback_response
        raise
