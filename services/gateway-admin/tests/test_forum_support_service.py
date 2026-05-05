from __future__ import annotations

from datetime import datetime, timezone

import pytest

from src.core.errors import BadRequestError
from src.domain import ForumResponseTask, ForumTopicContext
from src.services.auth.service import AdminIdentity
from src.services.forum_support.service import ForumSupportService


class LockedTopicRepository:
    def send_reply(self, **_kwargs):
        raise ValueError("Topic is locked")


class AlreadyClosedRepository:
    def __init__(self, status: str) -> None:
        self.status = status

    def send_reply(self, **_kwargs):
        return None

    def ignore_task(self, **_kwargs):
        return None

    def get_task(self, task_id: str):
        return _task(task_id, self.status)


def _task(task_id: str, status: str) -> ForumResponseTask:
    now = datetime.now(timezone.utc)
    return ForumResponseTask(
        response_task_id=task_id,
        topic_id="topic_demo",
        status=status,
        source="admin",
        priority="normal",
        classification="question",
        suggested_reply="Thanks, we are reviewing this.",
        reply_id="reply_existing" if status == "responded" else None,
        responded_at=now if status == "responded" else None,
        created_at=now,
        updated_at=now,
        topic=ForumTopicContext(
            topic_id="topic_demo",
            title="Already processed topic",
            body="This task was processed by another admin.",
            excerpt="Already processed",
            category="Questions",
            author_address="0x123",
            author_display="0x123",
            created_at=now,
            updated_at=now,
            last_activity_at=now,
        ),
    )


def test_forum_support_service_rejects_locked_topic_replies() -> None:
    service = ForumSupportService(LockedTopicRepository())  # type: ignore[arg-type]
    admin = AdminIdentity(
        admin_id="adm_ops",
        email="ops@synapse-network.ai",
        display_name="Ops",
        role="platform_ops_admin",
        permissions=("support:reply",),
    )

    with pytest.raises(BadRequestError, match="Topic is locked"):
        service.send_reply(
            "frt_locked",
            {
                "body": "Thanks, we are reviewing this.",
                "authorDisplay": "Synapse Ops",
                "authorAddress": "synapse:ops",
            },
            admin=admin,
        )


def test_forum_support_send_reply_returns_current_task_when_already_closed() -> None:
    service = ForumSupportService(AlreadyClosedRepository("responded"))  # type: ignore[arg-type]
    admin = AdminIdentity(
        admin_id="adm_ops",
        email="ops@synapse-network.ai",
        display_name="Ops",
        role="platform_ops_admin",
        permissions=("support:reply",),
    )

    result = service.send_reply(
        "frt_closed",
        {
            "body": "Thanks, we are reviewing this.",
            "authorDisplay": "Synapse Ops",
            "authorAddress": "synapse:ops",
        },
        admin=admin,
    )

    assert result["responseTaskId"] == "frt_closed"
    assert result["status"] == "responded"
    assert result["replyId"] == "reply_existing"


def test_forum_support_ignore_returns_current_task_when_already_closed() -> None:
    service = ForumSupportService(AlreadyClosedRepository("ignored"))  # type: ignore[arg-type]
    admin = AdminIdentity(
        admin_id="adm_ops",
        email="ops@synapse-network.ai",
        display_name="Ops",
        role="platform_ops_admin",
        permissions=("support:triage",),
    )

    result = service.ignore_task(
        "frt_closed",
        {"reason": "Already handled by another admin."},
        admin=admin,
    )

    assert result["responseTaskId"] == "frt_closed"
    assert result["status"] == "ignored"
