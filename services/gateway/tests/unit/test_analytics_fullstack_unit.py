"""
Full-stack integration tests for the analytics pipeline.

Verifies the complete flow: events router → emitter → file backend → stored events.
No external infrastructure needed (no Kafka, no ClickHouse).
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.routers.events import router
from src.services.analytics.emitter import (
    AnalyticsEmitter,
    FileBackend,
    create_analytics_emitter,
)
from src.services.analytics.gateway_events import (
    emit_deposit_completed,
    emit_invoke_completed,
    emit_provider_first_revenue_received,
    emit_provider_revenue_received,
    emit_settlement_claim_completed,
    emit_settlement_claim_requested,
    emit_withdrawal_completed,
    set_emitter,
)
from src.services.analytics.privacy import sha256_hash


# ── Helpers ─────────────────────────────────────────────────────

RAW_WALLET_PATTERN = re.compile(r"0x[0-9a-fA-F]{40}")

CONSUMER_WALLET = "0xConsumerABCDEF1234567890ABCDEF1234567890ab"
PROVIDER_WALLET = "0xProviderFEDCBA0987654321FEDCBA0987654321cd"


def _read_events(path: Path) -> list[dict[str, Any]]:
    """Read JSONL file and return parsed events."""
    if not path.exists():
        return []
    lines = path.read_text().strip().split("\n")
    return [json.loads(line) for line in lines if line.strip()]


def _make_frontend_event(
    event_name: str = "page_viewed",
    distinct_id: str | None = None,
    **extra_props: Any,
) -> dict[str, Any]:
    """Build a valid frontend event payload dict."""
    return {
        "event_id": str(uuid.uuid4()),
        "event_name": event_name,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "distinct_id": distinct_id or sha256_hash(CONSUMER_WALLET),
        "source": "frontend",
        "properties": {"page_path": "/", **extra_props},
    }


# ── Fixtures ────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _reset_gateway_emitter():
    """Prevent gateway_events module state from leaking between tests."""
    set_emitter(None)
    yield
    set_emitter(None)


@pytest.fixture
def analytics_app(tmp_path):
    """
    Return (FastAPI app, AnalyticsEmitter, Path to JSONL file).
    The app has the events router mounted and a real FileBackend.
    """
    app = FastAPI()
    app.include_router(router)
    events_file = tmp_path / "events.jsonl"
    emitter = create_analytics_emitter(
        environment="local",
        fallback_file=str(events_file),
    )
    app.state.analytics = emitter
    return app, emitter, events_file


@pytest.fixture
def client(analytics_app):
    app, _, _ = analytics_app
    return TestClient(app)


@pytest.fixture
def emitter(analytics_app) -> AnalyticsEmitter:
    _, emitter, _ = analytics_app
    return emitter


@pytest.fixture
def events_file(analytics_app) -> Path:
    _, _, path = analytics_app
    return path


# ── Test 1: Frontend SDK → router → file backend ───────────────


class TestFullStackFrontendPipeline:
    """Simulates what the frontend analytics SDK does."""

    def test_batch_of_mixed_events_written_to_file(self, client, events_file):
        hashed_id = sha256_hash(CONSUMER_WALLET)
        event_names = ["page_viewed", "cta_clicked", "wallet_connected", "deposit_started"]
        payload = {
            "events": [
                _make_frontend_event(name, distinct_id=hashed_id, role="consumer")
                for name in event_names
            ],
        }

        resp = client.post("/api/v1/events", json=payload)

        assert resp.status_code == 200
        body = resp.json()
        assert body["accepted"] == 4
        assert body["rejected"] == 0

        stored = _read_events(events_file)
        assert len(stored) == 4

    def test_event_fields_preserved(self, client, events_file):
        hashed_id = sha256_hash(CONSUMER_WALLET)
        payload = {
            "events": [
                _make_frontend_event(
                    "cta_clicked",
                    distinct_id=hashed_id,
                    cta_id="hero_signup",
                    variant="A",
                ),
            ],
        }

        client.post("/api/v1/events", json=payload)

        stored = _read_events(events_file)
        assert len(stored) == 1
        evt = stored[0]
        assert evt["event_name"] == "cta_clicked"
        assert evt["distinct_id"] == hashed_id
        assert evt["source"] == "frontend"
        assert evt["properties"]["cta_id"] == "hero_signup"
        assert evt["properties"]["variant"] == "A"

    def test_each_event_has_valid_uuid_and_iso_timestamp(self, client, events_file):
        payload = {
            "events": [
                _make_frontend_event("page_viewed"),
                _make_frontend_event("wallet_connected"),
            ],
        }

        client.post("/api/v1/events", json=payload)

        for evt in _read_events(events_file):
            # event_id must be a valid UUID
            uuid.UUID(evt["event_id"])
            # timestamp must parse as ISO 8601
            datetime.fromisoformat(evt["timestamp"])


# ── Test 2: Gateway business logic → emitter → file backend ────


class TestFullStackGatewayPipeline:
    """Simulates what gateway business logic does via gateway_events helpers."""

    async def test_gateway_events_written_to_file(self, emitter, events_file):
        set_emitter(emitter)

        await emit_invoke_completed(
            CONSUMER_WALLET,
            service_id="svc_gpt4",
            provider_address=PROVIDER_WALLET,
            quote_id="q_100",
            price_usdc=0.05,
            latency_ms=250,
            correlation_id="corr_001",
        )
        await emit_deposit_completed(
            CONSUMER_WALLET,
            amount_usdc=100.0,
            tx_hash="0xdeposittx123",
        )
        await emit_provider_revenue_received(
            PROVIDER_WALLET,
            service_id="svc_gpt4",
            gross_usdc=0.05,
            platform_fee_usdc=0.005,
            provider_net_usdc=0.045,
            correlation_id="corr_001",
        )

        stored = _read_events(events_file)
        assert len(stored) == 3

        names = {e["event_name"] for e in stored}
        assert names == {
            "invoke_completed",
            "deposit_completed",
            "provider_revenue_received",
        }

    async def test_wallet_addresses_are_hashed(self, emitter, events_file):
        set_emitter(emitter)

        await emit_invoke_completed(
            CONSUMER_WALLET,
            service_id="svc_1",
            provider_address=PROVIDER_WALLET,
            quote_id="q_1",
            price_usdc=0.01,
            latency_ms=100,
        )

        stored = _read_events(events_file)
        evt = stored[0]
        assert evt["distinct_id"] == sha256_hash(CONSUMER_WALLET)
        assert not evt["distinct_id"].startswith("0x")
        assert evt["properties"]["provider_id"] == sha256_hash(PROVIDER_WALLET)
        assert not evt["properties"]["provider_id"].startswith("0x")

    async def test_correlation_ids_preserved(self, emitter, events_file):
        set_emitter(emitter)
        corr = "corr_full_stack_test"

        await emit_invoke_completed(
            CONSUMER_WALLET,
            service_id="svc_1",
            provider_address=PROVIDER_WALLET,
            quote_id="q_1",
            price_usdc=0.02,
            latency_ms=150,
            correlation_id=corr,
        )

        stored = _read_events(events_file)
        assert stored[0]["properties"]["correlation_id"] == corr

    async def test_revenue_event_provider_id_hashed(self, emitter, events_file):
        set_emitter(emitter)

        await emit_provider_revenue_received(
            PROVIDER_WALLET,
            service_id="svc_2",
            gross_usdc=1.0,
            platform_fee_usdc=0.1,
            provider_net_usdc=0.9,
        )

        stored = _read_events(events_file)
        evt = stored[0]
        assert evt["properties"]["provider_id"] == sha256_hash(PROVIDER_WALLET)
        assert not evt["properties"]["provider_id"].startswith("0x")


# ── Test 3: Consumer activation funnel ──────────────────────────


class TestConsumerFunnelSequence:
    """Verify a complete consumer activation funnel can be reconstructed."""

    async def test_consumer_funnel_ordering_and_coverage(
        self, client, emitter, events_file
    ):
        set_emitter(emitter)
        hashed_id = sha256_hash(CONSUMER_WALLET)

        # Step 1 & 2: frontend events via HTTP
        client.post(
            "/api/v1/events",
            json={
                "events": [
                    _make_frontend_event("wallet_connected", distinct_id=hashed_id),
                    _make_frontend_event(
                        "consumer_signup_completed", distinct_id=hashed_id
                    ),
                ],
            },
        )

        # Step 3 & 4: gateway events via emitter
        await emit_deposit_completed(
            CONSUMER_WALLET,
            amount_usdc=50.0,
            tx_hash="0xtx_dep",
        )
        await emit_invoke_completed(
            CONSUMER_WALLET,
            service_id="svc_funnel",
            provider_address=PROVIDER_WALLET,
            quote_id="q_funnel",
            price_usdc=0.03,
            latency_ms=200,
        )

        stored = _read_events(events_file)
        assert len(stored) == 4

        # Verify correct ordering by timestamp
        timestamps = [datetime.fromisoformat(e["timestamp"]) for e in stored]
        assert timestamps == sorted(timestamps)

        # All events share the same distinct_id (sha256 hash)
        distinct_ids = {e["distinct_id"] for e in stored}
        assert distinct_ids == {hashed_id}

        # Funnel coverage — all expected event names present
        names = [e["event_name"] for e in stored]
        expected_funnel = {
            "wallet_connected",
            "consumer_signup_completed",
            "deposit_completed",
            "invoke_completed",
        }
        assert expected_funnel == set(names)


# ── Test 4: Provider funnel sequence ───────────────────────────


class TestProviderFunnelSequence:
    """Verify a complete provider funnel can be reconstructed."""

    async def test_provider_funnel_events_present_with_role(
        self, emitter, events_file
    ):
        set_emitter(emitter)

        await emit_provider_revenue_received(
            PROVIDER_WALLET,
            service_id="svc_prov",
            gross_usdc=0.10,
            platform_fee_usdc=0.01,
            provider_net_usdc=0.09,
        )
        await emit_settlement_claim_requested(
            PROVIDER_WALLET,
            claim_usdc=0.09,
        )
        await emit_settlement_claim_completed(
            PROVIDER_WALLET,
            claim_usdc=0.09,
            tx_hash="0xtx_settle",
        )
        await emit_withdrawal_completed(
            PROVIDER_WALLET,
            amount_usdc=0.09,
            tx_hash="0xtx_withdraw",
            role="provider",
        )

        stored = _read_events(events_file)
        assert len(stored) == 4

        expected_names = {
            "provider_revenue_received",
            "settlement_claim_requested",
            "settlement_claim_completed",
            "withdrawal_completed",
        }
        assert {e["event_name"] for e in stored} == expected_names

        # All four events must have role="provider"
        for evt in stored:
            assert evt["properties"]["role"] == "provider", (
                f"{evt['event_name']} missing role=provider"
            )


# ── Test 5: Privacy — no raw wallet addresses leak ─────────────


class TestPrivacyInFullPipeline:
    """Verify no raw 0x wallet addresses appear anywhere in stored events."""

    def test_frontend_events_store_hashed_distinct_id(self, client, events_file):
        hashed_id = sha256_hash(CONSUMER_WALLET)
        client.post(
            "/api/v1/events",
            json={
                "events": [
                    _make_frontend_event("page_viewed", distinct_id=hashed_id),
                ],
            },
        )

        stored = _read_events(events_file)
        assert len(stored) == 1
        assert stored[0]["distinct_id"] == hashed_id
        assert not stored[0]["distinct_id"].startswith("0x")

    async def test_gateway_events_hash_wallet_address(self, emitter, events_file):
        set_emitter(emitter)

        await emit_invoke_completed(
            CONSUMER_WALLET,
            service_id="svc_priv",
            provider_address=PROVIDER_WALLET,
            quote_id="q_priv",
            price_usdc=0.01,
            latency_ms=50,
        )

        stored = _read_events(events_file)
        evt = stored[0]
        assert evt["distinct_id"] == sha256_hash(CONSUMER_WALLET)
        assert evt["properties"]["provider_id"] == sha256_hash(PROVIDER_WALLET)

    async def test_no_raw_0x_address_in_stored_json(self, client, emitter, events_file):
        set_emitter(emitter)
        hashed_id = sha256_hash(CONSUMER_WALLET)

        # Frontend event with hashed distinct_id
        client.post(
            "/api/v1/events",
            json={
                "events": [
                    _make_frontend_event("wallet_connected", distinct_id=hashed_id),
                ],
            },
        )

        # Gateway events with raw wallet addresses (should be hashed internally)
        await emit_invoke_completed(
            CONSUMER_WALLET,
            service_id="svc_priv2",
            provider_address=PROVIDER_WALLET,
            quote_id="q_priv2",
            price_usdc=0.02,
            latency_ms=100,
        )
        await emit_provider_revenue_received(
            PROVIDER_WALLET,
            service_id="svc_priv2",
            gross_usdc=0.02,
            platform_fee_usdc=0.002,
            provider_net_usdc=0.018,
        )

        # Scan every stored event — no field should contain a raw 0x address
        raw_content = events_file.read_text()
        for line in raw_content.strip().split("\n"):
            evt = json.loads(line)
            self._assert_no_raw_address_in_dict(evt)

    def _assert_no_raw_address_in_dict(self, d: dict, path: str = "") -> None:
        """Recursively check that no value matches a raw 0x wallet address."""
        for key, value in d.items():
            field_path = f"{path}.{key}" if path else key
            if isinstance(value, str):
                assert not RAW_WALLET_PATTERN.fullmatch(value), (
                    f"Raw wallet address found at {field_path}: {value}"
                )
            elif isinstance(value, dict):
                self._assert_no_raw_address_in_dict(value, field_path)


# ── Test: provider_first_revenue_received ──────────────────────


class TestProviderFirstRevenueReceived:
    """Verify emit_provider_first_revenue_received emits the correct payload."""

    async def test_emits_correct_event_name(self, emitter, events_file):
        set_emitter(emitter)

        await emit_provider_first_revenue_received(
            PROVIDER_WALLET,
            service_id="svc_first_rev",
            gross_usdc=0.50,
        )

        stored = _read_events(events_file)
        assert len(stored) == 1
        assert stored[0]["event_name"] == "provider_first_revenue_received"

    async def test_properties_contain_required_fields(self, emitter, events_file):
        set_emitter(emitter)

        await emit_provider_first_revenue_received(
            PROVIDER_WALLET,
            service_id="svc_first_rev",
            gross_usdc=1.00,
            time_since_listing_ms=120_000,
        )

        stored = _read_events(events_file)
        assert len(stored) == 1
        props = stored[0]["properties"]
        assert props["role"] == "provider"
        assert props["is_first_revenue"] is True
        assert props["service_id"] == "svc_first_rev"
        assert props["gross_usdc"] == 1.00
        assert props["time_since_listing_ms"] == 120_000

    async def test_provider_address_is_hashed(self, emitter, events_file):
        set_emitter(emitter)

        await emit_provider_first_revenue_received(
            PROVIDER_WALLET,
            service_id="svc_priv_first",
            gross_usdc=0.05,
        )

        stored = _read_events(events_file)
        assert len(stored) == 1
        raw_content = events_file.read_text()
        assert PROVIDER_WALLET not in raw_content, (
            "Raw provider wallet address leaked into analytics event"
        )

    async def test_optional_time_since_listing_omitted_when_none(
        self, emitter, events_file
    ):
        set_emitter(emitter)

        await emit_provider_first_revenue_received(
            PROVIDER_WALLET,
            service_id="svc_no_time",
            gross_usdc=0.25,
            # time_since_listing_ms not provided
        )

        stored = _read_events(events_file)
        assert len(stored) == 1
        props = stored[0]["properties"]
        assert "time_since_listing_ms" not in props

    async def test_noop_when_emitter_not_set(self, events_file):
        set_emitter(None)

        # Should not raise even with no emitter wired
        await emit_provider_first_revenue_received(
            PROVIDER_WALLET,
            service_id="svc_noop",
            gross_usdc=0.10,
        )

        assert not events_file.exists() or _read_events(events_file) == []
