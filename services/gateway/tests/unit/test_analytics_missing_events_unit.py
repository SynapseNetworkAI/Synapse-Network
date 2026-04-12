"""Unit tests for the 4 previously-missing analytics gateway events.

Covers:
  - service_registered
  - service_register_failed
  - provider_first_revenue_received
  - provider_health_degraded
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services.analytics.emitter import AnalyticsEmitter, create_analytics_emitter
from src.services.analytics.gateway_events import (
    emit_provider_first_revenue_received,
    emit_provider_health_degraded,
    emit_service_register_failed,
    emit_service_registered,
    get_emitter,
    set_emitter,
)
from src.services.analytics.privacy import sha256_hash


# ── Fixtures ────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def reset_emitter():
    set_emitter(None)
    yield
    set_emitter(None)


@pytest.fixture
def events_file(tmp_path) -> Path:
    return tmp_path / "events.jsonl"


@pytest.fixture
def file_emitter(events_file) -> AnalyticsEmitter:
    return create_analytics_emitter(
        environment="local",
        fallback_file=str(events_file),
    )


def _read_events(events_file: Path) -> list[dict]:
    if not events_file.exists():
        return []
    lines = events_file.read_text().strip().split("\n")
    return [json.loads(line) for line in lines if line.strip()]


# ── service_registered ──────────────────────────────────────────


class TestEmitServiceRegistered:
    async def test_emits_service_registered_event(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_service_registered(
            "0xProvider123",
            service_id="svc_abc",
            service_name="My Weather API",
            correlation_id="corr_001",
        )
        events = _read_events(events_file)
        assert len(events) == 1
        e = events[0]
        assert e["event_name"] == "service_registered"
        assert e["properties"]["service_id"] == "svc_abc"
        assert e["properties"]["service_name"] == "My Weather API"
        assert e["properties"]["role"] == "provider"
        assert e["properties"]["correlation_id"] == "corr_001"

    async def test_distinct_id_is_hashed(self, file_emitter, events_file):
        set_emitter(file_emitter)
        raw = "0xProvider123"
        await emit_service_registered(raw, service_id="svc_1")
        events = _read_events(events_file)
        assert events[0]["distinct_id"] == sha256_hash(raw)
        assert not events[0]["distinct_id"].startswith("0x")

    async def test_provider_id_property_is_hashed(self, file_emitter, events_file):
        set_emitter(file_emitter)
        raw = "0xProviderXYZ"
        await emit_service_registered(raw, service_id="svc_2")
        events = _read_events(events_file)
        assert events[0]["properties"]["provider_id"] == sha256_hash(raw)

    async def test_noop_when_no_emitter(self):
        # Must not raise even with no emitter configured
        await emit_service_registered("0xAddr", service_id="svc_noop")


# ── service_register_failed ─────────────────────────────────────


class TestEmitServiceRegisterFailed:
    async def test_emits_service_register_failed(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_service_register_failed(
            "0xProvider456",
            error_code="SERVICE_ID_CONFLICT",
            reason="serviceId 'my-svc' already exists",
            correlation_id="corr_002",
        )
        events = _read_events(events_file)
        assert len(events) == 1
        e = events[0]
        assert e["event_name"] == "service_register_failed"
        assert e["properties"]["error_code"] == "SERVICE_ID_CONFLICT"
        assert e["properties"]["reason"] == "serviceId 'my-svc' already exists"
        assert e["properties"]["role"] == "provider"
        assert e["properties"]["correlation_id"] == "corr_002"

    async def test_provider_id_is_hashed(self, file_emitter, events_file):
        set_emitter(file_emitter)
        raw = "0xBadProvider"
        await emit_service_register_failed(raw, error_code="VALIDATION_ERROR")
        events = _read_events(events_file)
        assert events[0]["properties"]["provider_id"] == sha256_hash(raw)

    async def test_noop_when_no_emitter(self):
        await emit_service_register_failed("0xAddr", error_code="ERR")


# ── provider_first_revenue_received ─────────────────────────────


class TestEmitProviderFirstRevenueReceived:
    async def test_emits_first_revenue_event(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_provider_first_revenue_received(
            "0xProvider789",
            service_id="svc_xyz",
            gross_usdc=0.05,
            time_since_listing_ms=3600_000,
            correlation_id="corr_003",
        )
        events = _read_events(events_file)
        assert len(events) == 1
        e = events[0]
        assert e["event_name"] == "provider_first_revenue_received"
        assert e["properties"]["service_id"] == "svc_xyz"
        assert e["properties"]["gross_usdc"] == 0.05
        assert e["properties"]["is_first_revenue"] is True
        assert e["properties"]["time_since_listing_ms"] == 3600_000
        assert e["properties"]["role"] == "provider"
        assert e["properties"]["correlation_id"] == "corr_003"

    async def test_omits_time_since_listing_when_none(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_provider_first_revenue_received(
            "0xProvider", service_id="svc_1", gross_usdc=0.01,
        )
        events = _read_events(events_file)
        assert "time_since_listing_ms" not in events[0]["properties"]

    async def test_distinct_id_is_hashed(self, file_emitter, events_file):
        set_emitter(file_emitter)
        raw = "0xProvFirst"
        await emit_provider_first_revenue_received(raw, service_id="svc_1", gross_usdc=0.01)
        events = _read_events(events_file)
        assert events[0]["distinct_id"] == sha256_hash(raw)

    async def test_noop_when_no_emitter(self):
        await emit_provider_first_revenue_received("0xAddr", service_id="svc", gross_usdc=0.01)


# ── provider_health_degraded ────────────────────────────────────


class TestEmitProviderHealthDegraded:
    async def test_emits_health_degraded_event(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_provider_health_degraded(
            "0xProviderHealth",
            service_id="svc_health",
            overall_status="degraded",
            healthy_targets=1,
            total_targets=3,
            correlation_id="corr_004",
        )
        events = _read_events(events_file)
        assert len(events) == 1
        e = events[0]
        assert e["event_name"] == "provider_health_degraded"
        assert e["properties"]["service_id"] == "svc_health"
        assert e["properties"]["overall_status"] == "degraded"
        assert e["properties"]["healthy_targets"] == 1
        assert e["properties"]["total_targets"] == 3
        assert e["properties"]["role"] == "provider"

    async def test_emits_for_unhealthy_status(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_provider_health_degraded(
            "0xProviderDown",
            service_id="svc_down",
            overall_status="unhealthy",
            healthy_targets=0,
            total_targets=2,
        )
        events = _read_events(events_file)
        assert events[0]["properties"]["overall_status"] == "unhealthy"
        assert events[0]["properties"]["healthy_targets"] == 0

    async def test_provider_id_is_hashed(self, file_emitter, events_file):
        set_emitter(file_emitter)
        raw = "0xHealthProvider"
        await emit_provider_health_degraded(
            raw, service_id="svc", overall_status="degraded",
            healthy_targets=0, total_targets=1,
        )
        events = _read_events(events_file)
        assert events[0]["properties"]["provider_id"] == sha256_hash(raw)
        assert not events[0]["distinct_id"].startswith("0x")

    async def test_noop_when_no_emitter(self):
        await emit_provider_health_degraded(
            "0xAddr", service_id="svc", overall_status="degraded",
            healthy_targets=0, total_targets=1,
        )


# ── Error resilience ────────────────────────────────────────────


class TestAllEventErrorResilience:
    """All 4 new events must never crash the calling business logic."""

    @pytest.mark.parametrize("coro", [
        emit_service_registered("0xA", service_id="svc"),
        emit_service_register_failed("0xA", error_code="ERR"),
        emit_provider_first_revenue_received("0xA", service_id="svc", gross_usdc=0.01),
        emit_provider_health_degraded(
            "0xA", service_id="svc", overall_status="degraded",
            healthy_targets=0, total_targets=1,
        ),
    ])
    async def test_swallows_backend_error(self, file_emitter, coro):
        set_emitter(file_emitter)
        file_emitter._backend.send = AsyncMock(side_effect=RuntimeError("backend down"))
        await coro  # must not raise
