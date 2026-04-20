"""Unit tests for analytics emitter and backends."""
import json
import sys
import types
import uuid
from pathlib import Path

import pytest

from src.services.analytics.emitter import (
    AnalyticsEvent,
    AnalyticsEmitter,
    FileBackend,
    KafkaBackend,
    create_analytics_emitter,
)
from src.services.analytics.privacy import sha256_hash


class TestAnalyticsEvent:
    def test_event_structure(self):
        event = AnalyticsEvent(
            event_name="invoke_completed",
            distinct_id="abc123hash",
            source="gateway",
            properties={"service_id": "svc_1", "price_usdc": 0.05},
        )
        d = event.to_dict()
        assert d["event_name"] == "invoke_completed"
        assert d["distinct_id"] == "abc123hash"
        assert d["source"] == "gateway"
        assert d["properties"]["service_id"] == "svc_1"
        assert d["properties"]["price_usdc"] == 0.05
        assert "event_id" in d
        assert "timestamp" in d
        uuid.UUID(d["event_id"])

    def test_event_json_serializable(self):
        event = AnalyticsEvent(
            event_name="deposit_completed",
            distinct_id="xyz",
            properties={"amount_usdc": 100.0},
        )
        json_str = event.to_json()
        parsed = json.loads(json_str)
        assert parsed["event_name"] == "deposit_completed"

    def test_event_custom_id_and_timestamp(self):
        event = AnalyticsEvent(
            event_name="test",
            distinct_id="user",
            event_id="custom-id",
            timestamp="2026-01-01T00:00:00Z",
        )
        assert event.event_id == "custom-id"
        assert event.timestamp == "2026-01-01T00:00:00Z"


class TestFileBackend:
    @pytest.fixture
    def tmp_file(self, tmp_path):
        return str(tmp_path / "events.jsonl")

    async def test_write_event(self, tmp_file):
        backend = FileBackend(path=tmp_file)
        event = AnalyticsEvent(
            event_name="test_event",
            distinct_id="user123",
            properties={"key": "value"},
        )
        await backend.send(event)
        lines = Path(tmp_file).read_text().strip().split("\n")
        assert len(lines) == 1
        parsed = json.loads(lines[0])
        assert parsed["event_name"] == "test_event"
        assert parsed["distinct_id"] == "user123"

    async def test_append_multiple_events(self, tmp_file):
        backend = FileBackend(path=tmp_file)
        for i in range(5):
            event = AnalyticsEvent(event_name=f"event_{i}", distinct_id="user")
            await backend.send(event)
        lines = Path(tmp_file).read_text().strip().split("\n")
        assert len(lines) == 5

    async def test_creates_parent_dirs(self, tmp_path):
        deep_path = str(tmp_path / "a" / "b" / "c" / "events.jsonl")
        backend = FileBackend(path=deep_path)
        event = AnalyticsEvent(event_name="test", distinct_id="user")
        await backend.send(event)
        assert Path(deep_path).exists()


class TestAnalyticsEmitter:
    @pytest.fixture
    def file_emitter(self, tmp_path):
        return create_analytics_emitter(
            environment="local",
            fallback_file=str(tmp_path / "events.jsonl"),
        )

    async def test_emit_writes_to_file(self, file_emitter, tmp_path):
        await file_emitter.emit(
            event_name="invoke_completed",
            distinct_id="hash123",
            properties={"service_id": "svc_1", "latency_ms": 250},
            correlation_id="corr_abc",
        )
        lines = (tmp_path / "events.jsonl").read_text().strip().split("\n")
        assert len(lines) == 1
        parsed = json.loads(lines[0])
        assert parsed["event_name"] == "invoke_completed"
        assert parsed["properties"]["correlation_id"] == "corr_abc"
        assert parsed["properties"]["service_id"] == "svc_1"

    async def test_emit_batch(self, file_emitter, tmp_path):
        events = [
            AnalyticsEvent(event_name=f"event_{i}", distinct_id="user")
            for i in range(10)
        ]
        await file_emitter.emit_batch(events)
        lines = (tmp_path / "events.jsonl").read_text().strip().split("\n")
        assert len(lines) == 10


class TestKafkaBackend:
    async def test_uses_aiokafka_supported_batch_argument(self, monkeypatch):
        created_kwargs = {}
        sent = {}

        class FakeProducer:
            def __init__(self, **kwargs):
                created_kwargs.update(kwargs)

            async def start(self):
                return None

            async def send_and_wait(self, *, topic, value, key):
                sent.update({"topic": topic, "value": value, "key": key})

            async def stop(self):
                return None

        monkeypatch.setitem(
            sys.modules,
            "aiokafka",
            types.SimpleNamespace(AIOKafkaProducer=FakeProducer),
        )
        backend = KafkaBackend(bootstrap_servers="localhost:9092", topic="events")

        await backend.send(AnalyticsEvent(event_name="invoke_started", distinct_id="hash"))

        assert created_kwargs["max_batch_size"] == 32768
        assert "batch_size" not in created_kwargs
        assert sent["topic"] == "events"
        assert sent["key"] == "hash"

    def test_strict_kafka_requires_bootstrap_servers(self):
        with pytest.raises(ValueError, match="ANALYTICS_STRICT_KAFKA"):
            create_analytics_emitter(environment="local", strict_kafka=True)

    async def test_strict_kafka_uses_kafka_in_local_mode(self, monkeypatch):
        created_kwargs = {}
        sent = {}

        class FakeProducer:
            def __init__(self, **kwargs):
                created_kwargs.update(kwargs)

            async def start(self):
                return None

            async def send_and_wait(self, *, topic, value, key):
                sent.update({"topic": topic, "value": value, "key": key})

            async def stop(self):
                return None

        monkeypatch.setitem(
            sys.modules,
            "aiokafka",
            types.SimpleNamespace(AIOKafkaProducer=FakeProducer),
        )
        emitter = create_analytics_emitter(
            kafka_bootstrap_servers="localhost:9092",
            kafka_topic="synapse.analytics.events",
            environment="local",
            strict_kafka=True,
        )

        await emitter.emit("invoke_completed", "hash", properties={"price_usdc": "1.000000"})

        assert created_kwargs["bootstrap_servers"] == "localhost:9092"
        assert sent["topic"] == "synapse.analytics.events"
        assert sent["key"] == "hash"


class TestPrivacy:
    def test_sha256_hash(self):
        result = sha256_hash("0xAbCdEf1234567890AbCdEf1234567890AbCdEf12")
        assert len(result) == 64
        assert all(c in "0123456789abcdef" for c in result)
        assert result == sha256_hash("0xabcdef1234567890abcdef1234567890abcdef12")

    def test_hash_strips_whitespace(self):
        assert sha256_hash("  0xABC  ") == sha256_hash("0xABC")
