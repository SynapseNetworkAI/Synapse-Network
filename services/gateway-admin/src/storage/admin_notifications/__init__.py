from src.storage.admin_notifications.in_memory import InMemoryAdminNotificationRepository
from src.storage.admin_notifications.postgres import PostgresAdminNotificationRepository

__all__ = [
    "InMemoryAdminNotificationRepository",
    "PostgresAdminNotificationRepository",
]
