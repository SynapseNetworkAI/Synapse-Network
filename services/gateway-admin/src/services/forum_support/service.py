from __future__ import annotations

import re
from typing import Any

from src.core.errors import BadRequestError, ResourceNotFoundError
from src.domain import ForumResponseTask
from src.services.auth.service import AdminIdentity
from src.storage.forum_support import PostgresForumSupportRepository

CONTROL_RE = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F]")

VALID_STATUSES = {"awaiting_response", "draft_ready", "responded", "ignored", "closed"}
VALID_CLASSIFICATIONS = {"question", "bug", "feature_request", "docs_issue", "needs_more_info", "spam"}
VALID_PRIORITIES = {"low", "normal", "high", "critical"}


def _clean_text(value: str, *, max_len: int) -> str:
    text = CONTROL_RE.sub("", str(value or "")).strip()
    if len(text) > max_len:
        return text[:max_len].rstrip()
    return text


def _task_to_dict(task: ForumResponseTask) -> dict[str, Any]:
    topic = task.topic
    return {
        "responseTaskId": task.response_task_id,
        "topicId": task.topic_id,
        "status": task.status,
        "source": task.source,
        "priority": task.priority,
        "classification": task.classification,
        "suggestedReply": task.suggested_reply,
        "suggestedReplySource": task.suggested_reply_source,
        "suggestedReplyUpdatedAt": task.suggested_reply_updated_at,
        "repliedByAdminId": task.replied_by_admin_id,
        "replyId": task.reply_id,
        "respondedAt": task.responded_at,
        "linkedRequirementCandidateId": task.linked_requirement_candidate_id,
        "linkedRequirementId": task.linked_requirement_id,
        "linkedWorkflowRunId": task.linked_workflow_run_id,
        "metadata": task.metadata,
        "createdAt": task.created_at,
        "updatedAt": task.updated_at,
        "topic": None if topic is None else {
            "topicId": topic.topic_id,
            "title": topic.title,
            "body": topic.body,
            "excerpt": topic.excerpt,
            "category": topic.category,
            "authorAddress": topic.author_address,
            "authorDisplay": topic.author_display,
            "authorRoles": list(topic.author_roles),
            "status": topic.topic_status,
            "resolved": topic.resolved,
            "locked": topic.locked,
            "pinned": topic.pinned,
            "viewsCount": topic.views_count,
            "repliesCount": topic.replies_count,
            "officialRepliesCount": topic.official_replies_count,
            "closedReason": topic.closed_reason,
            "closedByAdminId": topic.closed_by_admin_id,
            "closedAt": topic.closed_at,
            "createdAt": topic.created_at,
            "updatedAt": topic.updated_at,
            "lastActivityAt": topic.last_activity_at,
        },
    }


def _topic_to_dict(topic: Any) -> dict[str, Any]:
    return {
        "topicId": topic.topic_id,
        "title": topic.title,
        "body": topic.body,
        "excerpt": topic.excerpt,
        "category": topic.category,
        "authorAddress": topic.author_address,
        "authorDisplay": topic.author_display,
        "authorRoles": list(topic.author_roles),
        "status": topic.topic_status,
        "resolved": topic.resolved,
        "locked": topic.locked,
        "pinned": topic.pinned,
        "viewsCount": topic.views_count,
        "repliesCount": topic.replies_count,
        "officialRepliesCount": topic.official_replies_count,
        "closedReason": topic.closed_reason,
        "closedByAdminId": topic.closed_by_admin_id,
        "closedAt": topic.closed_at,
        "createdAt": topic.created_at,
        "updatedAt": topic.updated_at,
        "lastActivityAt": topic.last_activity_at,
    }


def _event_to_dict(event: Any) -> dict[str, Any]:
    return {
        "eventId": event.event_id,
        "topicId": event.topic_id,
        "actorAdminId": event.actor_admin_id,
        "action": event.action,
        "fromStatus": event.from_status,
        "toStatus": event.to_status,
        "reason": event.reason,
        "metadata": event.metadata,
        "createdAt": event.created_at,
    }


class ForumSupportService:
    def __init__(self, repository: PostgresForumSupportRepository) -> None:
        self._repository = repository

    def list_response_tasks(
        self,
        *,
        status: str | None = None,
        page: int = 1,
        page_size: int = 20,
        classification: str | None = None,
    ) -> dict[str, Any]:
        statuses = self._parse_statuses(status)
        if classification and classification not in VALID_CLASSIFICATIONS:
            raise BadRequestError("Invalid forum task classification")
        safe_page = max(1, page)
        safe_page_size = max(1, min(page_size, 100))
        items, total = self._repository.list_tasks(
            statuses=statuses,
            page=safe_page,
            page_size=safe_page_size,
            classification=classification,
        )
        total_pages = max(1, (total + safe_page_size - 1) // safe_page_size)
        return {
            "items": [_task_to_dict(item) for item in items],
            "pagination": {
                "page": safe_page,
                "pageSize": safe_page_size,
                "total": total,
                "totalPages": total_pages,
                "hasNextPage": safe_page < total_pages,
                "hasPreviousPage": safe_page > 1,
            },
        }

    def list_topics(
        self,
        *,
        status: str | None = None,
        page: int = 1,
        page_size: int = 20,
        category: str | None = None,
        q: str | None = None,
        pinned: bool | None = None,
    ) -> dict[str, Any]:
        statuses = self._parse_topic_statuses(status)
        safe_page = max(1, page)
        safe_page_size = max(1, min(page_size, 100))
        items, total = self._repository.list_topics(
            statuses=statuses,
            page=safe_page,
            page_size=safe_page_size,
            category=category,
            q=q,
            pinned=pinned,
        )
        total_pages = max(1, (total + safe_page_size - 1) // safe_page_size)
        return {
            "items": [_topic_to_dict(item) for item in items],
            "pagination": {
                "page": safe_page,
                "pageSize": safe_page_size,
                "total": total,
                "totalPages": total_pages,
                "hasNextPage": safe_page < total_pages,
                "hasPreviousPage": safe_page > 1,
            },
        }

    def get_topic(self, topic_id: str) -> dict[str, Any]:
        topic = self._repository.get_topic_context(topic_id)
        if topic is None:
            raise ResourceNotFoundError("Forum topic not found")
        task = self._repository.get_active_task_for_topic(topic_id)
        events = self._repository.list_topic_events(topic_id)
        return {
            "topic": _topic_to_dict(topic),
            "responseTask": None if task is None else _task_to_dict(task),
            "events": [_event_to_dict(event) for event in events],
        }

    def close_topic(self, topic_id: str, payload: dict[str, Any], *, admin: AdminIdentity) -> dict[str, Any]:
        reason = _clean_text(str(payload.get("reason") or ""), max_len=1000)
        if len(reason) < 3:
            raise BadRequestError("Close reason is required")
        topic = self._repository.update_topic_lifecycle(
            topic_id=topic_id,
            admin_id=admin.admin_id,
            action="close",
            reason=reason,
        )
        if topic is None:
            raise ResourceNotFoundError("Forum topic not found")
        return _topic_to_dict(topic)

    def reopen_topic(self, topic_id: str, *, admin: AdminIdentity) -> dict[str, Any]:
        topic = self._repository.update_topic_lifecycle(topic_id=topic_id, admin_id=admin.admin_id, action="reopen")
        if topic is None:
            raise ResourceNotFoundError("Forum topic not found")
        return _topic_to_dict(topic)

    def pin_topic(self, topic_id: str, *, admin: AdminIdentity, pinned: bool) -> dict[str, Any]:
        topic = self._repository.update_topic_lifecycle(
            topic_id=topic_id,
            admin_id=admin.admin_id,
            action="pin" if pinned else "unpin",
            pinned=pinned,
        )
        if topic is None:
            raise ResourceNotFoundError("Forum topic not found")
        return _topic_to_dict(topic)

    def get_response_task(self, task_id: str) -> dict[str, Any]:
        task = self._repository.get_task(task_id)
        if task is None:
            raise ResourceNotFoundError("Forum response task not found")
        return _task_to_dict(task)

    def update_suggestion(self, task_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        classification = str(payload.get("classification") or "question")
        priority = str(payload.get("priority") or "normal")
        if classification not in VALID_CLASSIFICATIONS:
            raise BadRequestError("Invalid forum task classification")
        if priority not in VALID_PRIORITIES:
            raise BadRequestError("Invalid forum task priority")
        suggested_reply = _clean_text(str(payload.get("suggestedReply") or ""), max_len=12000)
        if len(suggested_reply) < 2:
            raise BadRequestError("Suggested reply is required")
        metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
        updated = self._repository.update_suggestion(
            task_id=task_id,
            classification=classification,
            priority=priority,
            suggested_reply=suggested_reply,
            linked_requirement_candidate_id=payload.get("linkedRequirementCandidateId"),
            linked_requirement_id=payload.get("linkedRequirementId"),
            linked_workflow_run_id=payload.get("linkedWorkflowRunId"),
            metadata=metadata,
        )
        if updated is None:
            raise ResourceNotFoundError("Forum response task not found or already closed")
        return _task_to_dict(updated)

    def send_reply(self, task_id: str, payload: dict[str, Any], *, admin: AdminIdentity) -> dict[str, Any]:
        body = _clean_text(str(payload.get("body") or ""), max_len=12000)
        if len(body) < 2:
            raise BadRequestError("Reply body is required")
        display_name = _clean_text(str(payload.get("authorDisplay") or "Synapse Ops"), max_len=120)
        author_address = _clean_text(str(payload.get("authorAddress") or "synapse:ops"), max_len=120)
        try:
            updated = self._repository.send_reply(
                task_id=task_id,
                body=body,
                admin_id=admin.admin_id,
                admin_display=display_name,
                admin_address=author_address,
            )
        except ValueError as exc:
            raise BadRequestError(str(exc)) from exc
        if updated is None:
            current = self._repository.get_task(task_id)
            if current is None:
                raise ResourceNotFoundError("Forum response task not found")
            return _task_to_dict(current)
        return _task_to_dict(updated)

    def ignore_task(self, task_id: str, payload: dict[str, Any], *, admin: AdminIdentity) -> dict[str, Any]:
        reason = _clean_text(str(payload.get("reason") or ""), max_len=1000)
        if len(reason) < 3:
            raise BadRequestError("Ignore reason is required")
        updated = self._repository.ignore_task(task_id=task_id, admin_id=admin.admin_id, reason=reason)
        if updated is None:
            current = self._repository.get_task(task_id)
            if current is None:
                raise ResourceNotFoundError("Forum response task not found")
            return _task_to_dict(current)
        return _task_to_dict(updated)

    @staticmethod
    def _parse_statuses(status: str | None) -> list[str]:
        if not status:
            return ["awaiting_response", "draft_ready"]
        statuses = [item.strip() for item in status.split(",") if item.strip()]
        invalid = [item for item in statuses if item not in VALID_STATUSES]
        if invalid:
            raise BadRequestError("Invalid forum task status")
        return statuses

    @staticmethod
    def _parse_topic_statuses(status: str | None) -> list[str]:
        valid = {"open", "awaiting_admin", "answered", "resolved", "closed", "hidden", "locked"}
        default = ["open", "awaiting_admin", "answered", "resolved"]
        if not status:
            return default
        statuses = [item.strip() for item in status.split(",") if item.strip()]
        invalid = [item for item in statuses if item not in valid]
        if invalid:
            raise BadRequestError("Invalid forum topic status")
        return statuses
