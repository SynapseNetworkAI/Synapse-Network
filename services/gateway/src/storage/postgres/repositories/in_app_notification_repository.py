from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from src.services.notifications.models import (
    InAppNotificationIntent,
    InAppNotificationRow,
    InvalidInAppNotificationIntent,
)
from src.services.notifications.sanitizer import redact_payload, redact_text

from ..database_manager import DatabaseManager


class InAppNotificationRepository:
    """Postgres-backed product inbox for owner/provider/admin notifications."""

    def __init__(self, db: DatabaseManager):
        self._db = db

    @staticmethod
    def _json_payload(value: dict[str, Any] | None) -> str:
        redacted = redact_payload(dict(value or {}))
        return json.dumps(redacted, ensure_ascii=False, sort_keys=True, default=str)

    @staticmethod
    def _clean_text(value: str, *, max_chars: int) -> str:
        return redact_text(str(value or "").strip(), max_chars=max_chars)

    @staticmethod
    def _normalize_owner(value: str | None) -> str | None:
        normalized = str(value or "").strip().lower()
        return normalized or None

    @staticmethod
    def _utc_iso(value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        text = str(value).strip()
        if not text:
            return None
        if text.endswith("Z") or text.endswith("+00:00"):
            return text.replace("+00:00", "Z")
        if text.endswith("+00"):
            return f"{text[:-3]}Z"
        return text

    @staticmethod
    def _row_to_notification(row: Any) -> InAppNotificationRow:
        return InAppNotificationRow(
            notification_id=str(row[0]),
            event_type=str(row[1]),
            category=str(row[2]),
            severity=str(row[3]),
            priority=str(row[4]),
            title=str(row[5]),
            body=str(row[6]),
            action_url=str(row[7]) if row[7] is not None else None,
            resource_type=str(row[8]) if row[8] is not None else None,
            resource_id=str(row[9]) if row[9] is not None else None,
            payload=dict(row[10] or {}),
            read_at=InAppNotificationRepository._utc_iso(row[11]),
            archived_at=InAppNotificationRepository._utc_iso(row[12]),
            expires_at=InAppNotificationRepository._utc_iso(row[13]),
            created_at=InAppNotificationRepository._utc_iso(row[14]) or "",
        )

    def enqueue(self, intent: InAppNotificationIntent) -> None:
        if not intent.notification_id.strip():
            raise InvalidInAppNotificationIntent
        if not intent.dedupe_key.strip():
            raise InvalidInAppNotificationIntent
        if not intent.event_type.strip():
            raise InvalidInAppNotificationIntent
        if not intent.title.strip() or not intent.body.strip():
            raise InvalidInAppNotificationIntent
        recipient_owner_id = self._normalize_owner(intent.recipient_owner_id)
        recipient_admin_id = str(intent.recipient_admin_id or "").strip() or None
        if intent.recipient_type in {"owner", "provider"} and not recipient_owner_id:
            raise InvalidInAppNotificationIntent
        if intent.recipient_type == "admin" and not recipient_admin_id:
            raise InvalidInAppNotificationIntent

        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_in_app_notifications (
                    notification_id,
                    dedupe_key,
                    recipient_type,
                    recipient_owner_id,
                    recipient_admin_id,
                    event_type,
                    category,
                    severity,
                    priority,
                    title,
                    body,
                    action_url,
                    resource_type,
                    resource_id,
                    payload,
                    expires_at,
                    created_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s::jsonb, NULLIF(%s, '')::timestamptz, now()
                )
                ON CONFLICT (dedupe_key) DO NOTHING
                """,
                (
                    intent.notification_id,
                    intent.dedupe_key,
                    intent.recipient_type,
                    recipient_owner_id,
                    recipient_admin_id,
                    intent.event_type,
                    intent.category,
                    intent.severity,
                    intent.priority,
                    self._clean_text(intent.title, max_chars=200),
                    self._clean_text(intent.body, max_chars=1200),
                    self._clean_text(intent.action_url or "", max_chars=500) or None,
                    intent.resource_type,
                    intent.resource_id,
                    self._json_payload(intent.payload),
                    str(intent.expires_at or ""),
                ),
            )

    def list_for_owner(
        self,
        *,
        owner_wallet: str,
        limit: int,
        cursor: str | None,
        unread_only: bool,
    ) -> list[InAppNotificationRow]:
        owner = self._normalize_owner(owner_wallet)
        if not owner:
            return []
        filters = [
            "recipient_owner_id = %s",
            "archived_at IS NULL",
        ]
        params: list[Any] = [owner]
        if unread_only:
            filters.append("read_at IS NULL")
        if cursor:
            filters.append("created_at < %s::timestamptz")
            params.append(cursor)
        params.append(max(1, min(int(limit), 50)))
        where_clause = " AND ".join(filters)
        sql = (
            """
                SELECT
                    notification_id,
                    event_type,
                    category,
                    severity,
                    priority,
                    title,
                    body,
                    action_url,
                    resource_type,
                    resource_id,
                    payload,
                    to_char(read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                    to_char(archived_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                    to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                FROM synapse_in_app_notifications
                WHERE """
            + where_clause
            + """
                ORDER BY created_at DESC, notification_id DESC
                LIMIT %s
                """
        )
        with self._db.readonly_cursor() as cur:
            cur.execute(sql, tuple(params))
            rows = cur.fetchall()
        return [self._row_to_notification(row) for row in rows]

    def unread_count_for_owner(self, *, owner_wallet: str) -> int:
        owner = self._normalize_owner(owner_wallet)
        if not owner:
            return 0
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*)
                FROM synapse_in_app_notifications
                WHERE recipient_owner_id = %s
                  AND read_at IS NULL
                  AND archived_at IS NULL
                """,
                (owner,),
            )
            row = cur.fetchone()
        return int(row[0] or 0) if row else 0

    def mark_read_for_owner(self, *, owner_wallet: str, notification_id: str) -> bool:
        owner = self._normalize_owner(owner_wallet)
        if not owner or not notification_id:
            return False
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_in_app_notifications
                SET read_at = COALESCE(read_at, now())
                WHERE recipient_owner_id = %s
                  AND notification_id = %s
                  AND archived_at IS NULL
                """,
                (owner, notification_id),
            )
            return bool(getattr(cur, "rowcount", 0) or 0)

    def mark_all_read_for_owner(self, *, owner_wallet: str) -> int:
        owner = self._normalize_owner(owner_wallet)
        if not owner:
            return 0
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_in_app_notifications
                SET read_at = COALESCE(read_at, now())
                WHERE recipient_owner_id = %s
                  AND read_at IS NULL
                  AND archived_at IS NULL
                """,
                (owner,),
            )
            return int(getattr(cur, "rowcount", 0) or 0)

    def archive_for_owner(self, *, owner_wallet: str, notification_id: str) -> bool:
        owner = self._normalize_owner(owner_wallet)
        if not owner or not notification_id:
            return False
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_in_app_notifications
                SET archived_at = COALESCE(archived_at, now()),
                    read_at = COALESCE(read_at, now())
                WHERE recipient_owner_id = %s
                  AND notification_id = %s
                """,
                (owner, notification_id),
            )
            return bool(getattr(cur, "rowcount", 0) or 0)

    def cleanup_expired(self, *, retention_days: int, security_retention_days: int, batch_size: int) -> int:
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                WITH expired AS (
                    SELECT row_id
                    FROM synapse_in_app_notifications
                    WHERE (
                        expires_at IS NOT NULL
                        AND expires_at < now()
                    )
                    OR (
                        priority <> 'security'
                        AND created_at < now() - (%s || ' days')::interval
                    )
                    OR (
                        priority = 'security'
                        AND created_at < now() - (%s || ' days')::interval
                    )
                    ORDER BY created_at ASC
                    LIMIT %s
                )
                DELETE FROM synapse_in_app_notifications AS inbox
                USING expired
                WHERE inbox.row_id = expired.row_id
                """,
                (
                    max(1, int(retention_days)),
                    max(1, int(security_retention_days)),
                    max(1, int(batch_size)),
                ),
            )
            return int(getattr(cur, "rowcount", 0) or 0)
