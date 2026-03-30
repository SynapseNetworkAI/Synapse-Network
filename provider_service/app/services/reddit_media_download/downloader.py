from __future__ import annotations

import asyncio
from dataclasses import dataclass
import hashlib
from pathlib import Path

from app.schemas.reddit_media_download import RedditMediaDownloadRequest


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


def _download_sync(payload: RedditMediaDownloadRequest, target_dir: Path) -> DownloadedMedia:
    from yt_dlp import YoutubeDL

    target_dir.mkdir(parents=True, exist_ok=True)
    outtmpl = str(target_dir / "%(id)s.%(ext)s")
    options = {
        "outtmpl": outtmpl,
        "format": "best",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 20,
    }

    with YoutubeDL(options) as ydl:
        info = ydl.extract_info(payload.post_url, download=True)

    requested_downloads = info.get("requested_downloads") or []
    file_path = None
    if requested_downloads:
        file_path = requested_downloads[0].get("filepath")
    if not file_path:
        ext = info.get("ext") or "bin"
        file_path = str(target_dir / f"{info.get('id')}.{ext}")

    path = Path(file_path)
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


async def download_reddit_media(
    payload: RedditMediaDownloadRequest,
    *,
    target_dir: Path,
) -> DownloadedMedia:
    return await asyncio.to_thread(_download_sync, payload, target_dir)
