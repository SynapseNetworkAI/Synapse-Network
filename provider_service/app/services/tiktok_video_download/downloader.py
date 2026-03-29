from __future__ import annotations

import asyncio
from dataclasses import dataclass
import hashlib
from pathlib import Path

from app.schemas.tiktok_video_download import TikTokVideoDownloadRequest


@dataclass(frozen=True)
class DownloadedVideo:
    video_id: str
    file_path: Path
    duration_sec: int | None
    width: int | None
    height: int | None
    mime_type: str
    sha256: str


def _quality_to_format(quality: str) -> str:
    if quality == "medium":
        return "bestvideo[height<=720]+bestaudio/best[height<=720]/best"
    if quality == "low":
        return "bestvideo[height<=480]+bestaudio/best[height<=480]/best"
    return "bestvideo+bestaudio/best"


def _download_sync(payload: TikTokVideoDownloadRequest, target_dir: Path) -> DownloadedVideo:
    from yt_dlp import YoutubeDL

    target_dir.mkdir(parents=True, exist_ok=True)
    outtmpl = str(target_dir / "%(id)s.%(ext)s")
    options = {
        "outtmpl": outtmpl,
        "format": _quality_to_format(payload.preferred_quality),
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 20,
    }

    with YoutubeDL(options) as ydl:
        info = ydl.extract_info(payload.video_url, download=True)

    if info.get("duration") and int(info["duration"]) > payload.max_duration_sec:
        raise ValueError("TIKTOK_VIDEO_DURATION_EXCEEDED")

    requested_downloads = info.get("requested_downloads") or []
    file_path = None
    if requested_downloads:
        file_path = requested_downloads[0].get("filepath")
    if not file_path:
        ext = info.get("ext") or "mp4"
        file_path = str(target_dir / f"{info.get('id')}.{ext}")

    path = Path(file_path)
    if not path.exists():
        raise ValueError("TIKTOK_VIDEO_DOWNLOAD_FAILED")

    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return DownloadedVideo(
        video_id=str(info.get("id") or ""),
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
