from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any
from uuid import uuid4


@dataclass(frozen=True)
class SupportCaseFields:
    topic_id: str
    response_task_id: str
    topic_title: str
    topic_body: str
    topic_excerpt: str
    forum_category: str
    classification: str
    priority: str
    author_address: str
    author_display: str
    metadata: dict[str, Any]


ACTIONABLE_SUPPORT_CATEGORIES = frozenset({"billing_support", "bug_report", "docs_issue"})
SUPPORT_CATEGORY_TO_FORUM = {
    "billing_support": ("Questions", "question", "high"),
    "bug_report": ("Bugs", "bug", "high"),
    "docs_issue": ("SDKs", "docs_issue", "normal"),
}


def build_support_case_fields(
    *,
    feedback_id: str,
    category: str,
    message: str,
    route: str,
    title: str,
    owner: str | None,
    source: str,
    redact_text,
) -> SupportCaseFields | None:
    if category not in ACTIONABLE_SUPPORT_CATEGORIES:
        return None
    forum_category, classification, priority = SUPPORT_CATEGORY_TO_FORUM[category]
    topic_id = f"support_{uuid4().hex[:20]}"
    response_task_id = f"frt_{uuid4().hex[:20]}"
    label = category.replace("_", " ").title()
    topic_title = redact_text(f"{label}: {title or route or feedback_id}", max_len=160)
    body = "\n".join(
        [
            f"Feedback ID: {feedback_id}",
            f"Category: {category}",
            f"Source: {source}",
            f"Route: {route or '-'}",
            "",
            message or "(No message supplied.)",
        ]
    )
    author_address = owner or "anonymous"
    author_display = f"{author_address[:6]}...{author_address[-4:]}" if owner else "Anonymous builder"
    return SupportCaseFields(
        topic_id=topic_id,
        response_task_id=response_task_id,
        topic_title=topic_title,
        topic_body=redact_text(body, max_len=12000),
        topic_excerpt=redact_text(message or topic_title, max_len=400),
        forum_category=forum_category,
        classification=classification,
        priority=priority,
        author_address=author_address,
        author_display=author_display,
        metadata={
            "supportCase": True,
            "supportCategory": category,
            "feedbackId": feedback_id,
            "route": route,
            "source": source,
            "ownerAddress": owner,
        },
    )


def insert_support_case(cur: Any, support_case: SupportCaseFields) -> None:
    cur.execute(
        """
        INSERT INTO synapse_forum_topics (
            topic_id, title, body, excerpt, category, author_address,
            author_display, author_roles, status, resolved, locked, pinned,
            views_count, replies_count, reactions_count, last_activity_at, created_at, updated_at
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s,
            'awaiting_admin', FALSE, FALSE, FALSE, 0, 0, 0, NOW(), NOW(), NOW()
        )
        """,
        (
            support_case.topic_id,
            support_case.topic_title,
            support_case.topic_body,
            support_case.topic_excerpt,
            support_case.forum_category,
            support_case.author_address,
            support_case.author_display,
            ["Builder"],
        ),
    )
    cur.execute(
        """
        INSERT INTO synapse_forum_response_tasks (
            response_task_id, topic_id, status, source, priority, classification,
            metadata_json, created_at, updated_at
        ) VALUES (
            %s, %s, 'awaiting_response', 'user_post', %s, %s, %s::jsonb, NOW(), NOW()
        )
        ON CONFLICT DO NOTHING
        """,
        (
            support_case.response_task_id,
            support_case.topic_id,
            support_case.priority,
            support_case.classification,
            json.dumps(support_case.metadata),
        ),
    )


def _build_feedback_response(
    *,
    feedback_id: str,
    category: str,
    source: str,
    route: str,
    message: str,
    support_case: SupportCaseFields | None,
) -> dict[str, Any]:
    return {
        "status": "success",
        "feedbackId": feedback_id,
        "redacted": True,
        "message": "Feedback received.",
        "category": category,
        "source": source,
        "route": route,
        "messagePreview": message[:240],
        "supportCaseCreated": bool(support_case),
        "supportTaskId": support_case.response_task_id if support_case else None,
        "supportPriority": support_case.priority if support_case else None,
    }
