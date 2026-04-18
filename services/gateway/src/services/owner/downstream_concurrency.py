from __future__ import annotations

import asyncio
import hashlib
import math
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException

from src.core.config import settings
from src.core.redis_client import get_redis_client
from src.domain.service_contract import ServiceDefinitionRecord
from src.services.analytics.gateway_events import (
    emit_downstream_circuit_opened,
    emit_downstream_concurrency_guard_degraded,
    emit_downstream_concurrency_recovered,
    emit_downstream_concurrency_reduced,
    emit_downstream_request_rejected_busy,
)

_CLOSED = "closed"
_OPEN = "open"
_HALF_OPEN = "half_open"
_NOOP_KEY = "__downstream_noop__"


@dataclass
class _AdaptiveState:
    key: str
    service_id: str
    target_url: str
    owner_address: str
    limit: int
    max_limit: int
    in_flight: int = 0
    window_started_ms: int = 0
    latencies_ms: list[int] = field(default_factory=list)
    total: int = 0
    errors: int = 0
    consecutive_failures: int = 0
    circuit_state: str = _CLOSED
    circuit_opened_at_ms: int = 0
    last_adjustment_at_ms: int = 0
    last_redis_degraded_at_ms: int = 0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


@dataclass
class DownstreamPermit:
    key: str
    service_id: str
    target_url: str
    owner_address: str
    redis_acquired: bool = False
    _released: bool = False

    @property
    def noop(self) -> bool:
        return self.key == _NOOP_KEY

    async def release_without_outcome(self) -> None:
        if self.noop or self._released:
            return
        self._released = True
        await _release_local(self.key)
        if self.redis_acquired:
            await _release_redis(self.key)

    async def release(
        self,
        *,
        latency_ms: int,
        status_code: int | None,
        error_code: str | None,
        success: bool,
    ) -> None:
        if self.noop or self._released:
            return
        self._released = True
        await _record_outcome(
            self.key,
            latency_ms=latency_ms,
            status_code=status_code,
            error_code=error_code,
            success=success,
        )
        if self.redis_acquired:
            await _release_redis(self.key)


_states: dict[str, _AdaptiveState] = {}
_states_lock = asyncio.Lock()


def _now_ms() -> int:
    return int(time.time() * 1000)


def _safe_key(service_id: str, target_url: str) -> str:
    digest = hashlib.sha256(f"{service_id}|{target_url}".encode("utf-8")).hexdigest()
    return f"{service_id}:{digest[:24]}"


def _redis_key(key: str) -> str:
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return f"gateway:downstream:inflight:{digest}"


def _default_limit() -> int:
    configured_min = max(1, int(settings.downstream_adaptive_min_concurrency or 1))
    configured_default = max(
        configured_min, int(settings.downstream_adaptive_default_concurrency or 1)
    )
    configured_max = max(configured_min, int(settings.downstream_adaptive_max_concurrency or 1))
    return min(configured_default, configured_max)


def _max_limit_for_service(service: ServiceDefinitionRecord) -> int:
    configured_min = max(1, int(settings.downstream_adaptive_min_concurrency or 1))
    configured_max = max(configured_min, int(settings.downstream_adaptive_max_concurrency or 1))
    constraints = service.constraints
    max_qps = max(1, int(getattr(constraints, "max_qps", 1) or 1))
    timeout_ms = max(1, int(getattr(constraints, "timeout_ms", 1000) or 1000))
    qps_timeout_derived = max(1, math.ceil(max_qps * timeout_ms / 1000))
    provider_max = getattr(constraints, "max_concurrency", None)
    candidates = [configured_max, qps_timeout_derived]
    if provider_max is not None:
        candidates.append(max(1, int(provider_max or 1)))
    return max(configured_min, min(candidates))


async def _state_for(service: ServiceDefinitionRecord, target_url: str) -> _AdaptiveState:
    service_id = str(service.service_id or "").strip()
    key = _safe_key(service_id, target_url)
    max_limit = _max_limit_for_service(service)
    async with _states_lock:
        state = _states.get(key)
        if state is None:
            state = _AdaptiveState(
                key=key,
                service_id=service_id,
                target_url=target_url,
                owner_address=str(service.owner_address or "").strip(),
                limit=min(_default_limit(), max_limit),
                max_limit=max_limit,
                window_started_ms=_now_ms(),
            )
            _states[key] = state
        else:
            state.owner_address = str(service.owner_address or "").strip()
            state.max_limit = max_limit
            state.limit = max(1, min(state.limit, max_limit))
    return state


def _busy_exception(code: str, message: str, state: _AdaptiveState) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            "code": code,
            "message": message,
            "serviceId": state.service_id,
            "targetUrl": state.target_url,
            "adaptiveConcurrencyLimit": state.limit,
            "inFlight": state.in_flight,
            "circuitState": state.circuit_state,
        },
    )


async def _try_acquire_redis(key: str, limit: int) -> tuple[bool, bool]:
    if not settings.downstream_adaptive_redis_enabled:
        return False, False
    redis_client = await get_redis_client()
    if redis_client is None:
        return False, True
    redis_key = _redis_key(key)
    try:
        current = int(await redis_client.incr(redis_key))
        await redis_client.expire(
            redis_key,
            max(2, int(settings.downstream_adaptive_circuit_open_sec or 30) + 5),
        )
        if current > limit:
            await redis_client.decr(redis_key)
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "SERVICE_BUSY",
                    "message": "Downstream provider is at its global concurrency limit.",
                    "adaptiveConcurrencyLimit": limit,
                    "inFlight": current - 1,
                    "circuitState": _CLOSED,
                },
            )
        return True, False
    except HTTPException:
        raise
    except Exception:
        return False, True


async def _release_redis(key: str) -> None:
    if not settings.downstream_adaptive_redis_enabled:
        return
    redis_client = await get_redis_client()
    if redis_client is None:
        return
    try:
        value = int(await redis_client.decr(_redis_key(key)))
        if value <= 0:
            await redis_client.delete(_redis_key(key))
    except Exception:
        return


async def acquire_downstream_permit(
    service: ServiceDefinitionRecord, target_url: str
) -> DownstreamPermit:
    if not settings.downstream_adaptive_concurrency_enabled:
        return DownstreamPermit(
            key=_NOOP_KEY,
            service_id=str(service.service_id or ""),
            target_url=target_url,
            owner_address=str(service.owner_address or ""),
        )

    state = await _state_for(service, target_url)
    now_ms = _now_ms()
    emit_busy = False
    emit_circuit = False
    async with state.lock:
        open_for_ms = now_ms - int(state.circuit_opened_at_ms or 0)
        open_window_ms = max(1, int(settings.downstream_adaptive_circuit_open_sec or 30)) * 1000
        if state.circuit_state == _OPEN and open_for_ms < open_window_ms:
            emit_circuit = True
            exc = _busy_exception(
                "SERVICE_CIRCUIT_OPEN",
                "Downstream provider circuit is open after repeated failures.",
                state,
            )
        else:
            if state.circuit_state == _OPEN:
                state.circuit_state = _HALF_OPEN
            if state.circuit_state == _HALF_OPEN and state.in_flight > 0:
                emit_circuit = True
                exc = _busy_exception(
                    "SERVICE_CIRCUIT_OPEN",
                    "Downstream provider circuit is half-open and already probing.",
                    state,
                )
            elif state.in_flight >= state.limit:
                emit_busy = True
                exc = _busy_exception(
                    "SERVICE_BUSY",
                    "Downstream provider is at its adaptive concurrency limit.",
                    state,
                )
            else:
                state.in_flight += 1
                exc = None

    if emit_busy:
        await emit_downstream_request_rejected_busy(
            state.owner_address,
            service_id=state.service_id,
            target_url=state.target_url,
            adaptive_concurrency_limit=state.limit,
            in_flight=state.in_flight,
        )
    if emit_circuit:
        await emit_downstream_circuit_opened(
            state.owner_address,
            service_id=state.service_id,
            target_url=state.target_url,
            adaptive_concurrency_limit=state.limit,
            circuit_open_sec=int(settings.downstream_adaptive_circuit_open_sec or 30),
        )
    if exc is not None:
        raise exc

    redis_acquired = False
    try:
        redis_acquired, redis_degraded = await _try_acquire_redis(state.key, state.limit)
    except HTTPException:
        await _release_local(state.key)
        await emit_downstream_request_rejected_busy(
            state.owner_address,
            service_id=state.service_id,
            target_url=state.target_url,
            adaptive_concurrency_limit=state.limit,
            in_flight=state.in_flight,
        )
        raise

    if redis_degraded:
        await _mark_redis_degraded(state)

    return DownstreamPermit(
        key=state.key,
        service_id=state.service_id,
        target_url=target_url,
        owner_address=state.owner_address,
        redis_acquired=redis_acquired,
    )


async def _mark_redis_degraded(state: _AdaptiveState) -> None:
    now_ms = _now_ms()
    should_emit = False
    async with state.lock:
        state.limit = max(1, min(state.limit, max(1, _default_limit() // 2)))
        if now_ms - int(state.last_redis_degraded_at_ms or 0) > 60_000:
            state.last_redis_degraded_at_ms = now_ms
            should_emit = True
    if should_emit:
        await emit_downstream_concurrency_guard_degraded(
            state.owner_address,
            service_id=state.service_id,
            target_url=state.target_url,
            adaptive_concurrency_limit=state.limit,
            reason="redis_unavailable",
        )


async def _release_local(key: str) -> None:
    state = _states.get(key)
    if state is None:
        return
    async with state.lock:
        state.in_flight = max(0, state.in_flight - 1)


def _percentile(values: list[int], percentile: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(len(ordered) * percentile) - 1))
    return int(ordered[index])


async def _record_outcome(
    key: str,
    *,
    latency_ms: int,
    status_code: int | None,
    error_code: str | None,
    success: bool,
) -> None:
    state = _states.get(key)
    if state is None:
        return

    now_ms = _now_ms()
    event: tuple[str, int, int] | None = None
    async with state.lock:
        state.in_flight = max(0, state.in_flight - 1)
        state.latencies_ms.append(max(0, int(latency_ms or 0)))
        state.total += 1
        severe = (
            not success
            or status_code == 429
            or (status_code is not None and int(status_code) >= 500)
            or str(error_code or "") in {"SERVICE_TIMEOUT", "UPSTREAM_ERROR"}
        )
        if severe:
            state.errors += 1
            state.consecutive_failures += 1
        else:
            state.consecutive_failures = 0

        if state.circuit_state == _HALF_OPEN:
            if severe:
                state.circuit_state = _OPEN
                state.circuit_opened_at_ms = now_ms
                event = ("circuit", state.limit, state.limit)
            else:
                previous = state.limit
                state.circuit_state = _CLOSED
                state.limit = max(
                    1,
                    min(state.max_limit, _default_limit(), max(1, state.limit)),
                )
                state.last_adjustment_at_ms = now_ms
                event = ("recovered", previous, state.limit)
            _reset_window(state, now_ms)
        elif state.consecutive_failures >= max(
            1, int(settings.downstream_adaptive_circuit_failure_threshold or 5)
        ):
            state.circuit_state = _OPEN
            state.circuit_opened_at_ms = now_ms
            state.last_adjustment_at_ms = now_ms
            event = ("circuit", state.limit, state.limit)
            _reset_window(state, now_ms)
        else:
            window_ms = max(0, int(settings.downstream_adaptive_window_sec or 0)) * 1000
            if now_ms - int(state.window_started_ms or now_ms) >= window_ms:
                previous = state.limit
                p95 = _percentile(state.latencies_ms, 0.95)
                error_rate = (state.errors / state.total) if state.total else 0
                latency_target = max(1, int(settings.downstream_adaptive_latency_target_ms or 1500))
                if error_rate > 0 or p95 > latency_target:
                    factor = float(settings.downstream_adaptive_decrease_factor or 0.5)
                    state.limit = max(1, min(state.max_limit, math.floor(state.limit * factor)))
                    if state.limit < previous:
                        event = ("reduced", previous, state.limit)
                elif state.limit < state.max_limit:
                    state.limit += 1
                    event = ("recovered", previous, state.limit)
                state.last_adjustment_at_ms = now_ms
                _reset_window(state, now_ms)

    if event is None:
        return
    kind, previous_limit, next_limit = event
    if kind == "reduced":
        await emit_downstream_concurrency_reduced(
            state.owner_address,
            service_id=state.service_id,
            target_url=state.target_url,
            previous_limit=previous_limit,
            next_limit=next_limit,
        )
    elif kind == "recovered":
        await emit_downstream_concurrency_recovered(
            state.owner_address,
            service_id=state.service_id,
            target_url=state.target_url,
            previous_limit=previous_limit,
            next_limit=next_limit,
        )
    elif kind == "circuit":
        await emit_downstream_circuit_opened(
            state.owner_address,
            service_id=state.service_id,
            target_url=state.target_url,
            adaptive_concurrency_limit=state.limit,
            circuit_open_sec=int(settings.downstream_adaptive_circuit_open_sec or 30),
        )


def _reset_window(state: _AdaptiveState, now_ms: int) -> None:
    state.window_started_ms = now_ms
    state.latencies_ms = []
    state.total = 0
    state.errors = 0


def downstream_snapshot_for_service(service: ServiceDefinitionRecord) -> dict[str, Any]:
    target_urls = [str(target.url or "").strip() for target in service.invoke.targets if str(target.url or "").strip()]
    target_payloads = []
    limits: list[int] = []
    in_flight_values: list[int] = []
    circuit_states: list[str] = []
    latencies: list[int] = []
    last_adjustments: list[int] = []

    for target_url in target_urls:
        key = _safe_key(str(service.service_id or "").strip(), target_url)
        state = _states.get(key)
        if state is None:
            max_limit = _max_limit_for_service(service)
            limit = min(_default_limit(), max_limit)
            payload = {
                "targetUrl": target_url,
                "adaptiveConcurrencyLimit": limit,
                "inFlight": 0,
                "queueDepth": 0,
                "latencyP95Ms": 0,
                "errorRate": 0,
                "circuitState": _CLOSED,
                "lastConcurrencyAdjustmentAt": None,
            }
        else:
            p95 = _percentile(state.latencies_ms, 0.95)
            error_rate = (state.errors / state.total) if state.total else 0
            payload = {
                "targetUrl": target_url,
                "adaptiveConcurrencyLimit": state.limit,
                "inFlight": state.in_flight,
                "queueDepth": max(0, state.in_flight - state.limit),
                "latencyP95Ms": p95,
                "errorRate": round(error_rate, 4),
                "circuitState": state.circuit_state,
                "lastConcurrencyAdjustmentAt": state.last_adjustment_at_ms or None,
            }
        target_payloads.append(payload)
        limits.append(int(payload["adaptiveConcurrencyLimit"]))
        in_flight_values.append(int(payload["inFlight"]))
        circuit_states.append(str(payload["circuitState"]))
        latencies.append(int(payload["latencyP95Ms"]))
        if payload["lastConcurrencyAdjustmentAt"] is not None:
            last_adjustments.append(int(payload["lastConcurrencyAdjustmentAt"]))

    circuit_state = _OPEN if _OPEN in circuit_states else _HALF_OPEN if _HALF_OPEN in circuit_states else _CLOSED
    return {
        "adaptiveConcurrencyLimit": min(limits) if limits else _default_limit(),
        "inFlight": sum(in_flight_values),
        "queueDepth": 0,
        "latencyP95Ms": max(latencies) if latencies else 0,
        "errorRate": max((target.get("errorRate", 0) for target in target_payloads), default=0),
        "circuitState": circuit_state,
        "lastConcurrencyAdjustmentAt": max(last_adjustments) if last_adjustments else None,
        "targets": target_payloads,
    }


def reset_downstream_concurrency_state() -> None:
    _states.clear()
