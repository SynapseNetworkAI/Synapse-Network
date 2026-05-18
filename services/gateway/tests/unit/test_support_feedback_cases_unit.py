from __future__ import annotations

from typing import Any

import pytest

from src.services.community import feedback_forum_service
from src.services.community.feedback_forum_service import FeedbackForumService


class FakeCursor:
    def __init__(self) -> None:
        self.statements: list[tuple[str, tuple[Any, ...]]] = []

    def execute(self, sql: str, params: tuple[Any, ...] = ()) -> None:
        self.statements.append((sql, params))


class FakeTx:
    def __init__(self, cursor: FakeCursor) -> None:
        self.cursor = cursor

    def __enter__(self) -> FakeCursor:
        return self.cursor

    def __exit__(self, *_args) -> None:
        return None


class FakeUow:
    def __init__(self, cursor: FakeCursor) -> None:
        self.cursor = cursor

    def tx_cursor(self) -> FakeTx:
        return FakeTx(self.cursor)


class FakeDataManager:
    def __init__(self, cursor: FakeCursor) -> None:
        self.uow = FakeUow(cursor)


class FakeStorage:
    def __init__(self) -> None:
        self.cursor = FakeCursor()

    def get_data_manager(self) -> FakeDataManager:
        return FakeDataManager(self.cursor)


@pytest.mark.asyncio
async def test_actionable_feedback_creates_support_task_and_lark_card(monkeypatch) -> None:
    storage = FakeStorage()
    sent: list[dict[str, Any]] = []

    async def fake_lark(**kwargs) -> bool:
        sent.append(kwargs)
        return True

    monkeypatch.setattr(feedback_forum_service, "send_support_case_lark_card", fake_lark)

    result = await FeedbackForumService(storage).create_feedback(
        {
            "source": "docs",
            "sentiment": "report_issue",
            "category": "billing_support",
            "message": "Refund is stuck. Bearer secret-token should be redacted.",
            "route": "https://docs.synapse-network.ai/support",
            "pageTitle": "Support",
            "context": {"authorization": "Bearer should-not-survive"},
        },
        owner_wallet="0xabc0000000000000000000000000000000000000",
        client_ip="127.0.0.1",
        user_agent="pytest",
    )

    assert result["supportCaseCreated"] is True
    assert result["supportTaskId"].startswith("frt_")
    assert result["supportPriority"] == "high"
    assert len(storage.cursor.statements) == 3
    assert "INSERT INTO synapse_feedback_reports" in storage.cursor.statements[0][0]
    assert "INSERT INTO synapse_forum_topics" in storage.cursor.statements[1][0]
    assert "INSERT INTO synapse_forum_response_tasks" in storage.cursor.statements[2][0]
    assert sent[0]["feedback_id"] == result["feedbackId"]
    assert sent[0]["category"] == "billing_support"


@pytest.mark.asyncio
async def test_product_feedback_remains_raw_feedback_only(monkeypatch) -> None:
    storage = FakeStorage()
    sent: list[dict[str, Any]] = []

    async def fake_lark(**kwargs) -> bool:
        sent.append(kwargs)
        return True

    monkeypatch.setattr(feedback_forum_service, "send_support_case_lark_card", fake_lark)

    result = await FeedbackForumService(storage).create_feedback(
        {
            "source": "dashboard",
            "sentiment": "helpful",
            "category": "product_feedback",
            "message": "Nice page.",
            "route": "/dashboard",
        },
        owner_wallet=None,
        client_ip="127.0.0.1",
        user_agent="pytest",
    )

    assert result["supportCaseCreated"] is False
    assert result["supportTaskId"] is None
    assert len(storage.cursor.statements) == 1
    assert sent == []
