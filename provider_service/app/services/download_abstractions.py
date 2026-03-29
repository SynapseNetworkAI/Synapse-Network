from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.services.asset_storage import StoredAsset


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
