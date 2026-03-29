from __future__ import annotations

from datetime import datetime
from time import perf_counter
from typing import Protocol, TypeVar

from app.services.smart_contract_audit.domain import ProviderInvocationRecord


ResponseT = TypeVar("ResponseT")


class ReplaySnapshotRecord(Protocol[ResponseT]):
    def is_expired(self, *, now: datetime) -> bool: ...

    def as_cache_hit_response(self) -> ResponseT: ...


class ReplayCapableRepository(Protocol[ResponseT]):
    def load_asset(self, asset_key: str) -> ReplaySnapshotRecord[ResponseT] | None: ...

    def append_invocation(self, record: ProviderInvocationRecord) -> None: ...


def replay_cached_snapshot_if_available(
    *,
    repository: ReplayCapableRepository[ResponseT],
    asset_key: str,
    now: datetime,
    service_id: str,
    payload: dict,
    request_id: str | None,
    gateway_request_id: str | None,
    start_time: float,
) -> ResponseT | None:
    cached_snapshot = repository.load_asset(asset_key)
    if cached_snapshot is None or cached_snapshot.is_expired(now=now):
        return None

    replay = cached_snapshot.as_cache_hit_response()
    repository.append_invocation(
        ProviderInvocationRecord.build(
            service_id=service_id,
            input_payload=payload,
            response_status=200,
            request_id=request_id,
            gateway_request_id=gateway_request_id,
            error_code=None,
            upstream_status=None,
            latency_ms=int((perf_counter() - start_time) * 1000),
            cache_hit=True,
            observability_payload={
                "assetKey": asset_key,
                "replayReason": "IDEMPOTENT_SNAPSHOT_REPLAY",
            },
        )
    )
    return replay
