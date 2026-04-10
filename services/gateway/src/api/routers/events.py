"""
Frontend Event Ingestion Endpoint

Frontend analytics.ts batches events to POST /api/v1/events.
Gateway validates schema then writes to Kafka.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, field_validator

from src.services.analytics.emitter import AnalyticsEvent

logger = logging.getLogger("synapse.analytics.ingest")
router = APIRouter(prefix="/api/v1", tags=["analytics"])


ALLOWED_FRONTEND_EVENTS = frozenset({
    "page_viewed", "cta_clicked",
    "wallet_connect_started", "wallet_connected", "wallet_connect_failed",
    "role_selected",
    "consumer_signup_completed", "consumer_console_viewed",
    "deposit_started", "deposit_permit_signed",
    "service_search_executed", "service_detail_viewed",
    "receipt_viewed",
    "provider_signup_completed", "provider_console_viewed",
    "service_manifest_step_completed",
    "withdrawal_requested",
    "$identify",
})


class EventPayload(BaseModel):
    event_id: str
    event_name: str
    timestamp: str
    distinct_id: str
    source: str = "frontend"
    properties: dict[str, Any] = Field(default_factory=dict)

    @field_validator("event_name")
    @classmethod
    def validate_event_name(cls, v: str) -> str:
        if v not in ALLOWED_FRONTEND_EVENTS:
            raise ValueError(f"Unknown frontend event: {v}")
        return v

    @field_validator("distinct_id")
    @classmethod
    def validate_distinct_id(cls, v: str) -> str:
        if v.startswith("0x") and len(v) == 42:
            raise ValueError("distinct_id must be hashed, not raw wallet address")
        return v


class EventBatchRequest(BaseModel):
    events: list[EventPayload] = Field(..., min_length=1, max_length=50)


class EventBatchResponse(BaseModel):
    accepted: int
    rejected: int
    errors: list[str] = Field(default_factory=list)


@router.post("/events", response_model=EventBatchResponse)
async def ingest_events(body: EventBatchRequest, request: Request) -> EventBatchResponse:
    """Accept a batch of frontend analytics events and write to pipeline."""
    emitter = request.app.state.analytics
    accepted = 0
    rejected = 0
    errors: list[str] = []

    events_to_send: list[AnalyticsEvent] = []
    for payload in body.events:
        try:
            event = AnalyticsEvent(
                event_id=payload.event_id,
                event_name=payload.event_name,
                timestamp=payload.timestamp,
                distinct_id=payload.distinct_id,
                source=payload.source,
                properties=payload.properties,
            )
            events_to_send.append(event)
            accepted += 1
        except Exception as e:
            rejected += 1
            errors.append(f"{payload.event_name}: {str(e)}")

    if events_to_send:
        await emitter.emit_batch(events_to_send)

    return EventBatchResponse(accepted=accepted, rejected=rejected, errors=errors)
