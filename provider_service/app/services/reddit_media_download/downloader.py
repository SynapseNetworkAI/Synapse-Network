from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path

from app.schemas.reddit_media_download import RedditMediaDownloadRequest
from app.services.download_abstractions import enforce_media_limits
from app.services.yt_dlp_subprocess import YtDlpSubprocessSpec, run_yt_dlp_subprocess


@dataclass(frozen=True)
class DownloadedMedia:
    post_id: str
    subreddit: str
    author: str
    created_utc: int
    media_type: str
    file_path: Path
    mime_type: str
    sha256: str


async def download_reddit_media(
    payload: RedditMediaDownloadRequest,
    *,
    target_dir: Path,
) -> DownloadedMedia:
    target_dir.mkdir(parents=True, exist_ok=True)
    preflight = await run_yt_dlp_subprocess(
        YtDlpSubprocessSpec(
            url=payload.post_url,
            target_dir=target_dir,
            format_selector="best",
            download=False,
        )
    )
    enforce_media_limits(
        info=preflight,
        max_duration_sec=None,
        max_size_bytes=payload.max_file_size_mb * 1024 * 1024,
        duration_error_code="REDDIT_MEDIA_DOWNLOAD_FAILED",
        size_error_code="REDDIT_MEDIA_SIZE_EXCEEDED",
    )
    info = await run_yt_dlp_subprocess(
        YtDlpSubprocessSpec(
            url=payload.post_url,
            target_dir=target_dir,
            format_selector="best",
            download=True,
        )
    )

    path = Path(str(info.get("filepath") or ""))
    if not path.exists():
        raise ValueError("REDDIT_MEDIA_DOWNLOAD_FAILED")

    size_mb = path.stat().st_size / (1024 * 1024)
    if size_mb > payload.max_file_size_mb:
        raise ValueError("REDDIT_MEDIA_SIZE_EXCEEDED")

    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    ext = path.suffix.lower()
    if ext in {".mp4", ".webm", ".mov"}:
        media_type = "video"
        mime_type = "video/mp4"
    elif ext in {".gif"}:
        media_type = "gif"
        mime_type = "image/gif"
    else:
        media_type = "image_set"
        mime_type = "image/jpeg"

    return DownloadedMedia(
        post_id=str(info.get("id") or ""),
        subreddit=str(info.get("subreddit") or "unknown"),
        author=str(info.get("uploader") or info.get("uploader_id") or "unknown"),
        created_utc=int(info.get("timestamp") or 0),
        media_type=media_type,
        file_path=path,
        mime_type=mime_type,
        sha256=digest,
    )
