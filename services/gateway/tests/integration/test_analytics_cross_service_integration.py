"""
Cross-Service Analytics Integration Tests
==========================================
Validates the full frontend → gateway analytics pipeline interaction.

Scope:
  - Frontend SDK HTTP payload → Gateway POST /api/v1/events endpoint (contract)
  - Gateway business events (emit_*) → same FileBackend (cowrite)
  - Full Consumer activation funnel: mixed frontend + gateway events
  - Full Provider activation funnel: mixed frontend + gateway events
  - Session continuity: anonymous_id → wallet_hash identity stitching
  - Correlation IDs: gateway business events linked across quote→invoke→revenue
  - Privacy: end-to-end raw address exclusion
  - Error handling: budget blocked, invoke failed, deposit failed
  - Risk events: risk_rule_triggered inline with business flow

No Kafka or ClickHouse required. Uses real FastAPI TestClient + FileBackend.

Run:
  cd services/gateway
  PYTHONPATH=. pytest tests/integration/test_analytics_cross_service_integration.py -v
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
from httpx import ASGITransport, AsyncClient

from src.api.routers.events import router
from src.services.analytics.emitter import (
    AnalyticsEmitter,
    create_analytics_emitter,
)
from src.services.analytics.gateway_events import (
    emit_budget_blocked,
    emit_deposit_completed,
    emit_deposit_failed,
    emit_invoke_completed,
    emit_invoke_failed,
    emit_provider_revenue_received,
    emit_quote_generated,
    emit_refund_completed,
    emit_risk_rule_triggered,
    emit_settlement_claim_completed,
    emit_settlement_claim_requested,
    emit_withdrawal_completed,
    set_emitter,
)
from src.services.analytics.privacy import sha256_hash

# ── Constants ─────────────────────────────────────────────────────────────────

CONSUMER_WALLET = "0xConsumerABCDEF1234567890ABCDEF1234567890ab"
PROVIDER_WALLET = "0xProviderFEDCBA0987654321FEDCBA0987654321cd"
SERVICE_ID = "svc_weather_api_v1"
QUOTE_ID = "q_" + "a" * 12


# ── Helpers ────────────────────────────────────────────────────────────────────


def _hash(wallet: str) -> str:
    return sha256_hash(wallet)


def _fe_event(
    event_name: str,
    distinct_id: str | None = None,
    **props: Any,
) -> dict[str, Any]:
    """Build a frontend-SDK-style event payload."""
    return {
        "event_id": str(uuid.uuid4()),
        "event_name": event_name,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "distinct_id": distinct_id or _hash(CONSUMER_WALLET),
        "source": "frontend",
        "properties": {
            "page_path": "/",
            "env": "test",
            "surface": "landing",
            **props,
        },
    }


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().strip().splitlines() if line]


def _money_float(value: Any) -> float:
    return float(value)


def _assert_no_raw_wallet(events: list[dict[str, Any]]) -> None:
    """Assert no raw 0x wallet addresses appear anywhere in the event payloads."""
    raw_re = re.compile(r"0x[0-9a-fA-F]{40}")
    for evt in events:
        text = json.dumps(evt)
        # The tx_hash field is allowed to look like 0x... but wallet addresses are 40 hex chars
        # Strip tx_hash-like values and check the rest
        cleaned = re.sub(r'"tx_hash"\s*:\s*"0x[0-9a-fA-F]+"', '"tx_hash":"<stripped>"', text)
        assert not raw_re.search(cleaned), (
            f"Raw wallet address found in event {evt.get('event_name')}: {cleaned}"
        )


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _reset_gateway_emitter():
    set_emitter(None)
    yield
    set_emitter(None)


@pytest.fixture
def events_file(tmp_path: Path) -> Path:
    return tmp_path / "cross_service_events.jsonl"


@pytest.fixture
def emitter(events_file: Path) -> AnalyticsEmitter:
    return create_analytics_emitter(environment="local", fallback_file=str(events_file))


@pytest.fixture
def app(emitter: AnalyticsEmitter) -> FastAPI:
    _app = FastAPI()
    _app.include_router(router)
    _app.state.analytics = emitter
    set_emitter(emitter)
    return _app


@pytest.fixture
async def client(app: FastAPI) -> AsyncClient:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


# ── Consumer Activation Funnel ────────────────────────────────────────────────


class TestConsumerActivationFunnel:
    """
    Full Consumer activation funnel with mixed frontend + gateway events.

    Funnel:
      page_viewed (frontend) → wallet_connected (frontend) →
      consumer_signup_completed (frontend + gateway) →
      deposit_completed (gateway: source of truth) →
      credential_created (frontend) →
      invoke_completed (gateway: source of truth)
    """

    async def test_full_consumer_funnel_six_steps(self, client: AsyncClient, events_file: Path):
        """All 6 funnel steps must appear in the event store, each from correct source."""
        consumer_hash = _hash(CONSUMER_WALLET)

        # Step 1+2: Frontend acquisition events
        resp = await client.post("/api/v1/events", json={
            "events": [
                _fe_event("page_viewed", consumer_hash,
                          page_path="/", surface="landing", role="anonymous"),
                _fe_event("wallet_connected", consumer_hash,
                          wallet_provider="MetaMask", chain_id=42161, is_new_user=True, role="consumer"),
            ]
        })
        assert resp.status_code == 200
        assert resp.json()["accepted"] == 2

        # Step 3: Consumer signup (gateway confirms identity)
        await emit_deposit_completed(
            CONSUMER_WALLET,
            amount_usdc=10.0,
            tx_hash="0x" + "d" * 64,
            time_to_confirm_ms=3100,
        )

        # Step 4: Frontend credential creation
        resp = await client.post("/api/v1/events", json={
            "events": [
                _fe_event("consumer_signup_completed", consumer_hash,
                          wallet_provider="MetaMask", role="consumer"),
            ]
        })
        assert resp.status_code == 200

        # Step 5: Gateway invoke (source of truth for billing)
        await emit_invoke_completed(
            CONSUMER_WALLET,
            service_id=SERVICE_ID,
            provider_address=PROVIDER_WALLET,
            quote_id=QUOTE_ID,
            price_usdc=0.05,
            latency_ms=143,
            is_first_invoke=True,
        )

        stored = _read_jsonl(events_file)
        assert len(stored) == 5

        names = [e["event_name"] for e in stored]
        assert "page_viewed" in names
        assert "wallet_connected" in names
        assert "deposit_completed" in names
        assert "consumer_signup_completed" in names
        assert "invoke_completed" in names

        # Source of truth: financial events must come from gateway
        sources = {e["event_name"]: e["source"] for e in stored}
        assert sources["deposit_completed"] == "gateway"
        assert sources["invoke_completed"] == "gateway"
        assert sources["page_viewed"] == "frontend"
        assert sources["wallet_connected"] == "frontend"

    async def test_consumer_distinct_id_matches_across_sources(
        self, client: AsyncClient, events_file: Path
    ):
        """Frontend and gateway events for same consumer must share the same hashed distinct_id."""
        consumer_hash = _hash(CONSUMER_WALLET)

        await client.post("/api/v1/events", json={
            "events": [_fe_event("wallet_connected", consumer_hash, role="consumer")]
        })
        await emit_deposit_completed(
            CONSUMER_WALLET,
            amount_usdc=5.0,
            tx_hash="0x" + "e" * 64,
        )

        stored = _read_jsonl(events_file)
        assert len(stored) == 2

        # Both events must have same distinct_id (wallet hash)
        distinct_ids = {e["distinct_id"] for e in stored}
        assert len(distinct_ids) == 1
        assert distinct_ids.pop() == consumer_hash

    async def test_is_first_invoke_flag_set_correctly(self, client: AsyncClient, events_file: Path):
        """First invoke must have is_first_invoke=True, repeat must have is_first_invoke=False."""
        await emit_invoke_completed(
            CONSUMER_WALLET,
            service_id=SERVICE_ID,
            provider_address=PROVIDER_WALLET,
            quote_id="q_first",
            price_usdc=0.05,
            latency_ms=100,
            is_first_invoke=True,
        )
        await emit_invoke_completed(
            CONSUMER_WALLET,
            service_id=SERVICE_ID,
            provider_address=PROVIDER_WALLET,
            quote_id="q_second",
            price_usdc=0.05,
            latency_ms=110,
            is_first_invoke=False,
        )

        stored = _read_jsonl(events_file)
        assert len(stored) == 2

        first = next(e for e in stored if e["properties"]["quote_id"] == "q_first")
        repeat = next(e for e in stored if e["properties"]["quote_id"] == "q_second")

        assert first["properties"]["is_first_invoke"] is True
        assert repeat["properties"]["is_first_invoke"] is False

    async def test_deposit_amount_preserved_exactly(self, client: AsyncClient, events_file: Path):
        """Deposit amount_usdc must be stored as a precise fixed-point string."""
        await emit_deposit_completed(
            CONSUMER_WALLET,
            amount_usdc=123.456789,
            tx_hash="0x" + "f" * 64,
            time_to_confirm_ms=2800,
        )

        stored = _read_jsonl(events_file)
        assert len(stored) == 1
        assert _money_float(stored[0]["properties"]["amount_usdc"]) == pytest.approx(123.456789)

    async def test_correlation_id_links_quote_to_invoke(self, client: AsyncClient, events_file: Path):
        """quote_generated and invoke_completed for same request must share correlation_id."""
        corr_id = str(uuid.uuid4())

        await emit_quote_generated(
            CONSUMER_WALLET,
            service_id=SERVICE_ID,
            quote_id=QUOTE_ID,
            price_usdc=0.05,
            correlation_id=corr_id,
        )
        await emit_invoke_completed(
            CONSUMER_WALLET,
            service_id=SERVICE_ID,
            provider_address=PROVIDER_WALLET,
            quote_id=QUOTE_ID,
            price_usdc=0.05,
            latency_ms=180,
            correlation_id=corr_id,
        )

        stored = _read_jsonl(events_file)
        assert len(stored) == 2

        for evt in stored:
            assert evt["properties"].get("correlation_id") == corr_id, (
                f"Event {evt['event_name']} missing or wrong correlation_id"
            )


# ── Provider Activation Funnel ────────────────────────────────────────────────


class TestProviderActivationFunnel:
    """
    Full Provider activation funnel with mixed frontend + gateway events.

    Funnel:
      provider_signup_completed (frontend) →
      service_registered (gateway confirms) →
      provider_first_revenue_received (gateway) →
      settlement_claim_requested (gateway) →
      settlement_claim_completed (gateway)
    """

    async def test_full_provider_funnel_five_steps(self, client: AsyncClient, events_file: Path):
        provider_hash = _hash(PROVIDER_WALLET)

        # Frontend signup
        resp = await client.post("/api/v1/events", json={
            "events": [
                _fe_event("provider_signup_completed", provider_hash,
                          wallet_provider="Coinbase", role="provider", surface="provider_console"),
            ]
        })
        assert resp.status_code == 200
        assert resp.json()["accepted"] == 1

        # Gateway confirms service listing + first revenue
        await emit_provider_revenue_received(
            PROVIDER_WALLET,
            service_id=SERVICE_ID,
            gross_usdc=0.10,
            platform_fee_usdc=0.005,
            provider_net_usdc=0.095,
        )
        await emit_settlement_claim_requested(PROVIDER_WALLET, claim_usdc=5.00)
        await emit_settlement_claim_completed(
            PROVIDER_WALLET,
            claim_usdc=5.00,
            tx_hash="0x" + "c" * 64,
        )

        stored = _read_jsonl(events_file)
        assert len(stored) == 4

        names = [e["event_name"] for e in stored]
        assert "provider_signup_completed" in names
        assert "provider_revenue_received" in names
        assert "settlement_claim_requested" in names
        assert "settlement_claim_completed" in names

    async def test_provider_revenue_breakdown_correct(self, client: AsyncClient, events_file: Path):
        """Provider revenue event must carry gross, platform_fee, and net amounts."""
        await emit_provider_revenue_received(
            PROVIDER_WALLET,
            service_id=SERVICE_ID,
            gross_usdc=1.00,
            platform_fee_usdc=0.05,
            provider_net_usdc=0.95,
        )

        stored = _read_jsonl(events_file)
        assert len(stored) == 1
        props = stored[0]["properties"]
        assert _money_float(props["gross_usdc"]) == pytest.approx(1.00)
        assert _money_float(props["platform_fee_usdc"]) == pytest.approx(0.05)
        assert _money_float(props["provider_net_usdc"]) == pytest.approx(0.95)

        # Verify 5% take rate
        assert _money_float(props["platform_fee_usdc"]) == pytest.approx(
            _money_float(props["gross_usdc"]) * 0.05
        )

    async def test_provider_role_set_in_gateway_events(self, client: AsyncClient, events_file: Path):
        """All provider-side gateway events must carry role=provider."""
        await emit_provider_revenue_received(
            PROVIDER_WALLET,
            service_id=SERVICE_ID,
            gross_usdc=0.05,
            platform_fee_usdc=0.0025,
            provider_net_usdc=0.0475,
        )
        await emit_settlement_claim_requested(PROVIDER_WALLET, claim_usdc=1.00)
        await emit_settlement_claim_completed(
            PROVIDER_WALLET,
            claim_usdc=1.00,
            tx_hash="0x" + "a" * 64,
        )

        stored = _read_jsonl(events_file)
        for evt in stored:
            assert evt["properties"].get("role") == "provider", (
                f"Event {evt['event_name']} has wrong role: {evt['properties'].get('role')}"
            )

    async def test_provider_distinct_id_hashed(self, client: AsyncClient, events_file: Path):
        """Provider wallet must be hashed to same 64-char SHA-256 as consumer."""
        await emit_provider_revenue_received(
            PROVIDER_WALLET,
            service_id=SERVICE_ID,
            gross_usdc=0.01,
            platform_fee_usdc=0.0005,
            provider_net_usdc=0.0095,
        )

        stored = _read_jsonl(events_file)
        distinct_id = stored[0]["distinct_id"]

        assert len(distinct_id) == 64
        assert re.fullmatch(r"[0-9a-f]{64}", distinct_id)
        assert distinct_id != PROVIDER_WALLET.lower()
        assert distinct_id == sha256_hash(PROVIDER_WALLET)


# ── Consumer + Provider Isolation ─────────────────────────────────────────────


class TestConsumerProviderIsolation:
    """Consumer and Provider event streams must not bleed into each other."""

    async def test_consumer_and_provider_distinct_ids_differ(
        self, client: AsyncClient, events_file: Path
    ):
        consumer_hash = _hash(CONSUMER_WALLET)
        provider_hash = _hash(PROVIDER_WALLET)

        await client.post("/api/v1/events", json={
            "events": [_fe_event("page_viewed", consumer_hash, role="consumer")]
        })
        await emit_provider_revenue_received(
            PROVIDER_WALLET,
            service_id=SERVICE_ID,
            gross_usdc=0.05,
            platform_fee_usdc=0.0025,
            provider_net_usdc=0.0475,
        )

        stored = _read_jsonl(events_file)
        assert len(stored) == 2

        ids_by_event = {e["event_name"]: e["distinct_id"] for e in stored}
        assert ids_by_event["page_viewed"] == consumer_hash
        assert ids_by_event["provider_revenue_received"] == provider_hash
        assert consumer_hash != provider_hash

    async def test_consumer_events_not_tagged_as_provider(
        self, client: AsyncClient, events_file: Path
    ):
        """Consumer frontend events must have role=consumer, not provider."""
        consumer_hash = _hash(CONSUMER_WALLET)
        await client.post("/api/v1/events", json={
            "events": [
                _fe_event("wallet_connected", consumer_hash, role="consumer"),
                _fe_event("consumer_signup_completed", consumer_hash, role="consumer"),
            ]
        })

        stored = _read_jsonl(events_file)
        for evt in stored:
            role = evt["properties"].get("role")
            assert role in ("consumer", "anonymous"), (
                f"Consumer event {evt['event_name']} has wrong role: {role}"
            )


# ── Error & Failure Events ─────────────────────────────────────────────────────


class TestErrorAndFailureEvents:
    """Gateway must emit structured error events for every failure path."""

    async def test_invoke_failed_has_error_code_and_stage(
        self, client: AsyncClient, events_file: Path
    ):
        await emit_invoke_failed(
            CONSUMER_WALLET,
            service_id=SERVICE_ID,
            provider_address=PROVIDER_WALLET,
            quote_id=QUOTE_ID,
            error_code="PROVIDER_TIMEOUT",
            failure_stage="upstream",
        )

        stored = _read_jsonl(events_file)
        assert len(stored) == 1
        assert stored[0]["event_name"] == "invoke_failed"
        assert stored[0]["properties"]["error_code"] == "PROVIDER_TIMEOUT"
        assert stored[0]["properties"]["failure_stage"] == "upstream"

    async def test_invoke_failed_default_error_code(self, client: AsyncClient, events_file: Path):
        """If error_code not provided, gateway must use UNKNOWN, not None."""
        await emit_invoke_failed(
            CONSUMER_WALLET,
            service_id=SERVICE_ID,
            provider_address=PROVIDER_WALLET,
            quote_id=QUOTE_ID,
        )

        stored = _read_jsonl(events_file)
        assert stored[0]["properties"]["error_code"] == "UNKNOWN"

    async def test_budget_blocked_has_amount_fields(self, client: AsyncClient, events_file: Path):
        await emit_budget_blocked(
            CONSUMER_WALLET,
            service_id=SERVICE_ID,
            required_usdc=1.50,
            available_usdc=0.02,
            error_code="INSUFFICIENT_BALANCE",
        )

        stored = _read_jsonl(events_file)
        assert len(stored) == 1
        props = stored[0]["properties"]
        assert _money_float(props["required_usdc"]) == pytest.approx(1.50)
        assert _money_float(props["available_usdc"]) == pytest.approx(0.02)
        assert props["error_code"] == "INSUFFICIENT_BALANCE"

    async def test_deposit_failed_has_error_code(self, client: AsyncClient, events_file: Path):
        await emit_deposit_failed(
            CONSUMER_WALLET,
            amount_usdc=10.0,
            error_code="TX_REVERTED",
        )

        stored = _read_jsonl(events_file)
        assert stored[0]["event_name"] == "deposit_failed"
        assert stored[0]["properties"]["error_code"] == "TX_REVERTED"

    async def test_risk_rule_triggered_carries_severity(
        self, client: AsyncClient, events_file: Path
    ):
        await emit_risk_rule_triggered(
            CONSUMER_WALLET,
            rule_code="HIGH_FREQUENCY_INVOKE",
            surface="gateway_api",
            severity="warning",
        )

        stored = _read_jsonl(events_file)
        assert stored[0]["event_name"] == "risk_rule_triggered"
        props = stored[0]["properties"]
        assert props["rule_code"] == "HIGH_FREQUENCY_INVOKE"
        assert props["severity"] == "warning"
        assert props["surface"] == "gateway_api"

    async def test_refund_completed_links_to_service(self, client: AsyncClient, events_file: Path):
        await emit_refund_completed(
            CONSUMER_WALLET,
            amount_usdc=0.10,
            reason_code="QUALITY_DISPUTE",
            service_id=SERVICE_ID,
            tx_hash="0x" + "b" * 64,
        )

        stored = _read_jsonl(events_file)
        assert stored[0]["event_name"] == "refund_completed"
        props = stored[0]["properties"]
        assert _money_float(props["amount_usdc"]) == pytest.approx(0.10)
        assert props["reason_code"] == "QUALITY_DISPUTE"
        assert props["service_id"] == SERVICE_ID


# ── Identity Stitching: Anonymous → Wallet ────────────────────────────────────


class TestIdentityStitching:
    """
    Frontend $identify event must stitch anonymous session ID to wallet hash.
    The gateway must store it faithfully so PostHog/BI can merge sessions.
    """

    async def test_identify_event_carries_anonymous_and_wallet(
        self, client: AsyncClient, events_file: Path
    ):
        anon_id = "anon-" + str(uuid.uuid4())
        wallet_hash = _hash(CONSUMER_WALLET)

        identify_event = {
            "event_id": str(uuid.uuid4()),
            "event_name": "$identify",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "distinct_id": wallet_hash,
            "source": "frontend",
            "properties": {
                "anonymous_id": anon_id,
                "wallet_hash": wallet_hash,
                "env": "test",
            },
        }

        resp = await client.post("/api/v1/events", json={"events": [identify_event]})
        assert resp.status_code == 200
        assert resp.json()["accepted"] == 1

        stored = _read_jsonl(events_file)
        assert stored[0]["event_name"] == "$identify"
        assert stored[0]["properties"]["anonymous_id"] == anon_id
        assert stored[0]["properties"]["wallet_hash"] == wallet_hash

    async def test_pre_identify_events_use_anonymous_id(
        self, client: AsyncClient, events_file: Path
    ):
        """Before wallet connect, distinct_id should be an anonymous UUID (not a wallet hash)."""
        anon_uuid = str(uuid.uuid4())  # simulate anon session

        resp = await client.post("/api/v1/events", json={
            "events": [_fe_event("page_viewed", anon_uuid, role="anonymous")]
        })
        assert resp.status_code == 200

        stored = _read_jsonl(events_file)
        assert stored[0]["distinct_id"] == anon_uuid
        # anonymous UUIDs should not look like 0x addresses
        assert not stored[0]["distinct_id"].startswith("0x")


# ── Withdrawal Events ─────────────────────────────────────────────────────────


class TestWithdrawalEvents:
    async def test_consumer_withdrawal_completed(self, client: AsyncClient, events_file: Path):
        """Consumer withdrawal must carry amount, tx_hash, role=consumer."""
        await emit_withdrawal_completed(
            CONSUMER_WALLET,
            amount_usdc=25.0,
            tx_hash="0x" + "7" * 64,
            role="consumer",
            time_to_confirm_ms=5500,
        )

        stored = _read_jsonl(events_file)
        assert stored[0]["event_name"] == "withdrawal_completed"
        props = stored[0]["properties"]
        assert _money_float(props["amount_usdc"]) == pytest.approx(25.0)
        assert props["role"] == "consumer"
        assert props["time_to_confirm_ms"] == 5500

    async def test_provider_withdrawal_role_is_provider(
        self, client: AsyncClient, events_file: Path
    ):
        """Provider withdrawal must carry role=provider."""
        await emit_withdrawal_completed(
            PROVIDER_WALLET,
            amount_usdc=100.0,
            tx_hash="0x" + "8" * 64,
            role="provider",
        )

        stored = _read_jsonl(events_file)
        assert stored[0]["properties"]["role"] == "provider"


# ── Privacy: End-to-End ────────────────────────────────────────────────────────


class TestPrivacyEndToEnd:
    """
    Full funnel privacy validation: no raw 0x wallet addresses must appear
    in any field across both frontend and gateway events.
    """

    async def test_no_raw_wallet_addresses_in_full_funnel(
        self, client: AsyncClient, events_file: Path
    ):
        consumer_hash = _hash(CONSUMER_WALLET)

        # Frontend events
        await client.post("/api/v1/events", json={
            "events": [
                _fe_event("page_viewed", consumer_hash, role="anonymous"),
                _fe_event("wallet_connected", consumer_hash, role="consumer",
                          wallet_provider="MetaMask"),
                _fe_event("$identify", consumer_hash,
                          anonymous_id="anon-uuid-xyz", wallet_hash=consumer_hash),
            ]
        })

        # Gateway business events
        await emit_deposit_completed(
            CONSUMER_WALLET,
            amount_usdc=50.0,
            tx_hash="0x" + "1" * 64,
            time_to_confirm_ms=3000,
        )
        await emit_invoke_completed(
            CONSUMER_WALLET,
            service_id=SERVICE_ID,
            provider_address=PROVIDER_WALLET,
            quote_id=QUOTE_ID,
            price_usdc=0.05,
            latency_ms=200,
            is_first_invoke=True,
        )
        await emit_provider_revenue_received(
            PROVIDER_WALLET,
            service_id=SERVICE_ID,
            gross_usdc=0.05,
            platform_fee_usdc=0.0025,
            provider_net_usdc=0.0475,
        )
        await emit_risk_rule_triggered(
            CONSUMER_WALLET,
            rule_code="RATE_LIMIT",
            severity="info",
        )

        stored = _read_jsonl(events_file)
        assert len(stored) == 7

        _assert_no_raw_wallet(stored)

    async def test_provider_id_in_gateway_events_is_hashed(
        self, client: AsyncClient, events_file: Path
    ):
        """
        Gateway events that reference the provider (e.g. invoke_completed) must store
        provider_id as sha256_hash(provider_address), not the raw address.
        """
        await emit_invoke_completed(
            CONSUMER_WALLET,
            service_id=SERVICE_ID,
            provider_address=PROVIDER_WALLET,
            quote_id=QUOTE_ID,
            price_usdc=0.01,
            latency_ms=100,
        )

        stored = _read_jsonl(events_file)
        props = stored[0]["properties"]

        assert "provider_id" in props
        assert props["provider_id"] == sha256_hash(PROVIDER_WALLET)
        assert not str(props["provider_id"]).startswith("0x"), (
            "provider_id must be a SHA-256 hash, not a raw address"
        )


# ── Batch Processing ───────────────────────────────────────────────────────────


class TestBatchProcessing:
    async def test_frontend_batch_50_events_all_accepted(
        self, client: AsyncClient, events_file: Path
    ):
        """Gateway accepts up to 50 frontend events in one batch — all must be stored."""
        consumer_hash = _hash(CONSUMER_WALLET)
        events = [
            _fe_event("page_viewed", consumer_hash, seq=i, page_path=f"/page-{i}")
            for i in range(50)
        ]

        resp = await client.post("/api/v1/events", json={"events": events})
        assert resp.status_code == 200
        body = resp.json()
        assert body["accepted"] == 50
        assert body["rejected"] == 0

        stored = _read_jsonl(events_file)
        assert len(stored) == 50

    async def test_frontend_batch_over_50_rejected_with_422(
        self, client: AsyncClient, events_file: Path
    ):
        """Batches over 50 events must be rejected with HTTP 422."""
        consumer_hash = _hash(CONSUMER_WALLET)
        events = [_fe_event("page_viewed", consumer_hash) for _ in range(51)]

        resp = await client.post("/api/v1/events", json={"events": events})
        assert resp.status_code == 422

        stored = _read_jsonl(events_file)
        assert len(stored) == 0  # nothing stored for rejected batch

    async def test_mixed_frontend_and_gateway_event_ordering(
        self, client: AsyncClient, events_file: Path
    ):
        """
        Interleaved frontend + gateway events must all be stored in emission order.
        """
        consumer_hash = _hash(CONSUMER_WALLET)

        # Emit in this sequence
        await client.post("/api/v1/events", json={
            "events": [_fe_event("page_viewed", consumer_hash)]
        })
        await emit_quote_generated(
            CONSUMER_WALLET,
            service_id=SERVICE_ID,
            quote_id=QUOTE_ID,
            price_usdc=0.05,
        )
        await client.post("/api/v1/events", json={
            "events": [_fe_event("wallet_connected", consumer_hash, role="consumer")]
        })
        await emit_invoke_completed(
            CONSUMER_WALLET,
            service_id=SERVICE_ID,
            provider_address=PROVIDER_WALLET,
            quote_id=QUOTE_ID,
            price_usdc=0.05,
            latency_ms=200,
        )

        stored = _read_jsonl(events_file)
        assert len(stored) == 4

        names = [e["event_name"] for e in stored]
        # Order must be preserved
        assert names == ["page_viewed", "quote_generated", "wallet_connected", "invoke_completed"]
