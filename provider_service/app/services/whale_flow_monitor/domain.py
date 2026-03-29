from __future__ import annotations

from datetime import UTC, datetime
import hashlib

from pydantic import BaseModel, ConfigDict

from app.schemas.whale_flow_monitor import (
    WhaleFlowMonitorRequest,
    WhaleFlowMonitorResponse,
)


def parse_zulu_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def to_zulu(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def build_snapshot_key(payload: WhaleFlowMonitorRequest) -> str:
    fingerprint = hashlib.sha256(
        f"{payload.token.lower()}:{payload.chain}:{payload.window_minutes}:{payload.min_usd_value}".encode(
            "utf-8"
        )
    ).hexdigest()[:24]
    return f"whale__{fingerprint}"


class WhaleFlowSnapshotRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    snapshot_key: str
    request: WhaleFlowMonitorRequest
    response: WhaleFlowMonitorResponse
    expires_at: str | None = None

    def is_expired(self, *, now: datetime) -> bool:
        if self.expires_at is None:
            return False
        return parse_zulu_datetime(self.expires_at) <= now

    def as_cache_hit_response(self) -> WhaleFlowMonitorResponse:
        freshness = self.response.freshness.model_copy(update={"cache_hit": True})
        return self.response.model_copy(update={"freshness": freshness})
