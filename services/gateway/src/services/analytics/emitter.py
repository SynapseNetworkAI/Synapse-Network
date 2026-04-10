"""
Synapse Analytics Event Emitter

Responsibilities:
  1. Provide unified emit() interface for all Gateway/Provider analytics
  2. Serialize events and async write to Kafka topic
  3. Auto-inject event_id, timestamp, source, correlation_id
  4. Fallback to local JSONL file when Kafka is unavailable
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("synapse.analytics")


class AnalyticsEvent:
    """Immutable event data container."""

    __slots__ = (
        "event_id", "event_name", "timestamp", "distinct_id",
        "source", "properties",
    )

    def __init__(
        self,
        event_name: str,
        distinct_id: str,
        source: str = "gateway",
        properties: Optional[dict[str, Any]] = None,
        event_id: Optional[str] = None,
        timestamp: Optional[str] = None,
    ):
        self.event_id = event_id or str(uuid.uuid4())
        self.event_name = event_name
        self.timestamp = timestamp or datetime.now(timezone.utc).isoformat()
        self.distinct_id = distinct_id
        self.source = source
        self.properties = properties or {}

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_id": self.event_id,
            "event_name": self.event_name,
            "timestamp": self.timestamp,
            "distinct_id": self.distinct_id,
            "source": self.source,
            "properties": self.properties,
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), default=str)


class AnalyticsEmitter:
    """Unified analytics event emitter."""

    def __init__(self, backend: "AnalyticsBackend"):
        self._backend = backend

    async def emit(
        self,
        event_name: str,
        distinct_id: str,
        properties: Optional[dict[str, Any]] = None,
        source: str = "gateway",
        correlation_id: Optional[str] = None,
    ) -> None:
        """Emit a single analytics event. Non-blocking, fire-and-forget."""
        props = dict(properties or {})
        if correlation_id:
            props["correlation_id"] = correlation_id

        event = AnalyticsEvent(
            event_name=event_name,
            distinct_id=distinct_id,
            source=source,
            properties=props,
        )

        try:
            await self._backend.send(event)
            logger.debug("analytics.emit ok: %s %s", event_name, event.event_id)
        except Exception:
            logger.exception("analytics.emit failed: %s", event_name)

    async def emit_batch(self, events: list[AnalyticsEvent]) -> None:
        """Emit a batch of events (used by frontend event ingestion endpoint)."""
        for event in events:
            try:
                await self._backend.send(event)
            except Exception:
                logger.exception("analytics.emit_batch failed: %s", event.event_name)


class AnalyticsBackend:
    """Abstract backend for event delivery."""
    async def send(self, event: AnalyticsEvent) -> None:
        raise NotImplementedError

    async def close(self) -> None:
        pass


class KafkaBackend(AnalyticsBackend):
    """Writes events to Kafka topic using aiokafka."""

    def __init__(
        self,
        bootstrap_servers: str = "localhost:9092",
        topic: str = "synapse.analytics.events",
    ):
        self._bootstrap_servers = bootstrap_servers
        self._topic = topic
        self._producer = None

    async def _ensure_producer(self):
        if self._producer is None:
            from aiokafka import AIOKafkaProducer
            self._producer = AIOKafkaProducer(
                bootstrap_servers=self._bootstrap_servers,
                value_serializer=lambda v: v.encode("utf-8"),
                key_serializer=lambda k: k.encode("utf-8") if k else None,
                acks="all",
                compression_type="gzip",
                linger_ms=50,
                batch_size=32768,
            )
            await self._producer.start()
            logger.info("Kafka analytics producer started: %s", self._bootstrap_servers)

    async def send(self, event: AnalyticsEvent) -> None:
        await self._ensure_producer()
        await self._producer.send_and_wait(
            topic=self._topic,
            value=event.to_json(),
            key=event.distinct_id,
        )

    async def close(self) -> None:
        if self._producer:
            await self._producer.stop()
            self._producer = None


class FileBackend(AnalyticsBackend):
    """Appends events as JSONL to a local file. Used for dev and fallback."""

    def __init__(self, path: str = "logs/analytics_events.jsonl"):
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)

    async def send(self, event: AnalyticsEvent) -> None:
        with self._path.open("a", encoding="utf-8") as f:
            f.write(event.to_json() + "\n")

    async def close(self) -> None:
        pass


class DualBackend(AnalyticsBackend):
    """Writes to Kafka primary, falls back to file on Kafka failure."""

    def __init__(self, kafka: KafkaBackend, fallback: FileBackend):
        self._kafka = kafka
        self._fallback = fallback

    async def send(self, event: AnalyticsEvent) -> None:
        try:
            await self._kafka.send(event)
        except Exception:
            logger.warning(
                "Kafka unavailable, falling back to file: %s", event.event_name
            )
            await self._fallback.send(event)

    async def close(self) -> None:
        await self._kafka.close()
        await self._fallback.close()


def create_analytics_emitter(
    kafka_bootstrap_servers: Optional[str] = None,
    kafka_topic: str = "synapse.analytics.events",
    fallback_file: str = "logs/analytics_events.jsonl",
    environment: str = "local",
) -> AnalyticsEmitter:
    """Factory: FileBackend for local/test, DualBackend for staging/prod."""
    if environment in ("staging", "prod") and kafka_bootstrap_servers:
        kafka = KafkaBackend(
            bootstrap_servers=kafka_bootstrap_servers,
            topic=kafka_topic,
        )
        fallback = FileBackend(path=fallback_file)
        backend = DualBackend(kafka=kafka, fallback=fallback)
        logger.info("Analytics: Kafka + File fallback (%s)", kafka_bootstrap_servers)
    else:
        backend = FileBackend(path=fallback_file)
        logger.info("Analytics: File-only mode (%s)", fallback_file)

    return AnalyticsEmitter(backend=backend)
