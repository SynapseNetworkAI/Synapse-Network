from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from ..database_manager import DatabaseManager


@dataclass(frozen=True)
class AnalyticsOutboxRow:
    row_id: int
    event_id: str
    event_name: str
    event_key: str
    payload: dict[str, Any]
    attempt_count: int


class AnalyticsOutboxRepository:
    """Durable analytics outbox with multi-worker safe leasing."""

    def __init__(self, db: DatabaseManager):
        self._db = db

    @staticmethod
    def _json_payload(value: dict[str, Any]) -> str:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)

    def enqueue_event(self, event: dict[str, Any]) -> None:
        event_id = str(event.get("event_id") or "").strip()
        if not event_id:
            raise ValueError("analytics outbox event_id is required")
        event_name = str(event.get("event_name") or "").strip()
        event_key = str(event.get("distinct_id") or event_name or event_id).strip()
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_analytics_outbox (
                    event_id,
                    event_name,
                    event_key,
                    payload,
                    status,
                    attempt_count,
                    next_attempt_at,
                    created_at,
                    updated_at
                ) VALUES (%s, %s, %s, %s::jsonb, 'pending', 0, now(), now(), now())
                ON CONFLICT (event_id) DO NOTHING
                """,
                (event_id, event_name, event_key, self._json_payload(event)),
            )

    def claim_batch(self, batch_size: int) -> tuple[str, list[AnalyticsOutboxRow]]:
        lease_id = f"lease-{uuid4().hex}"
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                WITH picked AS (
                    SELECT row_id
                    FROM synapse_analytics_outbox
                    WHERE status IN ('pending', 'retry')
                      AND next_attempt_at <= now()
                    ORDER BY created_at ASC
                    LIMIT %s
                    FOR UPDATE SKIP LOCKED
                )
                UPDATE synapse_analytics_outbox AS outbox
                SET status = 'leased',
                    lease_id = %s,
                    leased_at = now(),
                    updated_at = now()
                FROM picked
                WHERE outbox.row_id = picked.row_id
                RETURNING
                    outbox.row_id,
                    outbox.event_id,
                    outbox.event_name,
                    outbox.event_key,
                    outbox.payload,
                    outbox.attempt_count
                """,
                (max(1, int(batch_size)), lease_id),
            )
            rows = cur.fetchall()

        claimed = [
            AnalyticsOutboxRow(
                row_id=int(row[0]),
                event_id=str(row[1]),
                event_name=str(row[2] or ""),
                event_key=str(row[3] or ""),
                payload=dict(row[4] or {}),
                attempt_count=int(row[5] or 0),
            )
            for row in rows
        ]
        return lease_id, claimed

    def delete_sent(self, lease_id: str, row_ids: list[int]) -> None:
        if not row_ids:
            return
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                DELETE FROM synapse_analytics_outbox
                WHERE lease_id = %s
                  AND row_id = ANY(%s)
                """,
                (lease_id, row_ids),
            )

    def mark_retry(
        self,
        lease_id: str,
        row: AnalyticsOutboxRow,
        *,
        error: str,
        max_attempts: int,
        retry_base_sec: int,
    ) -> None:
        next_attempt = int(row.attempt_count or 0) + 1
        status = "dead_letter" if next_attempt >= max_attempts else "retry"
        delay_sec = max(1, int(retry_base_sec)) * min(60, 2 ** max(0, next_attempt - 1))
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_analytics_outbox
                SET status = %s,
                    attempt_count = %s,
                    next_attempt_at = now() + (%s || ' seconds')::interval,
                    last_error = %s,
                    lease_id = NULL,
                    leased_at = NULL,
                    updated_at = now()
                WHERE lease_id = %s
                  AND row_id = %s
                """,
                (
                    status,
                    next_attempt,
                    delay_sec,
                    str(error or "")[:1000],
                    lease_id,
                    row.row_id,
                ),
            )

    def stats(self) -> dict[str, int | str | None]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT
                    COUNT(*) FILTER (WHERE status IN ('pending', 'retry')) AS pending_count,
                    COUNT(*) FILTER (WHERE status = 'leased') AS leased_count,
                    COUNT(*) FILTER (WHERE status = 'dead_letter') AS dead_letter_count,
                    EXTRACT(
                        EPOCH FROM (
                            now() - MIN(created_at) FILTER (WHERE status IN ('pending', 'retry'))
                        )
                    )::bigint AS oldest_pending_age_sec
                FROM synapse_analytics_outbox
                """
            )
            row = cur.fetchone() or (0, 0, 0, None)
        return {
            "pendingCount": int(row[0] or 0),
            "leasedCount": int(row[1] or 0),
            "deadLetterCount": int(row[2] or 0),
            "oldestPendingAgeSec": int(row[3]) if row[3] is not None else None,
            "checkedAt": datetime.now(timezone.utc).isoformat(),
        }
