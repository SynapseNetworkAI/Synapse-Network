from __future__ import annotations

from datetime import UTC, datetime
import hashlib

from pydantic import BaseModel, ConfigDict

from app.schemas.tiktok_video_download import (
    TikTokVideoDownloadRequest,
    TikTokVideoDownloadResponse,
)


def to_zulu(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def parse_zulu_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def asset_key_from_request(payload: TikTokVideoDownloadRequest) -> str:
    raw = (
        f"{payload.post_url}:{payload.prefer_quality}:{payload.watermark_policy}:"
        f"{payload.max_file_size_mb}"
    )
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]
    return f"tkvid__{digest}"


class TikTokVideoAssetRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    asset_key: str
    request: TikTokVideoDownloadRequest
    response: TikTokVideoDownloadResponse
    expires_at: str | None = None

    def is_expired(self, *, now: datetime) -> bool:
        if self.expires_at is None:
            return False
        return parse_zulu_datetime(self.expires_at) <= now

    def as_cache_hit_response(self) -> TikTokVideoDownloadResponse:
        freshness = self.response.freshness.model_copy(update={"cache_hit": True})
        return self.response.model_copy(update={"freshness": freshness})
