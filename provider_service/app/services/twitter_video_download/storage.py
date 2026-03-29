from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from app.core.config import get_settings


@dataclass(frozen=True)
class StoredObject:
    key: str
    backend: str
    content_type: str
    size_bytes: int


class VideoStorage(Protocol):
    def put_file(self, *, source_path: Path, target_key: str, content_type: str) -> StoredObject:
        raise NotImplementedError


class MinioVideoStorage:
    def __init__(
        self,
        *,
        endpoint: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        secure: bool,
    ) -> None:
        from minio import Minio

        self.backend = "minio"
        self.bucket = bucket
        self._client = Minio(
            endpoint,
            access_key=access_key,
            secret_key=secret_key,
            secure=secure,
        )

    def put_file(self, *, source_path: Path, target_key: str, content_type: str) -> StoredObject:
        if not self._client.bucket_exists(self.bucket):
            self._client.make_bucket(self.bucket)
        self._client.fput_object(
            self.bucket,
            target_key,
            str(source_path),
            content_type=content_type,
        )
        size_bytes = source_path.stat().st_size
        return StoredObject(
            key=target_key,
            backend=self.backend,
            content_type=content_type,
            size_bytes=size_bytes,
        )


def build_video_storage() -> VideoStorage:
    settings = get_settings()
    if settings.video_storage_backend != "minio":
        raise ValueError("VIDEO_STORAGE_BACKEND currently must be minio")
    if not settings.video_storage_minio_endpoint:
        raise ValueError("VIDEO_STORAGE_MINIO_ENDPOINT is required")
    if not settings.video_storage_minio_access_key:
        raise ValueError("VIDEO_STORAGE_MINIO_ACCESS_KEY is required")
    if not settings.video_storage_minio_secret_key:
        raise ValueError("VIDEO_STORAGE_MINIO_SECRET_KEY is required")
    if not settings.video_storage_minio_bucket:
        raise ValueError("VIDEO_STORAGE_MINIO_BUCKET is required")

    return MinioVideoStorage(
        endpoint=settings.video_storage_minio_endpoint,
        access_key=settings.video_storage_minio_access_key,
        secret_key=settings.video_storage_minio_secret_key,
        bucket=settings.video_storage_minio_bucket,
        secure=settings.video_storage_minio_secure,
    )
