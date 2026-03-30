from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib

from app.schemas.tiktok_video_download import (
    TikTokVideoDownloadRequest,
    TikTokVideoDownloadResponse,
)


@dataclass(frozen=True)
class TikTokVideoAssetRecord:
    asset_key: str
    request: TikTokVideoDownloadRequest
    response: TikTokVideoDownloadResponse
    expires_at: str | None = None

    def is_expired(self, *, now: datetime) -> bool:
        if not self.expires_at:
            return False
        return parse_zulu_datetime(self.expires_at) <= now.astimezone(UTC)

    def as_cache_hit_response(self) -> TikTokVideoDownloadResponse:
        return self.response.model_copy(
            update={
                "freshness": self.response.freshness.model_copy(update={"cache_hit": True}),
            }
        )


def asset_key_from_request(payload: TikTokVideoDownloadRequest) -> str:
    canonical = "|".join(
        [
            payload.video_url,
            payload.preferred_quality,
            str(payload.max_duration_sec),
            str(payload.with_subtitle),
        ]
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def parse_zulu_datetime(value: str) -> datetime:
    normalized = str(value or "").strip()
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def to_zulu(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
