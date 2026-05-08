import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from src.domain import AdminInAppNotification


def _connect(dsn: str):
    return psycopg.connect(dsn, row_factory=dict_row)


def _map_notification(row: dict) -> AdminInAppNotification:
    return AdminInAppNotification(
        notification_id=row["notification_id"],
        dedupe_key=row["dedupe_key"],
        recipient_admin_id=row["recipient_admin_id"],
        event_type=row["event_type"],
        category=row["category"],
        severity=row["severity"],
        priority=row["priority"],
        title=row["title"],
        body=row["body"],
        action_url=row["action_url"],
        resource_type=row["resource_type"],
        resource_id=row["resource_id"],
        payload=row["payload"],
        read_at=row["read_at"],
        archived_at=row["archived_at"],
        expires_at=row["expires_at"],
        created_at=row["created_at"],
    )


class PostgresAdminNotificationRepository:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    def enqueue(self, notification: AdminInAppNotification) -> AdminInAppNotification:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_in_app_notifications (
                    notification_id, dedupe_key, recipient_type, recipient_admin_id,
                    event_type, category, severity, priority, title, body,
                    action_url, resource_type, resource_id, payload, expires_at, created_at
                )
                VALUES (
                    %s, %s, 'admin', %s,
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, COALESCE(%s, NOW())
                )
                ON CONFLICT (dedupe_key) DO UPDATE
                SET title = EXCLUDED.title,
                    body = EXCLUDED.body,
                    severity = EXCLUDED.severity,
                    priority = EXCLUDED.priority,
                    action_url = EXCLUDED.action_url,
                    payload = EXCLUDED.payload
                RETURNING *
                """,
                (
                    notification.notification_id,
                    notification.dedupe_key,
                    notification.recipient_admin_id,
                    notification.event_type,
                    notification.category,
                    notification.severity,
                    notification.priority,
                    notification.title,
                    notification.body,
                    notification.action_url,
                    notification.resource_type,
                    notification.resource_id,
                    Jsonb(notification.payload),
                    notification.expires_at,
                    notification.created_at,
                ),
            )
            row = cur.fetchone()
        return _map_notification(row)

    def list_for_admin(
        self,
        *,
        admin_id: str,
        limit: int = 20,
        unread_only: bool = False,
    ) -> list[AdminInAppNotification]:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            if unread_only:
                cur.execute(
                    """
                    SELECT *
                    FROM synapse_in_app_notifications
                    WHERE recipient_type = 'admin'
                      AND recipient_admin_id = %s
                      AND archived_at IS NULL
                      AND read_at IS NULL
                    ORDER BY created_at DESC
                    LIMIT %s
                    """,
                    (admin_id, limit),
                )
            else:
                cur.execute(
                    """
                    SELECT *
                    FROM synapse_in_app_notifications
                    WHERE recipient_type = 'admin'
                      AND recipient_admin_id = %s
                      AND archived_at IS NULL
                    ORDER BY created_at DESC
                    LIMIT %s
                    """,
                    (admin_id, limit),
                )
            rows = cur.fetchall()
        return [_map_notification(row) for row in rows]

    def unread_count_for_admin(self, *, admin_id: str) -> int:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) AS total
                FROM synapse_in_app_notifications
                WHERE recipient_type = 'admin'
                  AND recipient_admin_id = %s
                  AND read_at IS NULL
                  AND archived_at IS NULL
                """,
                (admin_id,),
            )
            row = cur.fetchone()
        return int(row["total"])

    def mark_read(self, *, admin_id: str, notification_id: str) -> bool:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_in_app_notifications
                SET read_at = COALESCE(read_at, NOW())
                WHERE recipient_type = 'admin'
                  AND recipient_admin_id = %s
                  AND notification_id = %s
                  AND archived_at IS NULL
                RETURNING notification_id
                """,
                (admin_id, notification_id),
            )
            row = cur.fetchone()
        return row is not None

    def mark_all_read(self, *, admin_id: str) -> int:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_in_app_notifications
                SET read_at = COALESCE(read_at, NOW())
                WHERE recipient_type = 'admin'
                  AND recipient_admin_id = %s
                  AND read_at IS NULL
                  AND archived_at IS NULL
                """,
                (admin_id,),
            )
            return int(cur.rowcount or 0)

    def archive(self, *, admin_id: str, notification_id: str) -> bool:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_in_app_notifications
                SET archived_at = COALESCE(archived_at, NOW())
                WHERE recipient_type = 'admin'
                  AND recipient_admin_id = %s
                  AND notification_id = %s
                RETURNING notification_id
                """,
                (admin_id, notification_id),
            )
            row = cur.fetchone()
        return row is not None
