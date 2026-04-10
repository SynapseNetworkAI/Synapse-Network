"""
Kafka integration tests for the Synapse Analytics Emitter.

These tests verify real Kafka round-trip behaviour: produce events via
KafkaBackend / DualBackend and consume them back with AIOKafkaConsumer.

Run (requires Kafka on localhost:9092):
  ANALYTICS_TEST_KAFKA=true pytest tests/integration/test_analytics_kafka_integration.py -v

The ANALYTICS_TEST_KAFKA env-var gates every test that needs a live broker.
test_dual_backend_fallback_to_file is the exception — it validates the
file-fallback path when Kafka is *unreachable* and runs unconditionally.
"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import pytest

from src.services.analytics.emitter import (
    AnalyticsEmitter,
    AnalyticsEvent,
    DualBackend,
    FileBackend,
    KafkaBackend,
)

# ---------------------------------------------------------------------------
# Gate: skip everything that needs a live broker unless opted-in
# ---------------------------------------------------------------------------
KAFKA_AVAILABLE = os.getenv("ANALYTICS_TEST_KAFKA", "").lower() == "true"

kafka_required = pytest.mark.skipif(
    not KAFKA_AVAILABLE,
    reason="Kafka not available (set ANALYTICS_TEST_KAFKA=true)",
)

try:
    from aiokafka import AIOKafkaConsumer
except ImportError:  # pragma: no cover
    AIOKafkaConsumer = None  # type: ignore[assignment,misc]

BOOTSTRAP = "localhost:9092"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture
def test_topic() -> str:
    """Return a unique Kafka topic name for each test invocation."""
    return f"synapse.analytics.test.{uuid.uuid4().hex[:8]}"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _consume_n(topic: str, n: int, group_id: str) -> list[dict]:
    """Consume *n* messages from *topic* and return their parsed JSON dicts."""
    consumer = AIOKafkaConsumer(
        topic,
        bootstrap_servers=BOOTSTRAP,
        group_id=group_id,
        auto_offset_reset="earliest",
        consumer_timeout_ms=10_000,
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        key_deserializer=lambda k: k.decode("utf-8") if k else None,
    )
    messages: list[dict] = []
    try:
        await consumer.start()
        async for msg in consumer:
            messages.append(msg.value)
            if len(messages) >= n:
                break
    finally:
        await consumer.stop()
    return messages


# ===================================================================
# 1. Kafka round-trip
# ===================================================================
@kafka_required
class TestKafkaRoundtrip:
    async def test_kafka_roundtrip(self, test_topic: str):
        """Emit one event → consume → verify every field matches."""
        props = {"service_id": "svc_42", "latency_ms": 123}
        event = AnalyticsEvent(
            event_name="invoke_completed",
            distinct_id="user_abc",
            source="gateway",
            properties=props,
        )

        backend = KafkaBackend(bootstrap_servers=BOOTSTRAP, topic=test_topic)
        try:
            await backend.send(event)
        finally:
            await backend.close()

        group = f"test-roundtrip-{uuid.uuid4().hex[:8]}"
        messages = await _consume_n(test_topic, 1, group_id=group)

        assert len(messages) == 1
        msg = messages[0]
        assert msg["event_name"] == "invoke_completed"
        assert msg["distinct_id"] == "user_abc"
        assert msg["source"] == "gateway"
        assert msg["properties"]["service_id"] == "svc_42"
        assert msg["properties"]["latency_ms"] == 123
        assert "event_id" in msg
        assert "timestamp" in msg


# ===================================================================
# 2. Batch ordering (same partition via same key)
# ===================================================================
@kafka_required
class TestKafkaBatchOrdering:
    async def test_kafka_batch_ordering(self, test_topic: str):
        """Emit 3 events with the same distinct_id → verify arrival order."""
        names = ["wallet_connected", "deposit_completed", "invoke_completed"]
        distinct_id = f"user_{uuid.uuid4().hex[:6]}"

        backend = KafkaBackend(bootstrap_servers=BOOTSTRAP, topic=test_topic)
        try:
            for name in names:
                event = AnalyticsEvent(
                    event_name=name,
                    distinct_id=distinct_id,
                    source="gateway",
                )
                await backend.send(event)
        finally:
            await backend.close()

        group = f"test-ordering-{uuid.uuid4().hex[:8]}"
        messages = await _consume_n(test_topic, 3, group_id=group)

        assert len(messages) == 3
        received_names = [m["event_name"] for m in messages]
        assert received_names == names, (
            f"Expected order {names}, got {received_names}"
        )
        # All should share the same distinct_id
        assert all(m["distinct_id"] == distinct_id for m in messages)


# ===================================================================
# 3. Multiple users – partition isolation
# ===================================================================
@kafka_required
class TestKafkaMultipleUsersPartitioned:
    async def test_kafka_multiple_users_partitioned(self, test_topic: str):
        """Emit events for 2 users → each user's events are ordered correctly."""
        user_a = f"user_a_{uuid.uuid4().hex[:6]}"
        user_b = f"user_b_{uuid.uuid4().hex[:6]}"

        events_a = ["wallet_connected", "deposit_completed"]
        events_b = ["invoke_completed", "wallet_connected", "deposit_completed"]

        backend = KafkaBackend(bootstrap_servers=BOOTSTRAP, topic=test_topic)
        try:
            # Interleave sends: A0, B0, A1, B1, B2
            await backend.send(AnalyticsEvent(event_name=events_a[0], distinct_id=user_a))
            await backend.send(AnalyticsEvent(event_name=events_b[0], distinct_id=user_b))
            await backend.send(AnalyticsEvent(event_name=events_a[1], distinct_id=user_a))
            await backend.send(AnalyticsEvent(event_name=events_b[1], distinct_id=user_b))
            await backend.send(AnalyticsEvent(event_name=events_b[2], distinct_id=user_b))
        finally:
            await backend.close()

        total = len(events_a) + len(events_b)
        group = f"test-partition-{uuid.uuid4().hex[:8]}"
        messages = await _consume_n(test_topic, total, group_id=group)

        assert len(messages) == total

        # Group by user and verify per-user ordering
        a_msgs = [m for m in messages if m["distinct_id"] == user_a]
        b_msgs = [m for m in messages if m["distinct_id"] == user_b]

        assert [m["event_name"] for m in a_msgs] == events_a, (
            "User A events arrived out of order"
        )
        assert [m["event_name"] for m in b_msgs] == events_b, (
            "User B events arrived out of order"
        )


# ===================================================================
# 4. DualBackend fallback to file (NO Kafka needed)
# ===================================================================
class TestDualBackendFallbackToFile:
    """This test does NOT require a live Kafka broker."""

    async def test_dual_backend_fallback_to_file(self, tmp_path: Path):
        """DualBackend falls back to FileBackend when Kafka is unreachable."""
        unreachable_kafka = KafkaBackend(
            bootstrap_servers="localhost:19999",
            topic="synapse.analytics.test.unreachable",
        )
        file_path = str(tmp_path / "fallback_events.jsonl")
        file_backend = FileBackend(path=file_path)
        dual = DualBackend(kafka=unreachable_kafka, fallback=file_backend)

        emitter = AnalyticsEmitter(backend=dual)
        try:
            await emitter.emit(
                event_name="fallback_test",
                distinct_id="user_fallback",
                properties={"attempt": 1},
                source="gateway",
            )
        finally:
            await dual.close()

        # The file backend must have captured the event
        content = Path(file_path).read_text().strip()
        assert content, "Fallback file should not be empty"

        lines = content.split("\n")
        assert len(lines) == 1
        parsed = json.loads(lines[0])
        assert parsed["event_name"] == "fallback_test"
        assert parsed["distinct_id"] == "user_fallback"
        assert parsed["properties"]["attempt"] == 1


# ===================================================================
# 5. DualBackend prefers Kafka when available
# ===================================================================
@kafka_required
class TestDualBackendPrefersKafka:
    async def test_dual_backend_prefers_kafka(self, test_topic: str, tmp_path: Path):
        """When Kafka is reachable, DualBackend writes there and NOT to file."""
        file_path = str(tmp_path / "should_be_empty.jsonl")
        kafka_backend = KafkaBackend(bootstrap_servers=BOOTSTRAP, topic=test_topic)
        file_backend = FileBackend(path=file_path)
        dual = DualBackend(kafka=kafka_backend, fallback=file_backend)

        emitter = AnalyticsEmitter(backend=dual)
        try:
            await emitter.emit(
                event_name="kafka_preferred",
                distinct_id="user_kafka",
                properties={"routed": "kafka"},
                source="gateway",
            )
        finally:
            await dual.close()

        # File should be empty or absent – Kafka was the primary path
        fp = Path(file_path)
        if fp.exists():
            assert fp.read_text().strip() == "", (
                "File backend should not have received the event"
            )

        # Verify the event arrived in Kafka
        group = f"test-dual-kafka-{uuid.uuid4().hex[:8]}"
        messages = await _consume_n(test_topic, 1, group_id=group)

        assert len(messages) == 1
        assert messages[0]["event_name"] == "kafka_preferred"
        assert messages[0]["distinct_id"] == "user_kafka"
        assert messages[0]["properties"]["routed"] == "kafka"
