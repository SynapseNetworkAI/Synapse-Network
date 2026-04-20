from __future__ import annotations

import asyncio
import logging
from typing import Any

from src.core.config import settings
from src.services.analytics.emitter import AnalyticsEvent, KafkaBackend

logger = logging.getLogger("synapse.analytics.outbox")


def _event_from_payload(payload: dict[str, Any]) -> AnalyticsEvent:
    return AnalyticsEvent(
        event_id=str(payload.get("event_id") or ""),
        event_name=str(payload.get("event_name") or ""),
        timestamp=str(payload.get("timestamp")) if payload.get("timestamp") else None,
        distinct_id=str(payload.get("distinct_id") or ""),
        source=str(payload.get("source") or "gateway"),
        properties=dict(payload.get("properties") or {}),
    )


async def drain_analytics_outbox_once(
    storage: object,
    *,
    backend: KafkaBackend | None = None,
    batch_size: int | None = None,
    max_attempts: int | None = None,
    retry_base_sec: int | None = None,
) -> dict[str, int]:
    """Drain one analytics outbox batch to Kafka.

    Successful events are deleted. Failed rows are moved to retry/dead_letter by
    the repository so the hot outbox table does not retain sent history.
    """
    claim = getattr(storage, "claim_analytics_outbox_batch", None)
    delete_sent = getattr(storage, "delete_sent_analytics_outbox_rows", None)
    mark_retry = getattr(storage, "mark_analytics_outbox_retry", None)
    if claim is None or delete_sent is None or mark_retry is None:
        raise RuntimeError("Storage does not support analytics outbox draining")

    kafka = backend or KafkaBackend(
        bootstrap_servers=settings.analytics_kafka_bootstrap_servers,
        topic=settings.analytics_kafka_topic,
    )
    owned_backend = backend is None
    claimed_batch_size = batch_size or settings.analytics_outbox_batch_size
    lease_id, rows = await asyncio.to_thread(claim, claimed_batch_size)
    sent_ids: list[int] = []
    failed = 0
    try:
        for row in rows:
            try:
                await kafka.send(_event_from_payload(row.payload))
                sent_ids.append(row.row_id)
            except Exception as exc:
                failed += 1
                await asyncio.to_thread(
                    mark_retry,
                    lease_id,
                    row,
                    error=str(exc),
                    max_attempts=max_attempts or settings.analytics_outbox_max_attempts,
                    retry_base_sec=retry_base_sec or settings.analytics_outbox_retry_base_sec,
                )
        await asyncio.to_thread(delete_sent, lease_id, sent_ids)
        return {"claimed": len(rows), "sent": len(sent_ids), "failed": failed}
    finally:
        if owned_backend:
            await kafka.close()


async def run_analytics_outbox_worker(
    stop_event: asyncio.Event,
    storage: object,
    *,
    poll_interval_sec: float = 1.0,
) -> None:
    while not stop_event.is_set():
        try:
            stats = await drain_analytics_outbox_once(storage)
            if stats["claimed"]:
                logger.info("analytics_outbox.drain", extra=stats)
        except Exception:
            logger.exception("analytics_outbox.drain_failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=max(0.1, poll_interval_sec))
        except asyncio.TimeoutError:
            pass
