from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from src.services.notifications.models import (
    InvalidNotificationIntent,
    NotificationIntent,
    NotificationOutboxRow,
)

from ..database_manager import DatabaseManager


class NotificationOutboxRepository:
    """Durable Gmail notification outbox with hot-queue/cold-log separation."""

    def __init__(self, db: DatabaseManager):
        self._db = db

    @staticmethod
    def _json_payload(value: dict[str, Any]) -> str:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)

    def enqueue(self, intent: NotificationIntent) -> None:
        if not intent.notification_id.strip():
            raise InvalidNotificationIntent
        if not intent.dedupe_key.strip():
            raise InvalidNotificationIntent
        if not intent.recipient_email.strip():
            raise InvalidNotificationIntent
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_notification_outbox (
                    notification_id,
                    dedupe_key,
                    event_type,
                    recipient_email,
                    recipient_owner_id,
                    priority,
                    template_key,
                    template_version,
                    payload,
                    status,
                    attempt_count,
                    next_attempt_at,
                    created_at,
                    updated_at
                ) VALUES (
                    %s, %s, %s, lower(%s), %s, %s, %s, %s, %s::jsonb,
                    'pending', 0, now(), now(), now()
                )
                ON CONFLICT (dedupe_key) DO NOTHING
                """,
                (
                    intent.notification_id,
                    intent.dedupe_key,
                    intent.event_type,
                    intent.recipient_email,
                    intent.recipient_owner_id,
                    intent.priority,
                    intent.template_key,
                    intent.template_version,
                    self._json_payload(intent.payload),
                ),
            )

    def claim_batch(self, batch_size: int) -> tuple[str, list[NotificationOutboxRow]]:
        lease_id = f"email-lease-{uuid4().hex}"
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                WITH picked AS (
                    SELECT row_id
                    FROM synapse_notification_outbox
                    WHERE status IN ('pending', 'retry')
                      AND next_attempt_at <= now()
                    ORDER BY
                        CASE priority
                            WHEN 'security' THEN 0
                            WHEN 'transactional_high' THEN 1
                            WHEN 'transactional' THEN 2
                            WHEN 'ops' THEN 3
                            WHEN 'digest' THEN 4
                            ELSE 5
                        END,
                        created_at ASC
                    LIMIT %s
                    FOR UPDATE SKIP LOCKED
                )
                UPDATE synapse_notification_outbox AS outbox
                SET status = 'leased',
                    lease_id = %s,
                    leased_at = now(),
                    updated_at = now()
                FROM picked
                WHERE outbox.row_id = picked.row_id
                RETURNING
                    outbox.row_id,
                    outbox.notification_id,
                    outbox.dedupe_key,
                    outbox.event_type,
                    outbox.recipient_email,
                    outbox.recipient_owner_id,
                    outbox.priority,
                    outbox.template_key,
                    outbox.template_version,
                    outbox.payload,
                    outbox.attempt_count
                """,
                (max(1, int(batch_size)), lease_id),
            )
            rows = cur.fetchall()
        return lease_id, [
            NotificationOutboxRow(
                row_id=int(row[0]),
                notification_id=str(row[1]),
                dedupe_key=str(row[2]),
                event_type=str(row[3]),
                recipient_email=str(row[4]),
                recipient_owner_id=str(row[5]) if row[5] is not None else None,
                priority=str(row[6]),
                template_key=str(row[7]),
                template_version=str(row[8]),
                payload=dict(row[9] or {}),
                attempt_count=int(row[10] or 0),
            )
            for row in rows
        ]

    def record_sent_and_delete(
        self,
        lease_id: str,
        row: NotificationOutboxRow,
        *,
        message_id: str | None,
        provider_response: dict[str, Any],
    ) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_notification_delivery_log (
                    notification_id,
                    dedupe_key,
                    event_type,
                    recipient_email,
                    recipient_owner_id,
                    priority,
                    template_key,
                    template_version,
                    message_id,
                    provider_response,
                    sent_at
                ) VALUES (
                    %s, %s, %s, lower(%s), %s, %s, %s, %s, %s, %s::jsonb, now()
                )
                ON CONFLICT (notification_id) DO NOTHING
                """,
                (
                    row.notification_id,
                    row.dedupe_key,
                    row.event_type,
                    row.recipient_email,
                    row.recipient_owner_id,
                    row.priority,
                    row.template_key,
                    row.template_version,
                    message_id,
                    self._json_payload(provider_response),
                ),
            )
            cur.execute(
                """
                DELETE FROM synapse_notification_outbox
                WHERE lease_id = %s
                  AND row_id = %s
                """,
                (lease_id, row.row_id),
            )

    def mark_retry(
        self,
        lease_id: str,
        row: NotificationOutboxRow,
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
                UPDATE synapse_notification_outbox
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

    def delivery_count_today(self) -> int:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*)
                FROM synapse_notification_delivery_log
                WHERE sent_at >= date_trunc('day', now())
                """
            )
            row = cur.fetchone() or (0,)
        return int(row[0] or 0)

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
                FROM synapse_notification_outbox
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
