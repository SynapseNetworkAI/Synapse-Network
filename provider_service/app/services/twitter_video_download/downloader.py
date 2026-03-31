from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
from urllib.parse import urlparse

import httpx

from app.core.config import get_settings
from app.schemas.twitter_video_download import TwitterVideoDownloadRequest
from app.services.download_abstractions import enforce_media_limits
from app.services.twitter_video_download.x_api import (
    resolve_twitter_video_from_x_api,
    x_api_client,
)


@dataclass(frozen=True)
class DownloadedVideo:
    tweet_id: str
    file_path: Path
    duration_sec: int | None
    width: int | None
    height: int | None
    mime_type: str
    sha256: str


def _guess_filename(tweet_id: str, variant_url: str) -> str:
    suffix = Path(urlparse(variant_url).path).suffix or ".mp4"
    return f"{tweet_id}{suffix}"


async def download_twitter_video(
    payload: TwitterVideoDownloadRequest,
    *,
    target_dir: Path,
    http_client: httpx.AsyncClient | None = None,
) -> DownloadedVideo:
    target_dir.mkdir(parents=True, exist_ok=True)
    resolved = await resolve_twitter_video_from_x_api(
        payload.post_url,
        preferred_quality=payload.preferred_quality,
        client=http_client,
    )
    enforce_media_limits(
        info={"duration": resolved.duration_sec},
        max_duration_sec=payload.max_duration_sec,
        max_size_bytes=None,
        duration_error_code="VIDEO_DURATION_EXCEEDED",
        size_error_code="TWITTER_VIDEO_SIZE_EXCEEDED",
    )
    path = target_dir / _guess_filename(resolved.tweet_id, resolved.variant_url)
    digest = hashlib.sha256()
    total_size_bytes = 0
    max_size_bytes = payload.max_file_size_mb * 1024 * 1024
    settings = get_settings()

    async with x_api_client(http_client) as client:
        async with client.stream(
            "GET",
            resolved.variant_url,
            headers={"User-Agent": settings.twitter_x_api_user_agent},
        ) as response:
            if response.status_code == 404:
                raise ValueError("VIDEO_NOT_FOUND_IN_POST")
            if response.status_code == 429:
                raise ValueError("TWITTER_X_API_RATE_LIMITED")
            if response.status_code in {401, 403}:
                raise ValueError("TWITTER_X_API_AUTH_FAILED")
            try:
                response.raise_for_status()
            except httpx.HTTPError as exc:
                raise ValueError("VIDEO_DOWNLOAD_FAILED") from exc

            header_size = response.headers.get("Content-Length")
            if header_size and header_size.isdigit() and int(header_size) > max_size_bytes:
                raise ValueError("TWITTER_VIDEO_SIZE_EXCEEDED")

            with path.open("wb") as handle:
                async for chunk in response.aiter_bytes():
                    if not chunk:
                        continue
                    total_size_bytes += len(chunk)
                    if total_size_bytes > max_size_bytes:
                        handle.close()
                        path.unlink(missing_ok=True)
                        raise ValueError("TWITTER_VIDEO_SIZE_EXCEEDED")
                    handle.write(chunk)
                    digest.update(chunk)

    if not path.exists():
        raise ValueError("VIDEO_DOWNLOAD_FAILED")
    return DownloadedVideo(
        tweet_id=resolved.tweet_id,
        file_path=path,
        duration_sec=resolved.duration_sec,
        width=resolved.width,
        height=resolved.height,
        mime_type=resolved.mime_type,
        sha256=digest.hexdigest(),
    )
