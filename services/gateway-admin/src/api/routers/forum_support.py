import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query

from src.api.deps import get_forum_support_service, get_request_id, require_permission
from src.api.schemas.common import ApiResponse
from src.api.schemas.forum_support import (
    ForumCloseTopicRequest,
    ForumIgnoreTaskRequest,
    ForumResponseSuggestionRequest,
    ForumResponseTaskListResponse,
    ForumResponseTaskOut,
    ForumSendReplyRequest,
    ForumTopicContextOut,
    ForumTopicDetailResponse,
    ForumTopicListResponse,
)
from src.core.config import get_settings
from src.core.errors import AuthorizationError
from src.services.auth.service import AdminIdentity
from src.services.forum_support import ForumSupportService

router = APIRouter(prefix="/api/admin/v1/forum", tags=["admin-forum-support"])
logger = logging.getLogger(__name__)


def require_growing_service_token(
    token: Annotated[str | None, Header(alias="X-Growing-Service-Token")] = None,
) -> None:
    expected = get_settings().forum_suggestion_service_token.strip()
    if not expected or token != expected:
        raise AuthorizationError("Missing or invalid Growing service token")


@router.get("/response-tasks", response_model=ApiResponse)
def list_response_tasks(
    admin: Annotated[AdminIdentity, Depends(require_permission("support:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    forum_service: Annotated[ForumSupportService, Depends(get_forum_support_service)],
    status: str | None = None,
    classification: str | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="page_size", ge=1, le=100)] = 20,
):
    _ = admin
    try:
        payload = forum_service.list_response_tasks(
            status=status,
            classification=classification,
            page=page,
            page_size=page_size,
        )
    except Exception:
        logger.exception(
            "forum response task list failed request_id=%s status=%s classification=%s page=%s page_size=%s",
            request_id,
            status,
            classification,
            page,
            page_size,
        )
        raise
    return ApiResponse(data=ForumResponseTaskListResponse(**payload), request_id=request_id)


@router.get("/response-tasks/{task_id}", response_model=ApiResponse)
def get_response_task(
    task_id: str,
    admin: Annotated[AdminIdentity, Depends(require_permission("support:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    forum_service: Annotated[ForumSupportService, Depends(get_forum_support_service)],
):
    _ = admin
    payload = forum_service.get_response_task(task_id)
    return ApiResponse(data=ForumResponseTaskOut(**payload), request_id=request_id)


@router.get("/response-tasks/-/pending", response_model=ApiResponse)
def list_internal_pending_response_tasks(
    _: Annotated[None, Depends(require_growing_service_token)],
    request_id: Annotated[str, Depends(get_request_id)],
    forum_service: Annotated[ForumSupportService, Depends(get_forum_support_service)],
    page_size: Annotated[int, Query(alias="page_size", ge=1, le=100)] = 20,
):
    payload = forum_service.list_response_tasks(
        status="awaiting_response,draft_ready",
        page=1,
        page_size=page_size,
    )
    return ApiResponse(data=ForumResponseTaskListResponse(**payload), request_id=request_id)


@router.post("/response-tasks/{task_id}/suggestion", response_model=ApiResponse)
def update_response_suggestion(
    task_id: str,
    payload: ForumResponseSuggestionRequest,
    _: Annotated[None, Depends(require_growing_service_token)],
    request_id: Annotated[str, Depends(get_request_id)],
    forum_service: Annotated[ForumSupportService, Depends(get_forum_support_service)],
):
    updated = forum_service.update_suggestion(task_id, payload.model_dump(by_alias=True))
    return ApiResponse(data=ForumResponseTaskOut(**updated), request_id=request_id)


@router.post("/response-tasks/{task_id}/send-reply", response_model=ApiResponse)
def send_response_reply(
    task_id: str,
    payload: ForumSendReplyRequest,
    admin: Annotated[AdminIdentity, Depends(require_permission("support:reply"))],
    request_id: Annotated[str, Depends(get_request_id)],
    forum_service: Annotated[ForumSupportService, Depends(get_forum_support_service)],
):
    try:
        updated = forum_service.send_reply(task_id, payload.model_dump(by_alias=True), admin=admin)
    except Exception:
        logger.exception("forum response task send failed request_id=%s task_id=%s", request_id, task_id)
        raise
    return ApiResponse(data=ForumResponseTaskOut(**updated), request_id=request_id)


@router.post("/response-tasks/{task_id}/ignore", response_model=ApiResponse)
def ignore_response_task(
    task_id: str,
    payload: ForumIgnoreTaskRequest,
    admin: Annotated[AdminIdentity, Depends(require_permission("support:triage"))],
    request_id: Annotated[str, Depends(get_request_id)],
    forum_service: Annotated[ForumSupportService, Depends(get_forum_support_service)],
):
    try:
        updated = forum_service.ignore_task(task_id, payload.model_dump(), admin=admin)
    except Exception:
        logger.exception("forum response task ignore failed request_id=%s task_id=%s", request_id, task_id)
        raise
    return ApiResponse(data=ForumResponseTaskOut(**updated), request_id=request_id)


@router.get("/topics", response_model=ApiResponse)
def list_forum_topics(
    admin: Annotated[AdminIdentity, Depends(require_permission("support:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    forum_service: Annotated[ForumSupportService, Depends(get_forum_support_service)],
    status: str | None = "open,awaiting_admin,answered,resolved",
    category: str | None = None,
    q: str | None = None,
    pinned: bool | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="page_size", ge=1, le=100)] = 20,
):
    _ = admin
    payload = forum_service.list_topics(
        status=status,
        category=category,
        q=q,
        pinned=pinned,
        page=page,
        page_size=page_size,
    )
    return ApiResponse(data=ForumTopicListResponse(**payload), request_id=request_id)


@router.get("/topics/{topic_id}", response_model=ApiResponse)
def get_forum_topic(
    topic_id: str,
    admin: Annotated[AdminIdentity, Depends(require_permission("support:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    forum_service: Annotated[ForumSupportService, Depends(get_forum_support_service)],
):
    _ = admin
    payload = forum_service.get_topic(topic_id)
    return ApiResponse(data=ForumTopicDetailResponse(**payload), request_id=request_id)


@router.post("/topics/{topic_id}/close", response_model=ApiResponse)
def close_forum_topic(
    topic_id: str,
    payload: ForumCloseTopicRequest,
    admin: Annotated[AdminIdentity, Depends(require_permission("support:triage"))],
    request_id: Annotated[str, Depends(get_request_id)],
    forum_service: Annotated[ForumSupportService, Depends(get_forum_support_service)],
):
    updated = forum_service.close_topic(topic_id, payload.model_dump(), admin=admin)
    return ApiResponse(data=ForumTopicContextOut(**updated), request_id=request_id)


@router.post("/topics/{topic_id}/reopen", response_model=ApiResponse)
def reopen_forum_topic(
    topic_id: str,
    admin: Annotated[AdminIdentity, Depends(require_permission("support:triage"))],
    request_id: Annotated[str, Depends(get_request_id)],
    forum_service: Annotated[ForumSupportService, Depends(get_forum_support_service)],
):
    updated = forum_service.reopen_topic(topic_id, admin=admin)
    return ApiResponse(data=ForumTopicContextOut(**updated), request_id=request_id)


@router.post("/topics/{topic_id}/pin", response_model=ApiResponse)
def pin_forum_topic(
    topic_id: str,
    admin: Annotated[AdminIdentity, Depends(require_permission("support:triage"))],
    request_id: Annotated[str, Depends(get_request_id)],
    forum_service: Annotated[ForumSupportService, Depends(get_forum_support_service)],
):
    updated = forum_service.pin_topic(topic_id, admin=admin, pinned=True)
    return ApiResponse(data=ForumTopicContextOut(**updated), request_id=request_id)


@router.post("/topics/{topic_id}/unpin", response_model=ApiResponse)
def unpin_forum_topic(
    topic_id: str,
    admin: Annotated[AdminIdentity, Depends(require_permission("support:triage"))],
    request_id: Annotated[str, Depends(get_request_id)],
    forum_service: Annotated[ForumSupportService, Depends(get_forum_support_service)],
):
    updated = forum_service.pin_topic(topic_id, admin=admin, pinned=False)
    return ApiResponse(data=ForumTopicContextOut(**updated), request_id=request_id)
