from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from psycopg.types.json import Jsonb

from src.domain import ForumResponseTask, ForumTopicContext


def _connect(dsn: str):
    import psycopg
    from psycopg.rows import dict_row

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
        replies_count=int(row["replies_count"] or 0),
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


class PostgresForumSupportRepository:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    @property
    def dsn(self) -> str:
        return self._dsn

    def ensure_schema(self) -> None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS synapse_forum_response_tasks (
                    response_task_id TEXT PRIMARY KEY,
                    topic_id TEXT NOT NULL REFERENCES synapse_forum_topics (topic_id) ON DELETE CASCADE,
                    status TEXT NOT NULL DEFAULT 'awaiting_response',
                    source TEXT NOT NULL DEFAULT 'user_post',
                    priority TEXT NOT NULL DEFAULT 'normal',
                    classification TEXT,
                    suggested_reply TEXT,
                    suggested_reply_source TEXT,
                    suggested_reply_updated_at TIMESTAMPTZ,
                    replied_by_admin_id TEXT,
                    reply_id TEXT REFERENCES synapse_forum_replies (reply_id) ON DELETE SET NULL,
                    responded_at TIMESTAMPTZ,
                    linked_requirement_candidate_id TEXT,
                    linked_requirement_id TEXT,
                    linked_workflow_run_id TEXT,
                    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    CHECK (status IN ('awaiting_response', 'draft_ready', 'responded', 'ignored', 'closed')),
                    CHECK (source IN ('user_post', 'growing_agent', 'admin')),
                    CHECK (priority IN ('low', 'normal', 'high', 'critical')),
                    CHECK (
                        classification IS NULL OR classification IN (
                            'question', 'bug', 'feature_request', 'docs_issue',
                            'needs_more_info', 'spam'
                        )
                    )
                )
                """
            )
            cur.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_synapse_forum_response_tasks_active_topic
                ON synapse_forum_response_tasks (topic_id)
                WHERE status IN ('awaiting_response', 'draft_ready')
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_synapse_forum_response_tasks_status_updated
                ON synapse_forum_response_tasks (status, updated_at DESC)
                """
            )

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
                WHERE topic.status = 'open'
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
            cur.execute(
                f"""
                SELECT COUNT(*) AS total
                FROM synapse_forum_response_tasks task
                JOIN synapse_forum_topics topic ON topic.topic_id = task.topic_id
                WHERE {where_sql}
                """,
                params,
            )
            total = int(cur.fetchone()["total"] or 0)
            cur.execute(
                f"""
                SELECT
                    task.*,
                    topic.title, topic.body, topic.excerpt, topic.category,
                    topic.author_address, topic.author_display, topic.author_roles,
                    topic.status AS topic_status, topic.resolved, topic.replies_count,
                    topic.created_at AS topic_created_at,
                    topic.updated_at AS topic_updated_at,
                    topic.last_activity_at
                FROM synapse_forum_response_tasks task
                JOIN synapse_forum_topics topic ON topic.topic_id = task.topic_id
                WHERE {where_sql}
                ORDER BY
                    CASE task.priority
                        WHEN 'critical' THEN 0
                        WHEN 'high' THEN 1
                        WHEN 'normal' THEN 2
                        ELSE 3
                    END,
                    task.updated_at DESC
                LIMIT %s OFFSET %s
                """,
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
                    topic.status AS topic_status, topic.resolved, topic.replies_count,
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
                SELECT task.topic_id, topic.locked
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
                raise ValueError("Topic is locked")
            topic_id = row["topic_id"]
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
