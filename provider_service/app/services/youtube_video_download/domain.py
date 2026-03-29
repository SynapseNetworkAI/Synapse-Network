from __future__ import annotations

from datetime import UTC, datetime
import hashlib

from pydantic import BaseModel, ConfigDict

from app.schemas.youtube_video_download import (
    YouTubeVideoDownloadRequest,
    YouTubeVideoDownloadResponse,
)


def to_zulu(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def parse_zulu_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def asset_key_from_request(payload: YouTubeVideoDownloadRequest) -> str:
    raw = f"{payload.video_url}:{payload.preferred_quality}:{payload.max_duration_sec}:{payload.max_file_size_mb}"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]
    return f"ytvid__{digest}"


class YouTubeVideoAssetRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    asset_key: str
    request: YouTubeVideoDownloadRequest
    response: YouTubeVideoDownloadResponse
    expires_at: str | None = None

    def is_expired(self, *, now: datetime) -> bool:
        if self.expires_at is None:
            return False
        return parse_zulu_datetime(self.expires_at) <= now

    def as_cache_hit_response(self) -> YouTubeVideoDownloadResponse:
        freshness = self.response.freshness.model_copy(update={"cache_hit": True})
        return self.response.model_copy(update={"freshness": freshness})
