"""
E2E Analytics Pipeline Tests — Kafka → ClickHouse

Verifies that analytics events emitted via KafkaBackend flow through
the Kafka topic, are consumed by the ClickHouse Kafka Engine, and
land correctly in the synapse_analytics.events table.

# Run (requires Kafka + ClickHouse via docker-compose):
# ANALYTICS_TEST_E2E=true pytest tests/e2e/test_analytics_e2e_pipeline.py -v --timeout=60
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import uuid

import httpx
import pytest

from src.services.analytics.emitter import AnalyticsEvent, KafkaBackend

# ── Gate: skip entire module unless E2E infra is explicitly enabled ───────────

E2E_AVAILABLE = os.getenv("ANALYTICS_TEST_E2E", "").lower() == "true"

pytestmark = pytest.mark.skipif(
    not E2E_AVAILABLE,
    reason="E2E infra not available (set ANALYTICS_TEST_E2E=true)",
)

# ── Helpers ──────────────────────────────────────────────────────────────────


async def query_clickhouse(sql: str) -> list[dict]:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            os.getenv("ANALYTICS_CLICKHOUSE_URL", "http://localhost:8123"),
            params={"query": sql, "default_format": "JSONEachRow"},
        )
        if resp.status_code != 200:
            raise RuntimeError(f"ClickHouse query failed: {resp.text}")
        if not resp.text.strip():
            return []
        return [json.loads(line) for line in resp.text.strip().split("\n") if line]


def _make_marker() -> str:
    return f"e2e_test_{uuid.uuid4().hex[:12]}"


def _make_event(
    event_name: str,
    distinct_id: str,
    *,
    role: str = "consumer",
    surface: str = "api",
    env: str = "test",
    event_id: str | None = None,
    extra_props: dict | None = None,
) -> AnalyticsEvent:
    properties: dict = {
        "role": role,
        "surface": surface,
        "env": env,
    }
    if extra_props:
        properties.update(extra_props)
    return AnalyticsEvent(
        event_name=event_name,
        distinct_id=distinct_id,
        source="gateway",
        properties=properties,
        event_id=event_id,
    )


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture()
async def kafka_backend():
    backend = KafkaBackend(
        bootstrap_servers=os.getenv("ANALYTICS_KAFKA_BOOTSTRAP_SERVERS", "localhost:9092"),
        topic=os.getenv("ANALYTICS_KAFKA_TOPIC", "synapse.analytics.events"),
    )
    yield backend
    await backend.close()


# ── Tests ────────────────────────────────────────────────────────────────────


async def test_event_flows_to_clickhouse(kafka_backend: KafkaBackend):
    """Full pipeline: emit one invoke_completed event, verify it lands in ClickHouse."""
    marker = _make_marker()

    event = _make_event(
        "invoke_completed",
        marker,
        extra_props={
            "service_id": "svc_abc123",
            "price_usdc": 0.05,
            "latency_ms": 142,
        },
    )
    await kafka_backend.send(event)

    # Allow time for Kafka Engine to consume and materialize
    await asyncio.sleep(10)

    rows = await query_clickhouse(
        f"""
        SELECT event_id, event_name, distinct_id, source, role, surface, env,
               JSONExtractString(properties, 'service_id') AS service_id,
               JSONExtractFloat(properties, 'price_usdc')  AS price_usdc,
               JSONExtractUInt(properties, 'latency_ms')   AS latency_ms
        FROM synapse_analytics.events
        WHERE distinct_id = '{marker}'
        LIMIT 1
        """
    )

    assert len(rows) == 1, f"Expected 1 row for marker {marker}, got {len(rows)}"
    row = rows[0]
    assert row["event_id"] == event.event_id
    assert row["event_name"] == "invoke_completed"
    assert row["distinct_id"] == marker
    assert row["source"] == "gateway"
    assert row["role"] == "consumer"
    assert row["surface"] == "api"
    assert row["env"] == "test"
    assert row["service_id"] == "svc_abc123"
    assert float(row["price_usdc"]) == pytest.approx(0.05)
    assert int(row["latency_ms"]) == 142


async def test_consumer_funnel_query(kafka_backend: KafkaBackend):
    """Emit a full consumer funnel sequence; verify funnel aggregation query."""
    marker = _make_marker()

    funnel_steps = [
        "page_viewed",
        "wallet_connected",
        "consumer_signup_completed",
        "deposit_completed",
        "credential_created",
        "invoke_completed",
    ]

    for step in funnel_steps:
        event = _make_event(step, marker)
        await kafka_backend.send(event)

    await asyncio.sleep(10)

    rows = await query_clickhouse(
        f"""
        SELECT event_name, uniqExact(distinct_id) AS users
        FROM synapse_analytics.events
        WHERE distinct_id = '{marker}'
          AND event_name IN (
                'page_viewed', 'wallet_connected', 'consumer_signup_completed',
                'deposit_completed', 'credential_created', 'invoke_completed'
              )
          AND env = 'test'
        GROUP BY event_name
        """
    )

    result_map = {r["event_name"]: int(r["users"]) for r in rows}
    assert len(result_map) == 6, f"Expected 6 funnel steps, got {len(result_map)}: {result_map}"
    for step in funnel_steps:
        assert result_map.get(step) == 1, f"Step {step} missing or users != 1: {result_map}"


async def test_provider_funnel_query(kafka_backend: KafkaBackend):
    """Emit a provider funnel sequence; verify all events present with role=provider."""
    marker = _make_marker()

    funnel_steps = [
        "provider_signup_completed",
        "service_registered",
        "provider_first_revenue_received",
        "settlement_claim_completed",
    ]

    for step in funnel_steps:
        event = _make_event(step, marker, role="provider")
        await kafka_backend.send(event)

    await asyncio.sleep(10)

    rows = await query_clickhouse(
        f"""
        SELECT event_name, role
        FROM synapse_analytics.events
        WHERE distinct_id = '{marker}'
          AND env = 'test'
        """
    )

    assert len(rows) == len(funnel_steps), (
        f"Expected {len(funnel_steps)} rows, got {len(rows)}"
    )

    names_found = {r["event_name"] for r in rows}
    for step in funnel_steps:
        assert step in names_found, f"Missing event: {step}"

    for row in rows:
        assert row["role"] == "provider", f"Expected role=provider, got {row['role']}"


async def test_no_duplicate_events(kafka_backend: KafkaBackend):
    """Emit one event with a fixed event_id; verify ClickHouse stores exactly one copy."""
    marker = _make_marker()
    fixed_event_id = str(uuid.uuid4())

    event = _make_event("invoke_completed", marker, event_id=fixed_event_id)
    await kafka_backend.send(event)

    await asyncio.sleep(10)

    rows = await query_clickhouse(
        f"""
        SELECT count() AS cnt
        FROM synapse_analytics.events
        WHERE event_id = '{fixed_event_id}'
        """
    )

    assert len(rows) == 1
    assert int(rows[0]["cnt"]) == 1, (
        f"Expected exactly 1 event with id {fixed_event_id}, got {rows[0]['cnt']}"
    )


async def test_privacy_in_storage(kafka_backend: KafkaBackend):
    """Verify ClickHouse stores hashed distinct_id, not raw wallet addresses."""
    # Simulate a hashed wallet address (SHA-256 hex digest, 64 chars)
    import hashlib

    raw_address = "0xAbC123dEf456789000000000000000000000FACE"
    hashed_id = hashlib.sha256(raw_address.lower().encode()).hexdigest()

    event = _make_event("page_viewed", hashed_id)
    await kafka_backend.send(event)

    await asyncio.sleep(10)

    rows = await query_clickhouse(
        f"""
        SELECT distinct_id
        FROM synapse_analytics.events
        WHERE distinct_id = '{hashed_id}'
        LIMIT 1
        """
    )

    assert len(rows) == 1, f"Expected 1 row for hashed id, got {len(rows)}"
    stored_id = rows[0]["distinct_id"]

    # Must NOT start with 0x (not a raw Ethereum address)
    assert not stored_id.startswith("0x"), (
        f"distinct_id looks like a raw wallet address: {stored_id}"
    )

    # Must be a 64-character hex string (SHA-256 digest)
    assert len(stored_id) == 64, f"Expected 64-char hex, got {len(stored_id)} chars"
    assert re.fullmatch(r"[0-9a-f]{64}", stored_id), (
        f"distinct_id is not valid hex: {stored_id}"
    )
