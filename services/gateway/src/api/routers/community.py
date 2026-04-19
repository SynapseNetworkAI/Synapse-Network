from __future__ import annotations

from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, Header, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from src.api.deps import get_community_service
from src.services.analytics import gateway_events as gw_analytics
from src.services.community.feedback_forum_service import (
    FeedbackForumService,
    InMemoryWindowRateLimiter,
)
from src.services.platform import credential_service

router = APIRouter(prefix="/v1")
_rate_limiter = InMemoryWindowRateLimiter()

AuthorizationHeader = Annotated[Optional[str], Header(alias="Authorization")]
UserAddressHeader = Annotated[Optional[str], Header(alias="X-User-Address")]


class FeedbackSubmitRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    source: str = Field(default="dashboard", max_length=32)
    sentiment: str = Field(default="report_issue", max_length=32)
    category: str = Field(default="product_feedback", max_length=80)
    message: str = Field(default="", max_length=4000)
    route: str = Field(default="", max_length=500)
    page_title: str = Field(default="", alias="pageTitle", max_length=240)
    language: str = Field(default="", max_length=16)
    context: dict[str, Any] = Field(default_factory=dict)


class ForumTopicCreateRequest(BaseModel):
    title: str = Field(min_length=6, max_length=160)
    body: str = Field(min_length=10, max_length=12000)
    category: str = Field(default="Questions", max_length=80)


class ForumReplyCreateRequest(BaseModel):
    body: str = Field(min_length=2, max_length=12000)


def _optional_owner_wallet(
    authorization: str | None,
    x_user_address: str | None,
) -> str | None:
    if not authorization:
        return None
    try:
        return credential_service.require_owner_wallet(authorization, x_user_address)
    except Exception:
        return None


def _require_owner_wallet(
    authorization: str | None,
    x_user_address: str | None,
) -> str:
    return credential_service.require_owner_wallet(authorization, x_user_address)


def _client_key(request: Request, owner_wallet: str | None, action: str) -> str:
    if owner_wallet:
        return f"{action}:wallet:{owner_wallet}"
    client_host = request.client.host if request.client else "unknown"
    return f"{action}:ip:{client_host}"


@router.post("/feedback")
async def submit_feedback(
    request: Request,
    payload: FeedbackSubmitRequest,
    service: Annotated[FeedbackForumService, Depends(get_community_service)],
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
) -> dict[str, Any]:
    owner_wallet = _optional_owner_wallet(authorization, x_user_address)
    _rate_limiter.check(_client_key(request, owner_wallet, "feedback"), limit=10)
    result = await service.create_feedback(
        payload.model_dump(by_alias=True),
        owner_wallet=owner_wallet,
        client_ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await gw_analytics.emit_feedback_submitted(
        owner_wallet or "anonymous",
        feedback_id=result["feedbackId"],
        source=payload.source,
        sentiment=payload.sentiment,
        route=payload.route,
    )
    return result


@router.get("/forum/topics")
async def list_forum_topics(
    service: Annotated[FeedbackForumService, Depends(get_community_service)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, alias="pageSize", ge=1, le=50),
    category: str | None = Query(default=None),
    q: str | None = Query(default=None),
    sort: str = Query(default="latest"),
) -> dict[str, Any]:
    return await service.list_topics(
        page=page,
        page_size=page_size,
        category=category,
        q=q,
        sort="top" if sort == "top" else "latest",
    )


@router.post("/forum/topics")
async def create_forum_topic(
    request: Request,
    payload: ForumTopicCreateRequest,
    service: Annotated[FeedbackForumService, Depends(get_community_service)],
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
) -> dict[str, Any]:
    owner_wallet = _require_owner_wallet(authorization, x_user_address)
    _rate_limiter.check(_client_key(request, owner_wallet, "forum_topic"), limit=5)
    result = await service.create_topic(payload.model_dump(), owner_wallet=owner_wallet)
    await gw_analytics.emit_forum_topic_created(
        owner_wallet,
        topic_id=result["topic"]["topicId"],
        category=result["topic"]["category"],
    )
    return result


@router.get("/forum/topics/{topic_id}")
async def get_forum_topic(
    topic_id: str,
    service: Annotated[FeedbackForumService, Depends(get_community_service)],
) -> dict[str, Any]:
    return await service.get_topic(topic_id)


@router.post("/forum/topics/{topic_id}/replies")
async def create_forum_reply(
    topic_id: str,
    request: Request,
    payload: ForumReplyCreateRequest,
    service: Annotated[FeedbackForumService, Depends(get_community_service)],
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
) -> dict[str, Any]:
    owner_wallet = _require_owner_wallet(authorization, x_user_address)
    _rate_limiter.check(_client_key(request, owner_wallet, "forum_reply"), limit=20)
    result = await service.create_reply(topic_id, payload.model_dump(), owner_wallet=owner_wallet)
    await gw_analytics.emit_forum_reply_created(
        owner_wallet,
        topic_id=topic_id,
        reply_id=result["reply"]["replyId"],
    )
    return result


@router.post("/forum/topics/{topic_id}/resolve")
async def resolve_forum_topic(
    topic_id: str,
    service: Annotated[FeedbackForumService, Depends(get_community_service)],
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
) -> dict[str, Any]:
    owner_wallet = _require_owner_wallet(authorization, x_user_address)
    result = await service.resolve_topic(topic_id, owner_wallet=owner_wallet)
    await gw_analytics.emit_forum_topic_resolved(owner_wallet, topic_id=topic_id)
    return result
