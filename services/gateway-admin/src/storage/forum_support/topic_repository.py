from __future__ import annotations

from collections.abc import Sequence
from typing import Any
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row

from src.domain import ForumTopicContext, ForumTopicEvent


def _connect(dsn: str):
    return psycopg.connect(dsn, row_factory=dict_row, connect_timeout=5)


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


def _row_to_event(row: dict[str, Any]) -> ForumTopicEvent:
    return ForumTopicEvent(
        event_id=row["event_id"],
        topic_id=row["topic_id"],
        actor_admin_id=row["actor_admin_id"],
        action=row["action"],
        from_status=row["from_status"],
        to_status=row["to_status"],
        reason=row["reason"],
        metadata=row["metadata_json"] or {},
        created_at=row["created_at"],
    )


TOPIC_SELECT_SQL = """
    SELECT topic.topic_id, topic.title, topic.body, topic.excerpt, topic.category,
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
    FROM synapse_forum_topics topic
"""


class PostgresForumTopicRepositoryMixin:
    _dsn: str

    def ensure_schema(self) -> None:
        raise NotImplementedError

    def list_topics(
        self,
        *,
        statuses: Sequence[str],
        page: int,
        page_size: int,
        category: str | None = None,
        q: str | None = None,
        pinned: bool | None = None,
    ) -> tuple[list[ForumTopicContext], int]:
        self.ensure_schema()
        params: list[Any] = [list(statuses)]
        clauses = ["topic.status = ANY(%s)"]
        if category:
            clauses.append("topic.category = %s")
            params.append(category)
        if q:
            clauses.append("(topic.title ILIKE %s OR topic.body ILIKE %s)")
            like = f"%{q.strip()[:120]}%"
            params.extend([like, like])
        if pinned is not None:
            clauses.append("topic.pinned = %s")
            params.append(pinned)
        where_sql = " AND ".join(clauses)
        offset = (page - 1) * page_size
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            count_sql = f"SELECT COUNT(*) AS total FROM synapse_forum_topics topic WHERE {where_sql}"  # noqa: S608 - where_sql is assembled from fixed clauses plus parameter placeholders.
            cur.execute(count_sql, params)
            total = int(cur.fetchone()["total"] or 0)
            cur.execute(
                f"""
                {TOPIC_SELECT_SQL}
                WHERE {where_sql}
                ORDER BY topic.created_at DESC, topic.topic_id ASC
                LIMIT %s OFFSET %s
                """,
                [*params, page_size, offset],
            )
            rows = cur.fetchall()
        return [_row_to_topic(row) for row in rows], total

    def get_topic_context(self, topic_id: str) -> ForumTopicContext | None:
        return self.get_topic_by_id(topic_id)

    def get_topic_by_id(self, topic_id: str) -> ForumTopicContext | None:
        self.ensure_schema()
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(f"{TOPIC_SELECT_SQL} WHERE topic.topic_id = %s", (topic_id,))
            row = cur.fetchone()
        return _row_to_topic(row) if row else None

    def list_topic_events(self, topic_id: str) -> list[ForumTopicEvent]:
        self.ensure_schema()
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT event_id, topic_id, actor_admin_id, action, from_status, to_status,
                       reason, metadata_json, created_at
                FROM synapse_forum_topic_events
                WHERE topic_id = %s
                ORDER BY created_at DESC
                LIMIT 100
                """,
                (topic_id,),
            )
            rows = cur.fetchall()
        return [_row_to_event(row) for row in rows]

    def update_topic_lifecycle(
        self,
        *,
        topic_id: str,
        admin_id: str,
        action: str,
        to_status: str | None = None,
        pinned: bool | None = None,
        reason: str | None = None,
    ) -> ForumTopicContext | None:
        self.ensure_schema()
        event_id = f"fte_{uuid4().hex[:20]}"
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT status FROM synapse_forum_topics WHERE topic_id = %s FOR UPDATE", (topic_id,))
            row = cur.fetchone()
            if not row:
                return None
            from_status = row["status"]
            if action == "close":
                cur.execute(
                    """
                    UPDATE synapse_forum_topics
                    SET status = 'closed', locked = TRUE, closed_reason = %s,
                        closed_by_admin_id = %s, closed_at = NOW(), updated_at = NOW()
                    WHERE topic_id = %s
                    """,
                    (reason, admin_id, topic_id),
                )
                to_status = "closed"
            elif action == "reopen":
                cur.execute(
                    """
                    UPDATE synapse_forum_topics
                    SET status = 'open', locked = FALSE, closed_reason = NULL,
                        closed_by_admin_id = NULL, closed_at = NULL, updated_at = NOW()
                    WHERE topic_id = %s
                    """,
                    (topic_id,),
                )
                to_status = "open"
            elif action in {"pin", "unpin"}:
                cur.execute(
                    "UPDATE synapse_forum_topics SET pinned = %s, updated_at = NOW() WHERE topic_id = %s",
                    (bool(pinned), topic_id),
                )
                to_status = from_status
            elif action == "resolve":
                cur.execute(
                    "UPDATE synapse_forum_topics SET status = 'resolved', resolved = TRUE, updated_at = NOW() WHERE topic_id = %s",
                    (topic_id,),
                )
                to_status = "resolved"
            else:
                cur.execute("UPDATE synapse_forum_topics SET status = %s, updated_at = NOW() WHERE topic_id = %s", (to_status, topic_id))
            cur.execute(
                """
                INSERT INTO synapse_forum_topic_events (
                    event_id, topic_id, actor_admin_id, action, from_status,
                    to_status, reason, metadata_json, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, '{}'::jsonb, NOW())
                """,
                (event_id, topic_id, admin_id, action, from_status, to_status, reason),
            )
        return self.get_topic_by_id(topic_id)
