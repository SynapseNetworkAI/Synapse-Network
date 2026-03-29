from __future__ import annotations

from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.sentiment import ErrorRecord, FreshnessRecord, ServiceDescriptor, SourceRecord


_ALLOWED_HOSTS = {
    "tiktok.com",
    "www.tiktok.com",
    "vm.tiktok.com",
    "m.tiktok.com",
}

_ALLOWED_QUALITY = {"360p", "720p", "1080p", "source"}
_ALLOWED_WATERMARK_POLICY = {"allow", "prefer_no_watermark"}


class TikTokVideoDownloadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    post_url: str = Field(alias="postUrl")
    prefer_quality: str = Field(default="720p", alias="preferQuality")
    watermark_policy: str = Field(default="allow", alias="watermarkPolicy")
    max_file_size_mb: int = Field(default=200, ge=10, le=2048, alias="maxFileSizeMb")

    @field_validator("post_url")
    @classmethod
    def validate_post_url(cls, value: str) -> str:
        normalized = str(value or "").strip()
        parsed = urlparse(normalized)
        if parsed.scheme.lower() != "https":
            raise ValueError("postUrl must use https")
        if parsed.netloc.lower() not in _ALLOWED_HOSTS:
            raise ValueError("postUrl host must be tiktok.com")
        if "/video/" not in parsed.path:
            raise ValueError("postUrl must include /video/<post_id>")
        return normalized

    @field_validator("prefer_quality")
    @classmethod
    def validate_prefer_quality(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in _ALLOWED_QUALITY:
            raise ValueError("preferQuality must be one of 360p, 720p, 1080p, source")
        return normalized

    @field_validator("watermark_policy")
    @classmethod
    def validate_watermark_policy(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in _ALLOWED_WATERMARK_POLICY:
            raise ValueError("watermarkPolicy must be one of allow, prefer_no_watermark")
        return normalized


class TikTokVideoAsset(BaseModel):
    storage_key: str = Field(alias="storageKey")
    storage_backend: str = Field(alias="storageBackend")
    mime_type: str = Field(alias="mimeType")
    size_bytes: int = Field(alias="sizeBytes")
    duration_sec: int | None = Field(default=None, alias="durationSec")
    width: int | None = None
    height: int | None = None
    sha256: str


class TikTokVideoMeta(BaseModel):
    platform: str
    author_handle: str | None = Field(default=None, alias="authorHandle")
    post_id: str = Field(alias="postId")
    watermark: bool


class TikTokVideoDownloadResult(BaseModel):
    post_url: str = Field(alias="postUrl")
    status: str
    video: TikTokVideoAsset
    meta: TikTokVideoMeta


class TikTokVideoDownloadResponse(BaseModel):
    service: ServiceDescriptor
    sources: list[SourceRecord] = Field(default_factory=list)
    freshness: FreshnessRecord
    result: TikTokVideoDownloadResult
    errors: list[ErrorRecord] = Field(default_factory=list)
