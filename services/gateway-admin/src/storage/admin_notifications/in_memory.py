from dataclasses import replace
from datetime import datetime, timezone

from src.domain import AdminInAppNotification


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class InMemoryAdminNotificationRepository:
    def __init__(self, notifications: list[AdminInAppNotification] | None = None) -> None:
        self._notifications = notifications or []

    def enqueue(self, notification: AdminInAppNotification) -> AdminInAppNotification:
        for index, current in enumerate(self._notifications):
            if current.dedupe_key == notification.dedupe_key:
                self._notifications[index] = notification
                return notification
        self._notifications.append(notification)
        return notification

    def list_for_admin(
        self,
        *,
        admin_id: str,
        limit: int = 20,
        unread_only: bool = False,
    ) -> list[AdminInAppNotification]:
        items = [
            item
            for item in self._notifications
            if item.recipient_admin_id == admin_id and item.archived_at is None
        ]
        if unread_only:
            items = [item for item in items if item.read_at is None]
        return sorted(items, key=lambda item: item.created_at or _utcnow(), reverse=True)[:limit]

    def unread_count_for_admin(self, *, admin_id: str) -> int:
        return len(
            [
                item
                for item in self._notifications
                if item.recipient_admin_id == admin_id and item.read_at is None and item.archived_at is None
            ]
        )

    def mark_read(self, *, admin_id: str, notification_id: str) -> bool:
        for index, item in enumerate(self._notifications):
            if item.recipient_admin_id == admin_id and item.notification_id == notification_id and item.archived_at is None:
                self._notifications[index] = replace(item, read_at=item.read_at or _utcnow())
                return True
        return False

    def mark_all_read(self, *, admin_id: str) -> int:
        count = 0
        for index, item in enumerate(self._notifications):
            if item.recipient_admin_id == admin_id and item.read_at is None and item.archived_at is None:
                self._notifications[index] = replace(item, read_at=_utcnow())
                count += 1
        return count

    def archive(self, *, admin_id: str, notification_id: str) -> bool:
        for index, item in enumerate(self._notifications):
            if item.recipient_admin_id == admin_id and item.notification_id == notification_id:
                self._notifications[index] = replace(item, archived_at=item.archived_at or _utcnow())
                return True
        return False
