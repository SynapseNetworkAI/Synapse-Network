from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, TypeVar

from app.services.asset_storage import StoredAsset

_T = TypeVar("_T")
_DOWNLOAD_SEMAPHORES: dict[tuple[int, str, int], asyncio.Semaphore] = {}


@dataclass(frozen=True)
class DownloadPolicy:
    temp_dir: Path
    storage_prefix: str
    default_storage_namespace: str
    # Reserved for the next Phase C steps: host gating, timeout shaping, and async scheduling.
    allowed_hosts: frozenset[str] = frozenset()
    timeout_s: float | None = None
    max_size_bytes: int | None = None
    max_duration_sec: int | None = None
    concurrency_limit: int | None = None

    def resolved_tmp_dir(self) -> Path:
        return Path(self.temp_dir).resolve()

    def build_storage_key(self, *segments: str, filename: str) -> str:
        normalized_filename = filename.strip()
        if (
            not normalized_filename
            or normalized_filename in {".", ".."}
            or "/" in normalized_filename
            or "\\" in normalized_filename
        ):
            raise ValueError("filename must be a single path segment")
        normalized_prefix = self.storage_prefix.strip("/") or self.default_storage_namespace
        normalized_segments = [segment.strip("/") for segment in segments if segment and segment.strip("/")]
        storage_key = "/".join([normalized_prefix, *normalized_segments, normalized_filename]).strip("/")
        if storage_key.startswith("/") or "//" in storage_key:
            raise ValueError("storage key must be normalized")
        return storage_key


def estimate_yt_dlp_size_bytes(info: dict[str, Any]) -> int | None:
    for key in ("filesize", "filesize_approx"):
        value = info.get(key)
        if isinstance(value, (int, float)) and value > 0:
            return int(value)

    requested_formats = info.get("requested_formats") or []
    total_size = 0
    saw_candidate = False
    for item in requested_formats:
        if not isinstance(item, dict):
            continue
        for key in ("filesize", "filesize_approx"):
            value = item.get(key)
            if isinstance(value, (int, float)) and value > 0:
                total_size += int(value)
                saw_candidate = True
                break
    if saw_candidate:
        return total_size
    return None


def enforce_media_limits(
    *,
    info: dict[str, Any],
    max_duration_sec: int | None,
    max_size_bytes: int | None,
    duration_error_code: str,
    size_error_code: str,
) -> None:
    duration_value = info.get("duration")
    if max_duration_sec and isinstance(duration_value, (int, float)) and int(duration_value) > max_duration_sec:
        raise ValueError(duration_error_code)

    estimated_size_bytes = estimate_yt_dlp_size_bytes(info)
    if max_size_bytes and estimated_size_bytes is not None and estimated_size_bytes > max_size_bytes:
        raise ValueError(size_error_code)


def _download_semaphore(service_key: str, concurrency_limit: int) -> asyncio.Semaphore:
    loop_id = id(asyncio.get_running_loop())
    normalized_limit = max(1, concurrency_limit)
    key = (loop_id, service_key, normalized_limit)
    semaphore = _DOWNLOAD_SEMAPHORES.get(key)
    if semaphore is None:
        semaphore = asyncio.Semaphore(normalized_limit)
        _DOWNLOAD_SEMAPHORES[key] = semaphore
    return semaphore


async def run_guarded_download(
    *,
    service_key: str,
    policy: DownloadPolicy,
    timeout_error_code: str,
    operation: Callable[[], Awaitable[_T]],
) -> _T:
    async def _run() -> _T:
        if policy.timeout_s and policy.timeout_s > 0:
            try:
                return await asyncio.wait_for(operation(), timeout=policy.timeout_s)
            except asyncio.TimeoutError as exc:
                raise ValueError(timeout_error_code) from exc
        return await operation()

    if policy.concurrency_limit and policy.concurrency_limit > 0:
        async with _download_semaphore(service_key, policy.concurrency_limit):
            return await _run()
    return await _run()


@dataclass(frozen=True)
class MediaAsset:
    storage_key: str
    storage_backend: str
    mime_type: str
    size_bytes: int
    sha256: str
    duration_sec: int | None = None
    width: int | None = None
    height: int | None = None

    @classmethod
    def from_stored(
        cls,
        stored: StoredAsset,
        *,
        sha256: str,
        duration_sec: int | None = None,
        width: int | None = None,
        height: int | None = None,
    ) -> "MediaAsset":
        return cls(
            storage_key=stored.key,
            storage_backend=stored.backend,
            mime_type=stored.content_type,
            size_bytes=stored.size_bytes,
            sha256=sha256,
            duration_sec=duration_sec,
            width=width,
            height=height,
        )

    def as_stored_payload(self) -> dict[str, object]:
        return {
            "storageKey": self.storage_key,
            "storageBackend": self.storage_backend,
            "mimeType": self.mime_type,
            "sizeBytes": self.size_bytes,
            "sha256": self.sha256,
        }

    def as_video_payload(self) -> dict[str, object]:
        payload = self.as_stored_payload()
        if self.duration_sec is not None:
            payload["durationSec"] = self.duration_sec
        if self.width is not None:
            payload["width"] = self.width
        if self.height is not None:
            payload["height"] = self.height
        return payload
