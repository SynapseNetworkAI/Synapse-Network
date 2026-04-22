from __future__ import annotations

from dataclasses import dataclass
from typing import Any


HIGH_PRIORITY_CATEGORIES = frozenset({"security", "transactional_high"})


@dataclass(frozen=True)
class NotificationIntent:
    notification_id: str
    dedupe_key: str
    event_type: str
    recipient_email: str
    template_key: str
    payload: dict[str, Any]
    recipient_owner_id: str | None = None
    priority: str = "transactional"
    template_version: str = "v1"


@dataclass(frozen=True)
class NotificationOutboxRow:
    row_id: int
    notification_id: str
    dedupe_key: str
    event_type: str
    recipient_email: str
    recipient_owner_id: str | None
    priority: str
    template_key: str
    template_version: str
    payload: dict[str, Any]
    attempt_count: int


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    text_body: str
    html_body: str


@dataclass(frozen=True)
class EmailSendResult:
    message_id: str | None
    provider_response: dict[str, Any]


class EmailQuotaExceeded(RuntimeError):
    """Raised when Gmail daily quota policy blocks a send attempt."""


class NotificationSuppressed(RuntimeError):
    """Raised when a row should not be sent but should remain auditable."""


class NotificationStorageUnsupported(RuntimeError):
    """Raised when a storage backend cannot drain notification rows."""


class EmailFromMissing(RuntimeError):
    """Raised when the sender address is not configured."""


class GmailCredentialsMissing(RuntimeError):
    """Raised when Gmail SMTP credentials are not configured."""


class UnknownNotificationTemplate(ValueError):
    """Raised when a notification template key is not registered."""


class InvalidNotificationIntent(ValueError):
    """Raised when an outbox intent is missing required fields."""
