"""Unit tests for POST /api/v1/events endpoint."""
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient
from fastapi import FastAPI

from src.api.routers.events import router


@pytest.fixture
def app():
    app = FastAPI()
    app.include_router(router)
    mock_emitter = MagicMock()
    mock_emitter.emit_batch = AsyncMock()
    app.state.analytics = mock_emitter
    return app


@pytest.fixture
def client(app):
    return TestClient(app)


class TestEventsEndpoint:
    def _make_event(self, event_name: str = "page_viewed", **extra) -> dict:
        return {
            "event_id": str(uuid.uuid4()),
            "event_name": event_name,
            "timestamp": "2026-04-09T15:00:00.000Z",
            "distinct_id": "a" * 64,
            "source": "frontend",
            "properties": {"page_path": "/", "role": "anonymous", **extra},
        }

    def test_accept_valid_batch(self, client):
        response = client.post("/api/v1/events", json={
            "events": [
                self._make_event("page_viewed"),
                self._make_event("cta_clicked", cta_id="hero"),
            ]
        })
        assert response.status_code == 200
        body = response.json()
        assert body["accepted"] == 2
        assert body["rejected"] == 0

    def test_reject_unknown_event_name(self, client):
        response = client.post("/api/v1/events", json={
            "events": [self._make_event("malicious_event")]
        })
        assert response.status_code == 422

    def test_reject_raw_wallet_address(self, client):
        event = self._make_event("page_viewed")
        event["distinct_id"] = "0x1234567890123456789012345678901234567890"
        response = client.post("/api/v1/events", json={
            "events": [event]
        })
        assert response.status_code == 422

    def test_reject_empty_batch(self, client):
        response = client.post("/api/v1/events", json={"events": []})
        assert response.status_code == 422

    def test_reject_oversized_batch(self, client):
        events = [self._make_event("page_viewed") for _ in range(51)]
        response = client.post("/api/v1/events", json={"events": events})
        assert response.status_code == 422

    def test_emitter_called_with_events(self, client, app):
        client.post("/api/v1/events", json={
            "events": [self._make_event("wallet_connected")]
        })
        assert app.state.analytics.emit_batch.called
        args = app.state.analytics.emit_batch.call_args[0][0]
        assert len(args) == 1
        assert args[0].event_name == "wallet_connected"
