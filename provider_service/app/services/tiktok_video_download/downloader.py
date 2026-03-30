from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path

from app.schemas.tiktok_video_download import TikTokVideoDownloadRequest
from app.services.download_abstractions import enforce_media_limits
from app.services.yt_dlp_subprocess import YtDlpSubprocessSpec, run_yt_dlp_subprocess


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


async def download_tiktok_video(
    payload: TikTokVideoDownloadRequest,
    *,
    target_dir: Path,
) -> DownloadedVideo:
    target_dir.mkdir(parents=True, exist_ok=True)
    preflight = await run_yt_dlp_subprocess(
        YtDlpSubprocessSpec(
            url=payload.video_url,
            target_dir=target_dir,
            format_selector=_quality_to_format(payload.preferred_quality),
            download=False,
        )
    )
    enforce_media_limits(
        info=preflight,
        max_duration_sec=payload.max_duration_sec,
        max_size_bytes=payload.max_file_size_mb * 1024 * 1024,
        duration_error_code="TIKTOK_VIDEO_DURATION_EXCEEDED",
        size_error_code="TIKTOK_VIDEO_SIZE_EXCEEDED",
    )
    info = await run_yt_dlp_subprocess(
        YtDlpSubprocessSpec(
            url=payload.video_url,
            target_dir=target_dir,
            format_selector=_quality_to_format(payload.preferred_quality),
            download=True,
        )
    )
    enforce_media_limits(
        info=info,
        max_duration_sec=payload.max_duration_sec,
        max_size_bytes=payload.max_file_size_mb * 1024 * 1024,
        duration_error_code="TIKTOK_VIDEO_DURATION_EXCEEDED",
        size_error_code="TIKTOK_VIDEO_SIZE_EXCEEDED",
    )

    path = Path(str(info.get("filepath") or ""))
    if not path.exists():
        raise ValueError("TIKTOK_VIDEO_DOWNLOAD_FAILED")
    size_mb = path.stat().st_size / (1024 * 1024)
    if size_mb > payload.max_file_size_mb:
        raise ValueError("TIKTOK_VIDEO_SIZE_EXCEEDED")

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
