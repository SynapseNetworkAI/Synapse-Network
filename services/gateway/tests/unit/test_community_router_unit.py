from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from src.api.deps import get_community_service
from src.api.routers.community import router
from src.services.community import feedback_forum_service
from src.services.platform import credential_service


class FakeCommunityService:
    def __init__(self) -> None:
        self.feedback_payload = None
        self.created_topics = []

    async def create_feedback(self, payload, *, owner_wallet, client_ip, user_agent):
        self.feedback_payload = {
            "payload": payload,
            "owner_wallet": owner_wallet,
            "client_ip": client_ip,
            "user_agent": user_agent,
        }
        return {
            "status": "success",
            "feedbackId": "fbk_test",
            "redacted": True,
            "message": "Feedback received.",
        }

    async def list_topics(self, *, page, page_size, category, q, sort):
        return {
            "status": "success",
            "query": {"page": page, "pageSize": page_size, "category": category, "q": q or "", "sort": sort},
            "pagination": {"page": page, "pageSize": page_size, "total": 0, "totalPages": 1, "hasNextPage": False, "hasPreviousPage": False},
            "categories": ["Questions"],
            "topics": [],
        }

    async def create_topic(self, payload, *, owner_wallet):
        self.created_topics.append((payload, owner_wallet))
        return {
            "status": "success",
            "topic": {
                "topicId": "topic_test",
                "title": payload["title"],
                "body": payload["body"],
                "category": payload["category"],
                "excerpt": payload["body"],
                "authorAddress": owner_wallet,
                "authorDisplay": "0xabc...0000",
                "authorRoles": ["Builder"],
                "status": "open",
                "resolved": False,
                "locked": False,
                "pinned": False,
                "viewsCount": 0,
                "repliesCount": 0,
                "reactionsCount": 0,
                "lastActivityAt": "2026-04-19T00:00:00Z",
                "createdAt": "2026-04-19T00:00:00Z",
                "updatedAt": "2026-04-19T00:00:00Z",
            },
        }

    async def get_topic(self, topic_id):
        return {"status": "success", "topic": {"topicId": topic_id, "body": "body"}, "replies": []}

    async def create_reply(self, topic_id, payload, *, owner_wallet):
        return {"status": "success", "reply": {"replyId": "reply_test", "topicId": topic_id, "body": payload["body"]}}

    async def resolve_topic(self, topic_id, *, owner_wallet):
        return {"status": "success", "topic": {"topicId": topic_id, "resolved": True}}


def make_client(fake: FakeCommunityService) -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_community_service] = lambda: fake
    return TestClient(app)


def test_feedback_allows_optional_auth_and_returns_feedback_id(monkeypatch) -> None:
    fake = FakeCommunityService()
    monkeypatch.setattr(
        credential_service,
        "require_owner_wallet",
        lambda authorization, x_user_address: "0xabc0000000000000000000000000000000000000",
    )

    response = make_client(fake).post(
        "/api/v1/feedback",
        headers={"Authorization": "Bearer jwt", "X-User-Address": "0xabc"},
        json={
            "source": "docs",
            "sentiment": "not_helpful",
            "category": "docs_issue",
            "message": "This page is missing the settlement state diagram.",
            "route": "/docs/concepts#settlement",
            "context": {"authorization": "Bearer should-not-be-kept"},
        },
    )

    assert response.status_code == 200
    assert response.json()["feedbackId"] == "fbk_test"
    assert fake.feedback_payload["owner_wallet"] == "0xabc0000000000000000000000000000000000000"


def test_forum_topic_creation_requires_wallet(monkeypatch) -> None:
    fake = FakeCommunityService()
    monkeypatch.setattr(
        credential_service,
        "require_owner_wallet",
        lambda authorization, x_user_address: (_ for _ in ()).throw(HTTPException(status_code=401, detail="missing")),
    )

    response = make_client(fake).post(
        "/api/v1/forum/topics",
        json={"title": "Cannot invoke provider service", "body": "The service times out.", "category": "Questions"},
    )

    assert response.status_code >= 400
    assert fake.created_topics == []


def test_forum_topic_creation_uses_authenticated_wallet(monkeypatch) -> None:
    fake = FakeCommunityService()
    monkeypatch.setattr(
        credential_service,
        "require_owner_wallet",
        lambda authorization, x_user_address: "0xabc0000000000000000000000000000000000000",
    )

    response = make_client(fake).post(
        "/api/v1/forum/topics",
        headers={"Authorization": "Bearer jwt", "X-User-Address": "0xabc"},
        json={"title": "Provider health slow lane", "body": "How does slow lane recovery work?", "category": "Provider Services"},
    )

    assert response.status_code == 200
    assert response.json()["topic"]["topicId"] == "topic_test"
    assert fake.created_topics[0][1] == "0xabc0000000000000000000000000000000000000"


def test_secret_redaction_removes_sensitive_values() -> None:
    payload = feedback_forum_service._redact_payload(
        {
            "authorization": "Bearer eyJaaaaaaa.bbbbbbbb.cccccccc",
            "nested": {"privateKey": "0x" + "a" * 64, "message": "hello"},
        }
    )

    assert payload["authorization"] == "[REDACTED]"
    assert payload["nested"]["privateKey"] == "[REDACTED]"
    assert payload["nested"]["message"] == "hello"
