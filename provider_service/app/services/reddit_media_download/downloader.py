from __future__ import annotations

import asyncio
from dataclasses import dataclass
import hashlib
import re
from pathlib import Path

from app.schemas.reddit_media_download import RedditMediaDownloadRequest


@dataclass(frozen=True)
class DownloadedMedia:
    post_id: str
    subreddit: str | None
    author: str | None
    media_kind: str
    file_path: Path
    mime_type: str
    sha256: str


def _extract_post_id(url: str) -> str:
    match = re.search(r"/comments/([a-z0-9]+)/", url)
    return match.group(1) if match else ""


def _download_sync(payload: RedditMediaDownloadRequest, target_dir: Path) -> DownloadedMedia:
    from yt_dlp import YoutubeDL

    target_dir.mkdir(parents=True, exist_ok=True)
    outtmpl = str(target_dir / "%(_reddit_id)s_%(id)s.%(ext)s")
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

    req = info.get("requested_downloads") or []
    file_path = req[0].get("filepath") if req else None
    if not file_path:
        ext = info.get("ext") or "mp4"
        rid = info.get("_reddit_id") or info.get("id") or "reddit"
        file_path = str(target_dir / f"{rid}.{ext}")

    path = Path(file_path)
    if not path.exists():
        raise ValueError("REDDIT_MEDIA_DOWNLOAD_FAILED")

    size_mb = path.stat().st_size / (1024 * 1024)
    if size_mb > payload.max_file_size_mb:
        raise ValueError("REDDIT_MEDIA_FILE_TOO_LARGE")

    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return DownloadedMedia(
        post_id=str(info.get("_reddit_id") or _extract_post_id(payload.post_url)),
        subreddit=str(info.get("subreddit") or "") or None,
        author=str(info.get("uploader") or "") or None,
        media_kind="video" if str(info.get("ext") or "").lower() in {"mp4", "webm"} else payload.media_type,
        file_path=path,
        mime_type="video/mp4" if path.suffix.lower() in {".mp4", ".webm"} else "application/octet-stream",
        sha256=digest,
    )


async def download_reddit_media(
    payload: RedditMediaDownloadRequest,
    *,
    target_dir: Path,
) -> DownloadedMedia:
    return await asyncio.to_thread(_download_sync, payload, target_dir)
