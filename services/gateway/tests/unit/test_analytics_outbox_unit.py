from __future__ import annotations

import inspect

import pytest

from src.services.analytics.emitter import (
    AnalyticsEvent,
    PostgresOutboxBackend,
    create_analytics_emitter,
)
from src.services.analytics.outbox_worker import drain_analytics_outbox_once
from src.storage.postgres.repositories.analytics_outbox_repository import (
    AnalyticsOutboxRepository,
    AnalyticsOutboxRow,
)


class FakeOutboxStorage:
    def __init__(self) -> None:
        self.enqueued: list[dict] = []
        self.deleted: list[int] = []
        self.retried: list[tuple[int, str]] = []
        self.rows = [
            AnalyticsOutboxRow(
                row_id=1,
                event_id="evt-ok",
                event_name="invoke_completed",
                event_key="0xconsumer",
                payload={
                    "event_id": "evt-ok",
                    "event_name": "invoke_completed",
                    "distinct_id": "0xconsumer",
                    "source": "gateway",
                    "properties": {"runId": "unit"},
                },
                attempt_count=0,
            ),
            AnalyticsOutboxRow(
                row_id=2,
                event_id="evt-fail",
                event_name="provider_revenue_received",
                event_key="0xprovider",
                payload={
                    "event_id": "evt-fail",
                    "event_name": "provider_revenue_received",
                    "distinct_id": "0xprovider",
                    "source": "gateway",
                    "properties": {"runId": "unit"},
                },
                attempt_count=0,
            ),
        ]

    def enqueue_analytics_outbox_event(self, event: dict) -> None:
        self.enqueued.append(dict(event))

    def claim_analytics_outbox_batch(self, batch_size: int):
        return "lease-unit", list(self.rows[:batch_size])

    def delete_sent_analytics_outbox_rows(self, lease_id: str, row_ids: list[int]) -> None:
        assert lease_id == "lease-unit"
        self.deleted.extend(row_ids)

    def mark_analytics_outbox_retry(
        self,
        lease_id: str,
        row: AnalyticsOutboxRow,
        *,
        error: str,
        max_attempts: int,
        retry_base_sec: int,
    ) -> None:
        _ = (max_attempts, retry_base_sec)
        assert lease_id == "lease-unit"
        self.retried.append((row.row_id, error))


class FakeKafkaBackend:
    def __init__(self) -> None:
        self.sent: list[str] = []

    async def send(self, event: AnalyticsEvent) -> None:
        if event.event_id == "evt-fail":
            raise RuntimeError("kafka down")
        self.sent.append(event.event_id)

    async def close(self) -> None:
        return None


@pytest.mark.asyncio
async def test_postgres_outbox_backend_persists_event_without_kafka() -> None:
    storage = FakeOutboxStorage()
    backend = PostgresOutboxBackend(storage)

    await backend.send(AnalyticsEvent("invoke_completed", "0xabc"))

    assert len(storage.enqueued) == 1
    assert storage.enqueued[0]["event_name"] == "invoke_completed"
    assert storage.enqueued[0]["distinct_id"] == "0xabc"


def test_create_analytics_emitter_requires_storage_for_outbox() -> None:
    with pytest.raises(ValueError):
        create_analytics_emitter(transport="outbox")


def test_outbox_claim_query_uses_skip_locked() -> None:
    source = inspect.getsource(AnalyticsOutboxRepository.claim_batch)

    assert "FOR UPDATE SKIP LOCKED" in source
    assert "status IN ('pending', 'retry')" in source
    assert "status = 'leased'" in source


@pytest.mark.asyncio
async def test_outbox_worker_deletes_sent_and_retries_failed_rows() -> None:
    storage = FakeOutboxStorage()
    backend = FakeKafkaBackend()

    result = await drain_analytics_outbox_once(
        storage,
        backend=backend,  # type: ignore[arg-type]
        batch_size=2,
        max_attempts=3,
        retry_base_sec=1,
    )

    assert result == {"claimed": 2, "sent": 1, "failed": 1}
    assert backend.sent == ["evt-ok"]
    assert storage.deleted == [1]
    assert storage.retried == [(2, "kafka down")]
