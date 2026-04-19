from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ForumTopicContextOut(BaseModel):
    topic_id: str = Field(alias="topicId", serialization_alias="topicId")
    title: str
    body: str
    excerpt: str
    category: str
    author_address: str = Field(alias="authorAddress", serialization_alias="authorAddress")
    author_display: str = Field(alias="authorDisplay", serialization_alias="authorDisplay")
    author_roles: list[str] = Field(default_factory=list, alias="authorRoles", serialization_alias="authorRoles")
    status: str
    resolved: bool
    replies_count: int = Field(alias="repliesCount", serialization_alias="repliesCount")
    created_at: datetime | None = Field(default=None, alias="createdAt", serialization_alias="createdAt")
    updated_at: datetime | None = Field(default=None, alias="updatedAt", serialization_alias="updatedAt")
    last_activity_at: datetime | None = Field(default=None, alias="lastActivityAt", serialization_alias="lastActivityAt")


class ForumResponseTaskOut(BaseModel):
    response_task_id: str = Field(alias="responseTaskId", serialization_alias="responseTaskId")
    topic_id: str = Field(alias="topicId", serialization_alias="topicId")
    status: str
    source: str
    priority: str
    classification: str | None = None
    suggested_reply: str | None = Field(default=None, alias="suggestedReply", serialization_alias="suggestedReply")
    suggested_reply_source: str | None = Field(default=None, alias="suggestedReplySource", serialization_alias="suggestedReplySource")
    suggested_reply_updated_at: datetime | None = Field(default=None, alias="suggestedReplyUpdatedAt", serialization_alias="suggestedReplyUpdatedAt")
    replied_by_admin_id: str | None = Field(default=None, alias="repliedByAdminId", serialization_alias="repliedByAdminId")
    reply_id: str | None = Field(default=None, alias="replyId", serialization_alias="replyId")
    responded_at: datetime | None = Field(default=None, alias="respondedAt", serialization_alias="respondedAt")
    linked_requirement_candidate_id: str | None = Field(default=None, alias="linkedRequirementCandidateId", serialization_alias="linkedRequirementCandidateId")
    linked_requirement_id: str | None = Field(default=None, alias="linkedRequirementId", serialization_alias="linkedRequirementId")
    linked_workflow_run_id: str | None = Field(default=None, alias="linkedWorkflowRunId", serialization_alias="linkedWorkflowRunId")
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = Field(default=None, alias="createdAt", serialization_alias="createdAt")
    updated_at: datetime | None = Field(default=None, alias="updatedAt", serialization_alias="updatedAt")
    topic: ForumTopicContextOut | None = None


class ForumResponseTaskPagination(BaseModel):
    page: int
    page_size: int = Field(alias="pageSize", serialization_alias="pageSize")
    total: int
    total_pages: int = Field(alias="totalPages", serialization_alias="totalPages")
    has_next_page: bool = Field(alias="hasNextPage", serialization_alias="hasNextPage")
    has_previous_page: bool = Field(alias="hasPreviousPage", serialization_alias="hasPreviousPage")


class ForumResponseTaskListResponse(BaseModel):
    items: list[ForumResponseTaskOut]
    pagination: ForumResponseTaskPagination


class ForumResponseSuggestionRequest(BaseModel):
    classification: str
    priority: str = "normal"
    suggested_reply: str = Field(alias="suggestedReply")
    linked_requirement_candidate_id: str | None = Field(default=None, alias="linkedRequirementCandidateId")
    linked_requirement_id: str | None = Field(default=None, alias="linkedRequirementId")
    linked_workflow_run_id: str | None = Field(default=None, alias="linkedWorkflowRunId")
    metadata: dict[str, Any] = Field(default_factory=dict)


class ForumSendReplyRequest(BaseModel):
    body: str
    author_display: str | None = Field(default=None, alias="authorDisplay")
    author_address: str | None = Field(default=None, alias="authorAddress")


class ForumIgnoreTaskRequest(BaseModel):
    reason: str
