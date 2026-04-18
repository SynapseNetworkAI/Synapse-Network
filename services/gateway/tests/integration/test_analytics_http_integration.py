"""
Analytics HTTP Integration Tests
=================================
Tests the complete HTTP flow: frontend batch → POST /api/v1/events → FileBackend.

No Kafka or ClickHouse required. Uses the real FastAPI app with httpx AsyncClient.
Validates:
  - Request/response contract between frontend SDK and gateway
  - All 20 allowed frontend event names are accepted
  - Schema validation rejects bad inputs
  - Events are correctly stored with required fields
  - Privacy: raw wallet addresses rejected at the door
  - Gateway business events (emit_*) write to same backend

Run:
  cd services/gateway
  pytest tests/integration/test_analytics_http_integration.py -v
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.api.routers.events import ALLOWED_FRONTEND_EVENTS, router
from src.services.analytics.emitter import (
    AnalyticsEmitter,
    FileBackend,
    create_analytics_emitter,
)
from src.services.analytics.gateway_events import (
    emit_deposit_completed,
    emit_invoke_completed,
    emit_provider_revenue_received,
    set_emitter,
)
from src.services.analytics.privacy import sha256_hash


# ── Helpers ──────────────────────────────────────────────────────────────────

CONSUMER_WALLET = "0xConsumerABCDEF1234567890ABCDEF1234567890ab"
PROVIDER_WALLET = "0xProviderFEDCBA0987654321FEDCBA0987654321cd"


def _hashed(wallet: str) -> str:
    return sha256_hash(wallet)


def _event(
    event_name: str = "page_viewed",
    distinct_id: str | None = None,
    **props: Any,
) -> dict[str, Any]:
    return {
        "event_id": str(uuid.uuid4()),
        "event_name": event_name,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "distinct_id": distinct_id or _hashed(CONSUMER_WALLET),
        "source": "frontend",
        "properties": {
            "page_path": "/",
            "role": "anonymous",
            "env": "test",
            **props,
        },
    }


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().strip().splitlines() if line]


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _reset_emitter():
    set_emitter(None)
    yield
    set_emitter(None)


@pytest.fixture
def events_file(tmp_path: Path) -> Path:
    return tmp_path / "events.jsonl"


@pytest.fixture
def app_and_emitter(events_file: Path):
    app = FastAPI()
    app.include_router(router)
    emitter = create_analytics_emitter(environment="local", fallback_file=str(events_file))
    app.state.analytics = emitter
    return app, emitter


@pytest.fixture
async def http_client(app_and_emitter):
    app, emitter = app_and_emitter
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, emitter


# ── Contract: valid events accepted ──────────────────────────────────────────


class TestValidEventsAccepted:
    async def test_single_event_returns_accepted_1(self, http_client):
        client, _ = http_client
        resp = await client.post("/api/v1/events", json={"events": [_event("page_viewed")]})
        assert resp.status_code == 200
        body = resp.json()
        assert body["accepted"] == 1
        assert body["rejected"] == 0

    async def test_batch_of_5_all_accepted(self, http_client):
        client, _ = http_client
        names = ["page_viewed", "cta_clicked", "wallet_connect_started",
                 "wallet_connected", "role_selected"]
        events = [_event(n) for n in names]
        resp = await client.post("/api/v1/events", json={"events": events})
        assert resp.status_code == 200
        body = resp.json()
        assert body["accepted"] == 5
        assert body["rejected"] == 0

    async def test_all_allowed_event_names_accepted(self, http_client):
        """Every event name in ALLOWED_FRONTEND_EVENTS must be accepted."""
        client, _ = http_client
        # Map events that need specific properties
        special_props = {
            "cta_clicked": {"cta_id": "hero", "cta_text": "Get Started", "cta_location": "hero"},
            "service_search_executed": {"query": "weather", "results_count": 3, "surface": "landing"},
            "service_detail_viewed": {"service_id": "svc_1", "provider_id": "p1", "price_usdc": 0.01},
            "deposit_started": {"amount_usdc": 10.0, "token_symbol": "USDC", "chain_id": 42161},
            "deposit_permit_signed": {"amount_usdc": 10.0, "token_symbol": "USDC"},
            "service_manifest_step_completed": {"step_name": "pricing", "step_number": 1},
            "withdrawal_requested": {"amount_usdc": 5.0},
            "receipt_viewed": {"receipt_id": "r_1", "service_id": "svc_1"},
        }
        events = [
            _event(name, **special_props.get(name, {}))
            for name in ALLOWED_FRONTEND_EVENTS
        ]
        resp = await client.post("/api/v1/events", json={"events": events})
        assert resp.status_code == 200
        body = resp.json()
        assert body["accepted"] == len(ALLOWED_FRONTEND_EVENTS)
        assert body["rejected"] == 0, f"Unexpected rejections: {body['errors']}"


# ── Contract: invalid inputs rejected ────────────────────────────────────────


class TestInvalidInputsRejected:
    async def test_unknown_event_name_returns_422(self, http_client):
        client, _ = http_client
        resp = await client.post("/api/v1/events", json={"events": [_event("unknown_event")]})
        assert resp.status_code == 422

    async def test_raw_wallet_address_as_distinct_id_rejected(self, http_client):
        client, _ = http_client
        raw_event = _event("page_viewed")
        raw_event["distinct_id"] = "0x1234567890123456789012345678901234567890"
        resp = await client.post("/api/v1/events", json={"events": [raw_event]})
        assert resp.status_code == 422

    async def test_empty_batch_rejected(self, http_client):
        client, _ = http_client
        resp = await client.post("/api/v1/events", json={"events": []})
        assert resp.status_code == 422

    async def test_batch_over_50_rejected(self, http_client):
        client, _ = http_client
        events = [_event("page_viewed") for _ in range(51)]
        resp = await client.post("/api/v1/events", json={"events": events})
        assert resp.status_code == 422

    async def test_missing_events_field_rejected(self, http_client):
        client, _ = http_client
        resp = await client.post("/api/v1/events", json={"data": []})
        assert resp.status_code == 422


# ── Storage: events written to backend ───────────────────────────────────────


class TestEventsStoredCorrectly:
    async def test_event_written_to_file(self, http_client, events_file: Path):
        client, _ = http_client
        distinct_id = _hashed(CONSUMER_WALLET)
        await client.post("/api/v1/events", json={"events": [_event("page_viewed", distinct_id=distinct_id)]})

        stored = _read_jsonl(events_file)
        assert len(stored) == 1
        evt = stored[0]
        assert evt["event_name"] == "page_viewed"
        assert evt["distinct_id"] == distinct_id
        assert evt["source"] == "frontend"
        assert "event_id" in evt
        assert "timestamp" in evt

    async def test_batch_written_in_order(self, http_client, events_file: Path):
        client, _ = http_client
        names = ["wallet_connect_started", "wallet_connected", "role_selected"]
        events = [_event(n) for n in names]
        await client.post("/api/v1/events", json={"events": events})

        stored = _read_jsonl(events_file)
        assert len(stored) == 3
        assert [s["event_name"] for s in stored] == names

    async def test_custom_properties_preserved(self, http_client, events_file: Path):
        client, _ = http_client
        await client.post("/api/v1/events", json={"events": [
            _event("cta_clicked",
                   cta_id="hero_signup",
                   cta_text="Get Started",
                   cta_location="hero")
        ]})

        stored = _read_jsonl(events_file)
        assert len(stored) == 1
        props = stored[0]["properties"]
        assert props["cta_id"] == "hero_signup"
        assert props["cta_text"] == "Get Started"
        assert props["cta_location"] == "hero"

    async def test_event_id_preserved_from_frontend(self, http_client, events_file: Path):
        """Gateway must echo back the event_id the frontend generated."""
        client, _ = http_client
        original_id = str(uuid.uuid4())
        evt = _event("page_viewed")
        evt["event_id"] = original_id
        await client.post("/api/v1/events", json={"events": [evt]})

        stored = _read_jsonl(events_file)
        assert stored[0]["event_id"] == original_id

    async def test_source_always_frontend(self, http_client, events_file: Path):
        client, _ = http_client
        await client.post("/api/v1/events", json={"events": [_event("page_viewed")]})
        stored = _read_jsonl(events_file)
        assert stored[0]["source"] == "frontend"


# ── Privacy ───────────────────────────────────────────────────────────────────


class TestPrivacyBoundary:
    async def test_hashed_distinct_id_accepted_and_stored(self, http_client, events_file: Path):
        client, _ = http_client
        hashed = _hashed(CONSUMER_WALLET)
        await client.post("/api/v1/events", json={"events": [_event("page_viewed", distinct_id=hashed)]})

        stored = _read_jsonl(events_file)
        assert stored[0]["distinct_id"] == hashed
        assert not stored[0]["distinct_id"].startswith("0x")

    async def test_identify_event_links_anonymous_to_wallet(self, http_client, events_file: Path):
        """$identify event must carry anonymous_id and wallet_hash in properties."""
        client, _ = http_client
        anon_id = _hashed("anon-uuid-xyz")
        wallet_hash = _hashed(CONSUMER_WALLET)
        evt = _event("$identify", distinct_id=wallet_hash,
                     anonymous_id=anon_id, wallet_hash=wallet_hash)
        await client.post("/api/v1/events", json={"events": [evt]})

        stored = _read_jsonl(events_file)
        assert stored[0]["event_name"] == "$identify"
        assert stored[0]["properties"]["wallet_hash"] == wallet_hash
        assert stored[0]["properties"]["anonymous_id"] == anon_id


# ── Frontend + Gateway co-write to same backend ───────────────────────────────


class TestFrontendGatewayCowrite:
    """
    Verifies that frontend HTTP events and gateway business events both flow into
    the same FileBackend, simulating the combined production pipeline without Kafka.
    """

    async def test_frontend_and_gateway_events_coexist(self, app_and_emitter, events_file: Path):
        """
        Scenario: user opens page (frontend) → gateway processes invoke (gateway).
        Both events must land in the same event store.
        """
        app, emitter = app_and_emitter
        set_emitter(emitter)

        # Step 1: frontend emits page_viewed over HTTP
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            hashed_consumer = _hashed(CONSUMER_WALLET)
            resp = await client.post("/api/v1/events", json={
                "events": [_event("page_viewed", distinct_id=hashed_consumer)]
            })
            assert resp.status_code == 200

        # Step 2: gateway emits invoke_completed directly (as business logic would)
        await emit_invoke_completed(
            CONSUMER_WALLET,
            service_id="svc_test",
            provider_address=PROVIDER_WALLET,
            quote_id="q_test_001",
            price_usdc=0.05,
            latency_ms=200,
            is_first_invoke=True,
        )

        stored = _read_jsonl(events_file)
        assert len(stored) == 2

        event_names = {e["event_name"] for e in stored}
        assert "page_viewed" in event_names
        assert "invoke_completed" in event_names

        # Frontend event: source=frontend, gateway event: source=gateway
        sources = {e["event_name"]: e["source"] for e in stored}
        assert sources["page_viewed"] == "frontend"
        assert sources["invoke_completed"] == "gateway"

    async def test_consumer_funnel_mixed_sources(self, app_and_emitter, events_file: Path):
        """
        Full consumer activation funnel with mixed frontend/gateway events:
          page_viewed (frontend) → wallet_connected (frontend) →
          deposit_completed (gateway) → invoke_completed (gateway)
        """
        app, emitter = app_and_emitter
        set_emitter(emitter)

        hashed_consumer = _hashed(CONSUMER_WALLET)
        hashed_provider = _hashed(PROVIDER_WALLET)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            # Frontend events
            await client.post("/api/v1/events", json={
                "events": [
                    _event("page_viewed", distinct_id=hashed_consumer, page_path="/"),
                    _event("wallet_connected", distinct_id=hashed_consumer,
                           wallet_provider="MetaMask", chain_id=42161, is_new_user=True),
                ]
            })

        # Gateway events (source of truth for financial events)
        await emit_deposit_completed(
            CONSUMER_WALLET,
            amount_usdc=50.0,
            tx_hash="0xdeadbeef" + "0" * 56,
            time_to_confirm_ms=8500,
        )
        await emit_invoke_completed(
            CONSUMER_WALLET,
            service_id="svc_weather",
            provider_address=PROVIDER_WALLET,
            quote_id="q_001",
            price_usdc=0.01,
            latency_ms=145,
            is_first_invoke=True,
        )
        await emit_provider_revenue_received(
            PROVIDER_WALLET,
            service_id="svc_weather",
            gross_usdc=0.01,
            platform_fee_usdc=0.0005,
            provider_net_usdc=0.0095,
        )

        stored = _read_jsonl(events_file)
        assert len(stored) == 5

        names = [e["event_name"] for e in stored]
        assert "page_viewed" in names
        assert "wallet_connected" in names
        assert "deposit_completed" in names
        assert "invoke_completed" in names
        assert "provider_revenue_received" in names

        # Verify first_invoke flag
        invoke_evt = next(e for e in stored if e["event_name"] == "invoke_completed")
        assert invoke_evt["properties"]["is_first_invoke"] is True

        # Verify deposit amount
        deposit_evt = next(e for e in stored if e["event_name"] == "deposit_completed")
        assert deposit_evt["properties"]["amount_usdc"] == "50.000000"
        assert deposit_evt["properties"]["time_to_confirm_ms"] == 8500

        # Verify provider revenue breakdown
        rev_evt = next(e for e in stored if e["event_name"] == "provider_revenue_received")
        assert rev_evt["properties"]["gross_usdc"] == "0.010000"
        assert rev_evt["properties"]["platform_fee_usdc"] == "0.000500"

        # Privacy: no raw 0x addresses in any event
        all_json = events_file.read_text()
        for line in all_json.strip().splitlines():
            data = json.loads(line)
            self._assert_no_raw_address(data)

    def _assert_no_raw_address(self, obj: Any, path: str = "") -> None:
        if isinstance(obj, dict):
            for k, v in obj.items():
                self._assert_no_raw_address(v, f"{path}.{k}" if path else k)
        elif isinstance(obj, str):
            import re
            if re.fullmatch(r"0x[0-9a-fA-F]{40}", obj):
                raise AssertionError(f"Raw wallet address at {path}: {obj}")
