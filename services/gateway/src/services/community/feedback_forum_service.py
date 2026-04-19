from __future__ import annotations

import asyncio
import json
import re
import time
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.storage import BaseStorage
from src.utils.datetime_utils import now_dt_str

SENSITIVE_KEY_PARTS = (
    "authorization",
    "bearer",
    "jwt",
    "token",
    "private",
    "secret",
    "password",
    "signature",
)
JWT_RE = re.compile(r"\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b")
PRIVATE_KEY_RE = re.compile(r"\b0x[a-fA-F0-9]{64}\b")
BEARER_RE = re.compile(r"bearer\s+[a-zA-Z0-9._~+/=-]{12,}", re.IGNORECASE)
CONTROL_RE = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F]")

ALLOWED_CATEGORIES = {
    "Announcements",
    "Questions",
    "Bugs",
    "Feature Requests",
    "Provider Services",
    "SDKs",
    "Showcase",
}


def _utc_iso(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        dt = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return str(value)


def _redact_text(value: str, *, max_len: int) -> str:
    text = CONTROL_RE.sub("", str(value or "")).strip()
    text = BEARER_RE.sub("[REDACTED_BEARER]", text)
    text = JWT_RE.sub("[REDACTED_JWT]", text)
    text = PRIVATE_KEY_RE.sub("[REDACTED_PRIVATE_KEY]", text)
    if len(text) > max_len:
        return text[:max_len].rstrip()
    return text


def _redact_payload(value: Any, *, depth: int = 0) -> Any:
    if depth > 6:
        return "[REDACTED_DEPTH]"
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, nested in value.items():
            safe_key = str(key)[:80]
            if any(part in safe_key.lower() for part in SENSITIVE_KEY_PARTS):
                redacted[safe_key] = "[REDACTED]"
            else:
                redacted[safe_key] = _redact_payload(nested, depth=depth + 1)
        return redacted
    if isinstance(value, list):
        return [_redact_payload(item, depth=depth + 1) for item in value[:60]]
    if isinstance(value, str):
        return _redact_text(value, max_len=2000)
    if isinstance(value, (bool, int)) or value is None:
        return value
    return str(value)[:500]


def _topic_row_to_dict(row: Any) -> dict[str, Any]:
    closed_reason = str(row[17] or "") if len(row) > 17 else ""
    official_replies_count = int(row[18] or 0) if len(row) > 18 else 0
    return {
        "topicId": str(row[0]),
        "title": str(row[1] or ""),
        "category": str(row[2] or ""),
        "excerpt": str(row[3] or ""),
        "authorAddress": str(row[4] or ""),
        "authorDisplay": str(row[5] or ""),
        "authorRoles": list(row[6] or []),
        "status": str(row[7] or "open"),
        "resolved": bool(row[8]),
        "locked": bool(row[9]),
        "pinned": bool(row[10]),
        "viewsCount": int(row[11] or 0),
        "repliesCount": int(row[12] or 0),
        "reactionsCount": int(row[13] or 0),
        "lastActivityAt": _utc_iso(row[14]),
        "createdAt": _utc_iso(row[15]),
        "updatedAt": _utc_iso(row[16]),
        "closedReason": closed_reason,
        "officialRepliesCount": official_replies_count,
    }


def _reply_row_to_dict(row: Any) -> dict[str, Any]:
    return {
        "replyId": str(row[0]),
        "topicId": str(row[1]),
        "body": str(row[2] or ""),
        "authorAddress": str(row[3] or ""),
        "authorDisplay": str(row[4] or ""),
        "authorRoles": list(row[5] or []),
        "status": str(row[6] or "visible"),
        "createdAt": _utc_iso(row[7]),
        "updatedAt": _utc_iso(row[8]),
    }


class FeedbackForumService:
    def __init__(self, storage: BaseStorage):
        self.storage = storage

    async def create_feedback(
        self,
        payload: dict[str, Any],
        *,
        owner_wallet: str | None,
        client_ip: str | None,
        user_agent: str | None,
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self._create_feedback_sync,
            payload,
            owner_wallet=owner_wallet,
            client_ip=client_ip,
            user_agent=user_agent,
        )

    def _create_feedback_sync(
        self,
        payload: dict[str, Any],
        *,
        owner_wallet: str | None,
        client_ip: str | None,
        user_agent: str | None,
    ) -> dict[str, Any]:
        feedback_id = f"fbk_{uuid4().hex[:20]}"
        sentiment = str(payload.get("sentiment") or "report_issue")
        if sentiment not in {"helpful", "not_helpful", "report_issue"}:
            raise HTTPException(status_code=422, detail="Invalid feedback sentiment")
        source = str(payload.get("source") or "dashboard")
        if source not in {"docs", "dashboard", "forum", "general"}:
            source = "general"

        route = _redact_text(str(payload.get("route") or ""), max_len=500)
        title = _redact_text(str(payload.get("pageTitle") or ""), max_len=240)
        language = _redact_text(str(payload.get("language") or ""), max_len=16)
        category = _redact_text(str(payload.get("category") or "product_feedback"), max_len=80)
        message = _redact_text(str(payload.get("message") or ""), max_len=4000)
        context = _redact_payload(payload.get("context") or {})
        context["clientIp"] = _redact_text(str(client_ip or ""), max_len=80)
        context["userAgent"] = _redact_text(str(user_agent or ""), max_len=240)
        owner = normalize_wallet(owner_wallet or "") or None

        with self.storage.get_data_manager().uow.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_feedback_reports (
                    feedback_id, source, sentiment, category, message, route,
                    page_title, language, owner_address, context_json, status, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, 'open', %s, %s)
                """,
                (
                    feedback_id,
                    source,
                    sentiment,
                    category,
                    message,
                    route,
                    title,
                    language,
                    owner,
                    json.dumps(context),
                    now_dt_str(),
                    now_dt_str(),
                ),
            )
        return {
            "status": "success",
            "feedbackId": feedback_id,
            "redacted": True,
            "message": "Feedback received.",
        }

    async def list_topics(
        self,
        *,
        page: int,
        page_size: int,
        category: str | None,
        q: str | None,
        sort: str,
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self._list_topics_sync,
            page=max(1, page),
            page_size=max(1, min(page_size, 50)),
            category=category,
            q=q,
            sort=sort,
        )

    def _list_topics_sync(
        self,
        *,
        page: int,
        page_size: int,
        category: str | None,
        q: str | None,
        sort: str,
    ) -> dict[str, Any]:
        where = ["status <> 'hidden'"]
        params: list[Any] = []
        if category:
            where.append("category = %s")
            params.append(category)
        if q:
            where.append("(title ILIKE %s OR body ILIKE %s)")
            like = f"%{q.strip()[:120]}%"
            params.extend([like, like])
        where_sql = " AND ".join(where)
        order_sql = "replies_count DESC, last_activity_at DESC" if sort == "top" else "last_activity_at DESC"
        offset = (page - 1) * page_size
        with self.storage.get_data_manager().uow.readonly_cursor() as cur:
            cur.execute(f"SELECT count(*) FROM synapse_forum_topics WHERE {where_sql}", params)
            total = int(cur.fetchone()[0] or 0)
            cur.execute(
                f"""
                SELECT topic_id, title, category, excerpt, author_address, author_display,
                       author_roles, status, resolved, locked, pinned, views_count,
                       replies_count, reactions_count, last_activity_at, created_at, updated_at,
                       closed_reason,
                       (
                           SELECT COUNT(*)
                           FROM synapse_forum_replies reply
                           WHERE reply.topic_id = synapse_forum_topics.topic_id
                             AND reply.status <> 'hidden'
                             AND 'Ops' = ANY(reply.author_roles)
                       ) AS official_replies_count
                FROM synapse_forum_topics
                WHERE {where_sql}
                ORDER BY pinned DESC, {order_sql}
                LIMIT %s OFFSET %s
                """,
                [*params, page_size, offset],
            )
            topics = [_topic_row_to_dict(row) for row in cur.fetchall()]
        total_pages = max(1, (total + page_size - 1) // page_size)
        return {
            "status": "success",
            "query": {"page": page, "pageSize": page_size, "category": category, "q": q or "", "sort": sort},
            "pagination": {
                "page": page,
                "pageSize": page_size,
                "total": total,
                "totalPages": total_pages,
                "hasNextPage": page < total_pages,
                "hasPreviousPage": page > 1,
            },
            "categories": sorted(ALLOWED_CATEGORIES),
            "topics": topics,
        }

    async def create_topic(self, payload: dict[str, Any], *, owner_wallet: str) -> dict[str, Any]:
        return await asyncio.to_thread(self._create_topic_sync, payload, owner_wallet=owner_wallet)

    def _create_topic_sync(self, payload: dict[str, Any], *, owner_wallet: str) -> dict[str, Any]:
        title = _redact_text(str(payload.get("title") or ""), max_len=160)
        body = _redact_text(str(payload.get("body") or ""), max_len=12000)
        category = str(payload.get("category") or "Questions")
        if category not in ALLOWED_CATEGORIES:
            raise HTTPException(status_code=422, detail="Invalid forum category")
        if len(title) < 6 or len(body) < 10:
            raise HTTPException(status_code=422, detail="Topic title/body too short")
        owner = normalize_wallet(owner_wallet)
        topic_id = f"topic_{uuid4().hex[:20]}"
        author_display = f"{owner[:6]}...{owner[-4:]}" if len(owner) > 12 else owner
        roles = self._roles_for_owner(owner, category)
        excerpt = body[:220].rstrip()
        with self.storage.get_data_manager().uow.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_forum_topics (
                    topic_id, title, body, excerpt, category, author_address,
                    author_display, author_roles, status, created_at, updated_at, last_activity_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'awaiting_admin', %s, %s, %s)
                """,
                (
                    topic_id,
                    title,
                    body,
                    excerpt,
                    category,
                    owner,
                    author_display,
                    roles,
                    now_dt_str(),
                    now_dt_str(),
                    now_dt_str(),
                ),
            )
        return {"status": "success", "topic": self._read_topic_sync(topic_id)}

    def _roles_for_owner(self, owner_wallet: str, category: str | None = None) -> list[str]:
        roles = ["Builder"]
        if category == "Provider Services":
            roles.append("Provider")
        try:
            with self.storage.get_data_manager().uow.readonly_cursor() as cur:
                cur.execute(
                    """
                    SELECT 1 FROM synapse_service_manifests
                    WHERE owner_id = %s OR provider_id = %s
                    LIMIT 1
                    """,
                    (f"owner:{owner_wallet}", f"provider:{owner_wallet}"),
                )
                if cur.fetchone() and "Provider" not in roles:
                    roles.append("Provider")
        except Exception:
            pass
        return roles

    async def get_topic(self, topic_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(self._get_topic_sync, topic_id)

    def _read_topic_sync(self, topic_id: str) -> dict[str, Any]:
        with self.storage.get_data_manager().uow.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT topic_id, title, category, excerpt, author_address, author_display,
                       author_roles, status, resolved, locked, pinned, views_count,
                       replies_count, reactions_count, last_activity_at, created_at, updated_at,
                       closed_reason,
                       (
                           SELECT COUNT(*)
                           FROM synapse_forum_replies reply
                           WHERE reply.topic_id = synapse_forum_topics.topic_id
                             AND reply.status <> 'hidden'
                             AND 'Ops' = ANY(reply.author_roles)
                       ) AS official_replies_count,
                       body
                FROM synapse_forum_topics
                WHERE topic_id = %s AND status <> 'hidden'
                """,
                (topic_id,),
            )
            row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Topic not found")
        topic = _topic_row_to_dict(row[:19])
        topic["body"] = str(row[19] or "")
        return topic

    def _get_topic_sync(self, topic_id: str) -> dict[str, Any]:
        with self.storage.get_data_manager().uow.tx_cursor() as cur:
            cur.execute(
                "UPDATE synapse_forum_topics SET views_count = views_count + 1 WHERE topic_id = %s AND status <> 'hidden'",
                (topic_id,),
            )
        topic = self._read_topic_sync(topic_id)
        with self.storage.get_data_manager().uow.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT reply_id, topic_id, body, author_address, author_display,
                       author_roles, status, created_at, updated_at
                FROM synapse_forum_replies
                WHERE topic_id = %s AND status <> 'hidden'
                ORDER BY created_at ASC
                """,
                (topic_id,),
            )
            replies = [_reply_row_to_dict(row) for row in cur.fetchall()]
        return {"status": "success", "topic": topic, "replies": replies}

    async def create_reply(self, topic_id: str, payload: dict[str, Any], *, owner_wallet: str) -> dict[str, Any]:
        return await asyncio.to_thread(self._create_reply_sync, topic_id, payload, owner_wallet=owner_wallet)

    def _create_reply_sync(self, topic_id: str, payload: dict[str, Any], *, owner_wallet: str) -> dict[str, Any]:
        body = _redact_text(str(payload.get("body") or ""), max_len=12000)
        if len(body) < 2:
            raise HTTPException(status_code=422, detail="Reply body too short")
        owner = normalize_wallet(owner_wallet)
        reply_id = f"reply_{uuid4().hex[:20]}"
        author_display = f"{owner[:6]}...{owner[-4:]}" if len(owner) > 12 else owner
        roles = self._roles_for_owner(owner)
        with self.storage.get_data_manager().uow.tx_cursor() as cur:
            cur.execute(
                "SELECT locked, status FROM synapse_forum_topics WHERE topic_id = %s AND status <> 'hidden'",
                (topic_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Topic not found")
            topic_status = str(row[1] or "")
            if bool(row[0]) or topic_status == "locked":
                raise HTTPException(status_code=423, detail="Topic is locked")
            if topic_status == "closed":
                raise HTTPException(status_code=423, detail="Topic is closed")
            cur.execute(
                """
                INSERT INTO synapse_forum_replies (
                    reply_id, topic_id, body, author_address, author_display,
                    author_roles, status, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, 'visible', %s, %s)
                """,
                (reply_id, topic_id, body, owner, author_display, roles, now_dt_str(), now_dt_str()),
            )
            cur.execute(
                """
                UPDATE synapse_forum_topics
                SET replies_count = replies_count + 1,
                    status = CASE WHEN status = 'awaiting_admin' THEN 'open' ELSE status END,
                    last_activity_at = %s,
                    updated_at = %s
                WHERE topic_id = %s
                """,
                (now_dt_str(), now_dt_str(), topic_id),
            )
        return {"status": "success", "reply": self._read_reply_sync(reply_id)}

    def _read_reply_sync(self, reply_id: str) -> dict[str, Any]:
        with self.storage.get_data_manager().uow.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT reply_id, topic_id, body, author_address, author_display,
                       author_roles, status, created_at, updated_at
                FROM synapse_forum_replies
                WHERE reply_id = %s
                """,
                (reply_id,),
            )
            row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Reply not found")
        return _reply_row_to_dict(row)

    async def resolve_topic(self, topic_id: str, *, owner_wallet: str) -> dict[str, Any]:
        return await asyncio.to_thread(self._resolve_topic_sync, topic_id, owner_wallet=owner_wallet)

    def _resolve_topic_sync(self, topic_id: str, *, owner_wallet: str) -> dict[str, Any]:
        owner = normalize_wallet(owner_wallet)
        with self.storage.get_data_manager().uow.tx_cursor() as cur:
            cur.execute(
                "SELECT author_address FROM synapse_forum_topics WHERE topic_id = %s AND status <> 'hidden'",
                (topic_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Topic not found")
            if normalize_wallet(str(row[0] or "")) != owner:
                raise HTTPException(status_code=403, detail="Only the author can resolve this topic")
            cur.execute(
                """
                UPDATE synapse_forum_topics
                SET resolved = TRUE, status = 'resolved', updated_at = %s, last_activity_at = %s
                WHERE topic_id = %s
                """,
                (now_dt_str(), now_dt_str(), topic_id),
            )
        return {"status": "success", "topic": self._read_topic_sync(topic_id)}


class InMemoryWindowRateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = {}

    def check(self, key: str, *, limit: int, window_sec: int = 60) -> None:
        now = time.monotonic()
        cutoff = now - max(1, window_sec)
        hits = [ts for ts in self._hits.get(key, []) if ts >= cutoff]
        if len(hits) >= max(1, limit):
            self._hits[key] = hits
            raise HTTPException(status_code=429, detail="Rate limit exceeded")
        hits.append(now)
        self._hits[key] = hits
