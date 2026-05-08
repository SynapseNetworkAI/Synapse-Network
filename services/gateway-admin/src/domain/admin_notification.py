from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(slots=True, frozen=True)
class AdminInAppNotification:
    notification_id: str
    dedupe_key: str
    recipient_admin_id: str
    event_type: str
    category: str
    severity: str
    priority: str
    title: str
    body: str
    action_url: str | None = None
    resource_type: str | None = None
    resource_id: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    read_at: datetime | None = None
    archived_at: datetime | None = None
    expires_at: datetime | None = None
    created_at: datetime | None = None
