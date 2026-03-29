from __future__ import annotations

import asyncio
from dataclasses import dataclass
import hashlib
import re
from pathlib import Path

from app.schemas.tiktok_video_download import TikTokVideoDownloadRequest


@dataclass(frozen=True)
class DownloadedVideo:
    post_id: str
    author_handle: str | None
    watermark: bool
    file_path: Path
    duration_sec: int | None
    width: int | None
    height: int | None
    mime_type: str
    sha256: str


def _quality_to_format(quality: str) -> str:
    if quality == "360p":
        return "bestvideo[height<=360]+bestaudio/best[height<=360]/best"
    if quality == "720p":
        return "bestvideo[height<=720]+bestaudio/best[height<=720]/best"
    if quality == "1080p":
        return "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best"
    return "bestvideo+bestaudio/best"


def _extract_post_id(url: str) -> str:
    match = re.search(r"/video/(\d+)", url)
    return match.group(1) if match else ""


def _extract_author(url: str) -> str | None:
    match = re.search(r"tiktok\.com/@([^/]+)/video", url)
    if not match:
        return None
    return f"@{match.group(1)}"


def _download_sync(payload: TikTokVideoDownloadRequest, target_dir: Path) -> DownloadedVideo:
    from yt_dlp import YoutubeDL

    target_dir.mkdir(parents=True, exist_ok=True)
    outtmpl = str(target_dir / "%(id)s.%(ext)s")
    options = {
        "outtmpl": outtmpl,
        "format": _quality_to_format(payload.prefer_quality),
        "merge_output_format": "mp4",
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
        ext = info.get("ext") or "mp4"
        file_path = str(target_dir / f"{info.get('id')}.{ext}")

    path = Path(file_path)
    if not path.exists():
        raise ValueError("TIKTOK_DOWNLOAD_FAILED")

    size_mb = path.stat().st_size / (1024 * 1024)
    if size_mb > payload.max_file_size_mb:
        raise ValueError("TIKTOK_FILE_TOO_LARGE")

    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return DownloadedVideo(
        post_id=str(info.get("id") or _extract_post_id(payload.post_url)),
        author_handle=_extract_author(payload.post_url),
        watermark=payload.watermark_policy == "allow",
        file_path=path,
        duration_sec=int(info["duration"]) if info.get("duration") else None,
        width=int(info["width"]) if info.get("width") else None,
        height=int(info["height"]) if info.get("height") else None,
        mime_type="video/mp4",
        sha256=digest,
    )


async def download_tiktok_video(
    payload: TikTokVideoDownloadRequest,
    *,
    target_dir: Path,
) -> DownloadedVideo:
    return await asyncio.to_thread(_download_sync, payload, target_dir)
