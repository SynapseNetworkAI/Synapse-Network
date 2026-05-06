from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone
import logging
from typing import Any
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from src.domain import ForumResponseTask, ForumTopicContext
from src.storage.forum_support.support_notifications import enqueue_support_reply_notifications
from src.storage.forum_support.topic_repository import PostgresForumTopicRepositoryMixin

logger = logging.getLogger(__name__)
EXPECTED_FORUM_TOPIC_LIFECYCLE_COLUMNS = 3
TOPIC_LOCKED_ERROR = "Topic is locked"
FORUM_RESPONSE_TASKS_SCHEMA_ERROR = (
    "Forum support schema is missing. Apply infra/postgres/init/gateway/001_synapse_schema.sql "
    "or the equivalent migration before using /api/admin/v1/forum support endpoints."
)


def _connect(dsn: str):
    return psycopg.connect(dsn, row_factory=dict_row, connect_timeout=5)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _row_to_topic(row: dict[str, Any]) -> ForumTopicContext:
    return ForumTopicContext(
        topic_id=row["topic_id"],
        title=row["title"],
        body=row["body"],
        excerpt=row["excerpt"],
        category=row["category"],
        author_address=row["author_address"],
        author_display=row["author_display"],
        author_roles=tuple(row["author_roles"] or ()),
        topic_status=row["topic_status"],
        resolved=bool(row["resolved"]),
        locked=bool(row.get("locked", False)),
        pinned=bool(row.get("pinned", False)),
        views_count=int(row.get("views_count") or 0),
        replies_count=int(row["replies_count"] or 0),
        official_replies_count=int(row.get("official_replies_count") or 0),
        closed_reason=row.get("closed_reason"),
        closed_by_admin_id=row.get("closed_by_admin_id"),
        closed_at=row.get("closed_at"),
        created_at=row["topic_created_at"],
        updated_at=row["topic_updated_at"],
        last_activity_at=row["last_activity_at"],
    )


def _row_to_task(row: dict[str, Any]) -> ForumResponseTask:
    topic = _row_to_topic(row) if row.get("title") is not None else None
    return ForumResponseTask(
        response_task_id=row["response_task_id"],
        topic_id=row["topic_id"],
        status=row["status"],
        source=row["source"],
        priority=row["priority"],
        classification=row["classification"],
        suggested_reply=row["suggested_reply"],
        suggested_reply_source=row["suggested_reply_source"],
        suggested_reply_updated_at=row["suggested_reply_updated_at"],
        replied_by_admin_id=row["replied_by_admin_id"],
        reply_id=row["reply_id"],
        responded_at=row["responded_at"],
        linked_requirement_candidate_id=row["linked_requirement_candidate_id"],
        linked_requirement_id=row["linked_requirement_id"],
        linked_workflow_run_id=row["linked_workflow_run_id"],
        metadata=row["metadata_json"] or {},
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        topic=topic,
    )


class PostgresForumSupportRepository(PostgresForumTopicRepositoryMixin):
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    @property
    def dsn(self) -> str:
        return self._dsn

    def ensure_schema(self) -> None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT to_regclass('public.synapse_forum_response_tasks') AS table_name")
            response_tasks_exists = bool(cur.fetchone()["table_name"])
            cur.execute("SELECT to_regclass('public.synapse_forum_topic_events') AS table_name")
            events_exists = bool(cur.fetchone()["table_name"])
            cur.execute(
                """
                SELECT COUNT(*) AS present_columns
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'synapse_forum_topics'
                  AND column_name IN ('closed_reason', 'closed_by_admin_id', 'closed_at')
                """
            )
            forum_ticket_columns_exist = int(cur.fetchone()["present_columns"] or 0) == EXPECTED_FORUM_TOPIC_LIFECYCLE_COLUMNS
            if response_tasks_exists and events_exists and forum_ticket_columns_exist:
                return
            logger.error("forum support schema missing or stale: response_tasks=%s topic_events=%s ticket_columns=%s", response_tasks_exists, events_exists, forum_ticket_columns_exist)
            raise RuntimeError(FORUM_RESPONSE_TASKS_SCHEMA_ERROR)

    def backfill_open_topic_tasks(self, *, limit: int = 200) -> int:
        self.ensure_schema()
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_forum_response_tasks (
                    response_task_id, topic_id, status, source, priority, classification, created_at, updated_at
                )
                SELECT
                    'frt_' || substring(md5(topic.topic_id), 1, 20),
                    topic.topic_id,
                    'awaiting_response',
                    'user_post',
                    CASE
                        WHEN topic.category = 'Bugs' THEN 'high'
                        WHEN topic.category IN ('Questions', 'Feature Requests', 'Provider Services', 'SDKs') THEN 'normal'
                        ELSE 'low'
                    END,
                    CASE
                        WHEN topic.category = 'Bugs' THEN 'bug'
                        WHEN topic.category = 'Feature Requests' THEN 'feature_request'
                        WHEN topic.category = 'Questions' THEN 'question'
                        WHEN topic.category = 'SDKs' THEN 'docs_issue'
                        ELSE NULL
                    END,
                    COALESCE(topic.created_at, NOW()),
                    NOW()
                FROM synapse_forum_topics topic
                WHERE topic.status IN ('open', 'awaiting_admin')
                  AND topic.resolved = FALSE
                  AND NOT EXISTS (
                    SELECT 1
                    FROM synapse_forum_response_tasks task
                    WHERE task.topic_id = topic.topic_id
                      AND task.status IN ('awaiting_response', 'draft_ready', 'responded', 'ignored', 'closed')
                  )
                ORDER BY topic.created_at DESC
                LIMIT %s
                ON CONFLICT DO NOTHING
                """,
                (limit,),
            )
            return cur.rowcount or 0

    def list_tasks(
        self,
        *,
        statuses: Sequence[str],
        page: int,
        page_size: int,
        classification: str | None = None,
    ) -> tuple[list[ForumResponseTask], int]:
        self.backfill_open_topic_tasks()
        params: list[Any] = [list(statuses)]
        clauses = ["task.status = ANY(%s)"]
        if classification:
            clauses.append("task.classification = %s")
            params.append(classification)
        where_sql = " AND ".join(clauses)
        offset = (page - 1) * page_size
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            count_sql = f"""
                SELECT COUNT(*) AS total
                FROM synapse_forum_response_tasks task
                JOIN synapse_forum_topics topic ON topic.topic_id = task.topic_id
                WHERE {where_sql}
                """  # noqa: S608 - where_sql is assembled from fixed clauses plus parameter placeholders.
            cur.execute(
                count_sql,
                params,
            )
            total = int(cur.fetchone()["total"] or 0)
            tasks_sql = f"""
                SELECT
                    task.*,
                    topic.title, topic.body, topic.excerpt, topic.category,
                    topic.author_address, topic.author_display, topic.author_roles,
                    topic.status AS topic_status, topic.resolved, topic.locked, topic.pinned,
                    topic.views_count, topic.replies_count, topic.closed_reason,
                    topic.closed_by_admin_id, topic.closed_at,
                    (
                        SELECT COUNT(*)
                        FROM synapse_forum_replies reply
                        WHERE reply.topic_id = topic.topic_id
                          AND reply.status <> 'hidden'
                          AND 'Ops' = ANY(reply.author_roles)
                    ) AS official_replies_count,
                    topic.created_at AS topic_created_at,
                    topic.updated_at AS topic_updated_at,
                    topic.last_activity_at
                FROM synapse_forum_response_tasks task
                JOIN synapse_forum_topics topic ON topic.topic_id = task.topic_id
                WHERE {where_sql}
                ORDER BY task.created_at DESC, task.response_task_id ASC
                LIMIT %s OFFSET %s
                """  # noqa: S608 - where_sql is assembled from fixed clauses plus parameter placeholders.
            cur.execute(
                tasks_sql,
                [*params, page_size, offset],
            )
            rows = cur.fetchall()
        return [_row_to_task(row) for row in rows], total

    def get_task(self, task_id: str) -> ForumResponseTask | None:
        self.ensure_schema()
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    task.*,
                    topic.title, topic.body, topic.excerpt, topic.category,
                    topic.author_address, topic.author_display, topic.author_roles,
                    topic.status AS topic_status, topic.resolved, topic.locked, topic.pinned,
                    topic.views_count, topic.replies_count, topic.closed_reason,
                    topic.closed_by_admin_id, topic.closed_at,
                    (
                        SELECT COUNT(*)
                        FROM synapse_forum_replies reply
                        WHERE reply.topic_id = topic.topic_id
                          AND reply.status <> 'hidden'
                          AND 'Ops' = ANY(reply.author_roles)
                    ) AS official_replies_count,
                    topic.created_at AS topic_created_at,
                    topic.updated_at AS topic_updated_at,
                    topic.last_activity_at
                FROM synapse_forum_response_tasks task
                JOIN synapse_forum_topics topic ON topic.topic_id = task.topic_id
                WHERE task.response_task_id = %s
                """,
                (task_id,),
            )
            row = cur.fetchone()
        return _row_to_task(row) if row else None

    def get_active_task_for_topic(self, topic_id: str) -> ForumResponseTask | None:
        self.ensure_schema()
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    task.*,
                    topic.title, topic.body, topic.excerpt, topic.category,
                    topic.author_address, topic.author_display, topic.author_roles,
                    topic.status AS topic_status, topic.resolved, topic.locked, topic.pinned,
                    topic.views_count, topic.replies_count, topic.closed_reason,
                    topic.closed_by_admin_id, topic.closed_at,
                    (
                        SELECT COUNT(*)
                        FROM synapse_forum_replies reply
                        WHERE reply.topic_id = topic.topic_id
                          AND reply.status <> 'hidden'
                          AND 'Ops' = ANY(reply.author_roles)
                    ) AS official_replies_count,
                    topic.created_at AS topic_created_at,
                    topic.updated_at AS topic_updated_at,
                    topic.last_activity_at
                FROM synapse_forum_response_tasks task
                JOIN synapse_forum_topics topic ON topic.topic_id = task.topic_id
                WHERE task.topic_id = %s
                  AND task.status IN ('awaiting_response', 'draft_ready')
                ORDER BY task.updated_at DESC
                LIMIT 1
                """,
                (topic_id,),
            )
            row = cur.fetchone()
        return _row_to_task(row) if row else None

    def update_suggestion(
        self,
        *,
        task_id: str,
        classification: str,
        priority: str,
        suggested_reply: str,
        linked_requirement_candidate_id: str | None,
        linked_requirement_id: str | None,
        linked_workflow_run_id: str | None,
        metadata: dict[str, Any],
    ) -> ForumResponseTask | None:
        self.ensure_schema()
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_forum_response_tasks
                SET status = 'draft_ready',
                    source = 'growing_agent',
                    classification = %s,
                    priority = %s,
                    suggested_reply = %s,
                    suggested_reply_source = 'growing',
                    suggested_reply_updated_at = NOW(),
                    linked_requirement_candidate_id = %s,
                    linked_requirement_id = %s,
                    linked_workflow_run_id = %s,
                    metadata_json = COALESCE(metadata_json, '{}'::jsonb) || %s,
                    updated_at = NOW()
                WHERE response_task_id = %s
                  AND status IN ('awaiting_response', 'draft_ready')
                """,
                (
                    classification,
                    priority,
                    suggested_reply,
                    linked_requirement_candidate_id,
                    linked_requirement_id,
                    linked_workflow_run_id,
                    Jsonb(metadata),
                    task_id,
                ),
            )
        return self.get_task(task_id)

    def send_reply(
        self,
        *,
        task_id: str,
        body: str,
        admin_id: str,
        admin_display: str,
        admin_address: str,
    ) -> ForumResponseTask | None:
        self.ensure_schema()
        now = _utcnow()
        reply_id = f"reply_admin_{uuid4().hex[:20]}"
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT task.topic_id, task.metadata_json, topic.locked, topic.author_address, topic.title
                FROM synapse_forum_response_tasks task
                JOIN synapse_forum_topics topic ON topic.topic_id = task.topic_id
                WHERE task.response_task_id = %s
                  AND task.status IN ('awaiting_response', 'draft_ready')
                FOR UPDATE
                """,
                (task_id,),
            )
            row = cur.fetchone()
            if not row:
                return None
            if bool(row["locked"]):
                raise ValueError(TOPIC_LOCKED_ERROR)
            topic_id = row["topic_id"]
            metadata = dict(row.get("metadata_json") or {})
            author_address = str(row.get("author_address") or "")
            topic_title = str(row.get("title") or "")
            cur.execute(
                """
                INSERT INTO synapse_forum_replies (
                    reply_id, topic_id, body, author_address, author_display,
                    author_roles, status, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, 'visible', %s, %s)
                """,
                (
                    reply_id,
                    topic_id,
                    body,
                    admin_address,
                    admin_display,
                    ["Ops"],
                    now,
                    now,
                ),
            )
            cur.execute(
                """
                UPDATE synapse_forum_topics
                SET replies_count = replies_count + 1,
                    status = CASE WHEN status IN ('open', 'awaiting_admin') THEN 'answered' ELSE status END,
                    last_activity_at = %s,
                    updated_at = %s
                WHERE topic_id = %s
                """,
                (now, now, topic_id),
            )
            cur.execute(
                """
                UPDATE synapse_forum_response_tasks
                SET status = 'responded',
                    source = 'admin',
                    replied_by_admin_id = %s,
                    reply_id = %s,
                    responded_at = %s,
                    updated_at = %s,
                    metadata_json = COALESCE(metadata_json, '{}'::jsonb) || %s
                WHERE response_task_id = %s
                """,
                (
                    admin_id,
                    reply_id,
                    now,
                    now,
                    Jsonb({"lastReplyBodyPreview": body[:240]}),
                    task_id,
                ),
            )
            enqueue_support_reply_notifications(
                cur,
                topic_id=topic_id,
                reply_id=reply_id,
                task_id=task_id,
                author_address=author_address,
                topic_title=topic_title,
                body=body,
                metadata=metadata,
            )
        return self.get_task(task_id)

    def ignore_task(self, *, task_id: str, admin_id: str, reason: str) -> ForumResponseTask | None:
        self.ensure_schema()
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_forum_response_tasks
                SET status = 'ignored',
                    source = 'admin',
                    updated_at = NOW(),
                    metadata_json = COALESCE(metadata_json, '{}'::jsonb) || %s
                WHERE response_task_id = %s
                  AND status IN ('awaiting_response', 'draft_ready')
                """,
                (
                    Jsonb({"ignoredBy": admin_id, "ignoreReason": reason}),
                    task_id,
                ),
            )
        return self.get_task(task_id)
