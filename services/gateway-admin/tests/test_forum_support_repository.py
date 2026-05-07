from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pytest

from src.storage.forum_support import postgres, topic_repository
from src.storage.forum_support.support_notifications import enqueue_support_reply_notifications

_DEFAULT_OWNER = object()


class FakeCursor:
    def __init__(self, table_names: list[str | None], present_columns: int = 3) -> None:
        self.table_names = table_names
        self.present_columns = present_columns
        self.queries: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, query: str, *_args, **_kwargs) -> None:
        self.queries.append(query)

    def fetchone(self):
        if len(self.queries) <= 2:
            return {"table_name": self.table_names.pop(0) if self.table_names else None}
        return {"present_columns": self.present_columns}


class FakeConnection:
    def __init__(self, cursor: FakeCursor) -> None:
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return self._cursor


class ScriptedCursor:
    def __init__(self, results: list[Any] | None = None) -> None:
        self.results = list(results or [])
        self.queries: list[tuple[str, Any]] = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, query: str, params: Any = None, **_kwargs) -> None:
        self.queries.append((query, params))

    def fetchone(self):
        return self.results.pop(0) if self.results else None

    def fetchall(self):
        return self.results.pop(0) if self.results else []


def _task_row(**overrides: Any) -> dict[str, Any]:
    now = datetime(2026, 4, 29, 12, 0, 0, tzinfo=timezone.utc)
    row: dict[str, Any] = {
        "response_task_id": "frt_1",
        "topic_id": "topic_1",
        "status": "awaiting_response",
        "source": "user_post",
        "priority": "normal",
        "classification": "billing_support",
        "suggested_reply": None,
        "suggested_reply_source": None,
        "suggested_reply_updated_at": None,
        "replied_by_admin_id": None,
        "reply_id": None,
        "responded_at": None,
        "linked_requirement_candidate_id": None,
        "linked_requirement_id": None,
        "linked_workflow_run_id": None,
        "metadata_json": {"feedbackId": "fbk_1", "supportCategory": "billing_support"},
        "created_at": now,
        "updated_at": now,
        "title": "Billing Support: refund stuck",
        "body": "Please check my refund.",
        "excerpt": "Please check my refund.",
        "category": "Billing",
        "author_address": "0xabc0000000000000000000000000000000000000",
        "author_display": "Owner",
        "author_roles": ["Owner"],
        "topic_status": "open",
        "resolved": False,
        "locked": False,
        "pinned": False,
        "views_count": 1,
        "replies_count": 0,
        "closed_reason": None,
        "closed_by_admin_id": None,
        "closed_at": None,
        "official_replies_count": 0,
        "topic_created_at": now,
        "topic_updated_at": now,
        "last_activity_at": now,
    }
    row.update(overrides)
    return row


def test_forum_support_schema_probe_does_not_run_ddl_when_table_exists(monkeypatch: pytest.MonkeyPatch) -> None:
    cursor = FakeCursor(["synapse_forum_response_tasks", "synapse_forum_topic_events"], present_columns=3)
    monkeypatch.setattr(postgres, "_connect", lambda _dsn: FakeConnection(cursor))

    postgres.PostgresForumSupportRepository("postgresql://example").ensure_schema()

    assert len(cursor.queries) == 3
    assert "to_regclass" in cursor.queries[0]
    assert "information_schema.columns" in cursor.queries[2]


def test_forum_support_schema_probe_reports_missing_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    cursor = FakeCursor([None, None], present_columns=0)
    monkeypatch.setattr(postgres, "_connect", lambda _dsn: FakeConnection(cursor))

    with pytest.raises(RuntimeError, match="Forum support schema is missing"):
        postgres.PostgresForumSupportRepository("postgresql://example").ensure_schema()


def test_forum_support_repository_lists_tasks_with_classification(monkeypatch: pytest.MonkeyPatch) -> None:
    cursor = ScriptedCursor([{"total": 1}, [_task_row()]])
    repo = postgres.PostgresForumSupportRepository("postgresql://example")
    monkeypatch.setattr(repo, "backfill_open_topic_tasks", lambda: 0)
    monkeypatch.setattr(postgres, "_connect", lambda _dsn: FakeConnection(cursor))

    tasks, total = repo.list_tasks(
        statuses=("awaiting_response",),
        page=2,
        page_size=10,
        classification="billing_support",
    )

    assert total == 1
    assert tasks[0].response_task_id == "frt_1"
    assert tasks[0].topic is not None
    assert any("task.classification = %s" in query for query, _ in cursor.queries)
    task_query = cursor.queries[-1][0]
    assert "ORDER BY task.created_at DESC, task.response_task_id ASC" in task_query
    assert "task.updated_at DESC" not in task_query
    assert "CASE task.priority" not in task_query
    assert cursor.queries[-1][1] == [["awaiting_response"], "billing_support", 10, 10]


def test_forum_support_repository_lists_topics_by_created_desc(monkeypatch: pytest.MonkeyPatch) -> None:
    cursor = ScriptedCursor([{"total": 1}, [_task_row(topic_id="topic_1")]])
    repo = postgres.PostgresForumSupportRepository("postgresql://example")
    monkeypatch.setattr(repo, "ensure_schema", lambda: None)
    monkeypatch.setattr(topic_repository, "_connect", lambda _dsn: FakeConnection(cursor))

    topics, total = repo.list_topics(
        statuses=("open",),
        page=1,
        page_size=10,
    )

    assert total == 1
    assert topics[0].topic_id == "topic_1"
    topic_query = cursor.queries[-1][0]
    assert "ORDER BY topic.created_at DESC, topic.topic_id ASC" in topic_query
    assert "topic.pinned DESC" not in topic_query
    assert "topic.last_activity_at DESC" not in topic_query


def test_forum_support_repository_send_reply_rejects_locked_topic(monkeypatch: pytest.MonkeyPatch) -> None:
    cursor = ScriptedCursor(
        [
            {
                "topic_id": "topic_1",
                "metadata_json": {},
                "locked": True,
                "author_address": "0xabc",
                "title": "Locked topic",
            }
        ]
    )
    repo = postgres.PostgresForumSupportRepository("postgresql://example")
    monkeypatch.setattr(repo, "ensure_schema", lambda: None)
    monkeypatch.setattr(postgres, "_connect", lambda _dsn: FakeConnection(cursor))

    with pytest.raises(ValueError, match=postgres.TOPIC_LOCKED_ERROR):
        repo.send_reply(
            task_id="frt_1",
            body="Reply",
            admin_id="admin_1",
            admin_display="Ops",
            admin_address="0xops",
        )


def test_forum_support_repository_send_reply_updates_task_and_enqueues_notifications(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cursor = ScriptedCursor(
        [
            {
                "topic_id": "topic_1",
                "metadata_json": {"feedbackId": "fbk_1"},
                "locked": False,
                "author_address": "0xabc",
                "title": "Billing Support: refund stuck",
            }
        ]
    )
    notified: dict[str, Any] = {}
    repo = postgres.PostgresForumSupportRepository("postgresql://example")
    monkeypatch.setattr(repo, "ensure_schema", lambda: None)
    monkeypatch.setattr(
        repo,
        "get_task",
        lambda task_id: postgres._row_to_task(_task_row(response_task_id=task_id, status="responded")),
    )
    monkeypatch.setattr(postgres, "_connect", lambda _dsn: FakeConnection(cursor))

    def fake_enqueue(_cur: Any, **kwargs: Any) -> None:
        notified.update(kwargs)

    monkeypatch.setattr(postgres, "enqueue_support_reply_notifications", fake_enqueue)

    task = repo.send_reply(
        task_id="frt_1",
        body="We checked this and replied.",
        admin_id="admin_1",
        admin_display="Ops",
        admin_address="0xops",
    )

    text = "\n".join(query for query, _ in cursor.queries)
    assert task is not None
    assert task.status == "responded"
    assert "INSERT INTO synapse_forum_replies" in text
    assert "UPDATE synapse_forum_response_tasks" in text
    assert notified["topic_id"] == "topic_1"
    assert notified["metadata"] == {"feedbackId": "fbk_1"}


class FakeNotificationCursor:
    def __init__(self, owner: dict[str, Any] | None | object = _DEFAULT_OWNER) -> None:
        self.queries: list[str] = []
        self.owner = owner

    def execute(self, query: str, *_args, **_kwargs) -> None:
        self.queries.append(query)

    def fetchone(self):
        if self.owner is not _DEFAULT_OWNER:
            return self.owner
        return {
            "owner_wallet": "0xabc0000000000000000000000000000000000000",
            "email": "owner@synapse.test",
            "email_verified": True,
        }


def test_support_reply_notification_enqueue_writes_in_app_and_email_outbox() -> None:
    cursor = FakeNotificationCursor()
    enqueue_support_reply_notifications(
        cursor,
        topic_id="support_topic",
        reply_id="reply_1",
        task_id="frt_1",
        author_address="0xabc0000000000000000000000000000000000000",
        topic_title="Billing Support: refund stuck",
        body="We checked this and replied.",
        metadata={"feedbackId": "fbk_1", "supportCategory": "billing_support"},
    )

    text = "\n".join(cursor.queries)
    assert "INSERT INTO synapse_in_app_notifications" in text
    assert "INSERT INTO synapse_notification_outbox" in text
    assert "support_reply" in text


def test_support_reply_notification_skips_anonymous_or_missing_owner() -> None:
    anonymous_cursor = FakeNotificationCursor()
    enqueue_support_reply_notifications(
        anonymous_cursor,
        topic_id="support_topic",
        reply_id="reply_1",
        task_id="frt_1",
        author_address="anonymous",
        topic_title="Billing Support",
        body="Reply",
        metadata={},
    )
    assert anonymous_cursor.queries == []

    missing_owner_cursor = FakeNotificationCursor(owner=None)
    enqueue_support_reply_notifications(
        missing_owner_cursor,
        topic_id="support_topic",
        reply_id="reply_1",
        task_id="frt_1",
        author_address="0xabc",
        topic_title="Billing Support",
        body="Reply",
        metadata={},
    )
    assert len(missing_owner_cursor.queries) == 1


def test_support_reply_notification_skips_email_for_unverified_owner() -> None:
    cursor = FakeNotificationCursor(
        owner={
            "owner_wallet": "0xabc0000000000000000000000000000000000000",
            "email": "owner@synapse.test",
            "email_verified": False,
        }
    )

    enqueue_support_reply_notifications(
        cursor,
        topic_id="support_topic",
        reply_id="reply_1",
        task_id="frt_1",
        author_address="0xabc0000000000000000000000000000000000000",
        topic_title="Billing Support",
        body="Reply",
        metadata={},
    )

    text = "\n".join(cursor.queries)
    assert "INSERT INTO synapse_in_app_notifications" in text
    assert "INSERT INTO synapse_notification_outbox" not in text
