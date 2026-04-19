from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(slots=True, frozen=True)
class ForumTopicContext:
    topic_id: str
    title: str
    body: str
    excerpt: str
    category: str
    author_address: str
    author_display: str
    author_roles: tuple[str, ...] = field(default_factory=tuple)
    topic_status: str = "open"
    resolved: bool = False
    locked: bool = False
    pinned: bool = False
    views_count: int = 0
    replies_count: int = 0
    official_replies_count: int = 0
    closed_reason: str | None = None
    closed_by_admin_id: str | None = None
    closed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    last_activity_at: datetime | None = None


@dataclass(slots=True, frozen=True)
class ForumTopicEvent:
    event_id: str
    topic_id: str
    actor_admin_id: str | None
    action: str
    from_status: str | None
    to_status: str | None
    reason: str | None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None


@dataclass(slots=True, frozen=True)
class ForumResponseTask:
    response_task_id: str
    topic_id: str
    status: str
    source: str
    priority: str
    classification: str | None = None
    suggested_reply: str | None = None
    suggested_reply_source: str | None = None
    suggested_reply_updated_at: datetime | None = None
    replied_by_admin_id: str | None = None
    reply_id: str | None = None
    responded_at: datetime | None = None
    linked_requirement_candidate_id: str | None = None
    linked_requirement_id: str | None = None
    linked_workflow_run_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None
    topic: ForumTopicContext | None = None
