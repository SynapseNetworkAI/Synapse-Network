from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime

from app.schemas.github_release_asset_download import (
    GitHubReleaseAssetDownloadRequest,
    GitHubReleaseAssetDownloadResponse,
)


@dataclass(frozen=True)
class GitHubReleaseAssetRecord:
    asset_key: str
    request: GitHubReleaseAssetDownloadRequest
    response: GitHubReleaseAssetDownloadResponse
    expires_at: str | None = None

    def is_expired(self, *, now: datetime) -> bool:
        if not self.expires_at:
            return False
        return parse_zulu_datetime(self.expires_at) <= now.astimezone(UTC)

    def as_cache_hit_response(self) -> GitHubReleaseAssetDownloadResponse:
        return self.response.model_copy(
            update={
                "freshness": self.response.freshness.model_copy(update={"cache_hit": True}),
            }
        )


def asset_key_from_request(payload: GitHubReleaseAssetDownloadRequest) -> str:
    selector = f"tag:{payload.tag}" if payload.tag else "latest"
    canonical = "|".join([payload.repo, selector, payload.asset_pattern or ""])
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
