from __future__ import annotations

from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.sentiment import ErrorRecord, FreshnessRecord, ServiceDescriptor, SourceRecord


_ALLOWED_HOSTS = {
    "x.com",
    "www.x.com",
    "twitter.com",
    "www.twitter.com",
    "mobile.twitter.com",
}


class TwitterVideoDownloadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    post_url: str = Field(alias="postUrl")
    preferred_quality: str = Field(default="best", alias="preferredQuality")
    max_duration_sec: int = Field(default=300, ge=10, le=1800, alias="maxDurationSec")
    max_file_size_mb: int = Field(default=250, ge=10, le=1024, alias="maxFileSizeMb")
    save_mode: str = Field(default="store_and_return", alias="saveMode")
    include_preview_image: bool = Field(default=True, alias="includePreviewImage")

    @field_validator("post_url")
    @classmethod
    def validate_post_url(cls, value: str) -> str:
        normalized = str(value or "").strip()
        parsed = urlparse(normalized)
        if parsed.scheme.lower() != "https":
            raise ValueError("postUrl must use https")
        host = parsed.netloc.lower()
        if host not in _ALLOWED_HOSTS:
            raise ValueError("postUrl host must be x.com or twitter.com")
        if "/status/" not in parsed.path:
            raise ValueError("postUrl must include /status/<tweet_id>")
        return normalized

    @field_validator("preferred_quality")
    @classmethod
    def validate_preferred_quality(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in {"best", "medium", "low"}:
            raise ValueError("preferredQuality must be one of best, medium, low")
        return normalized

    @field_validator("save_mode")
    @classmethod
    def validate_save_mode(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized != "store_and_return":
            raise ValueError("saveMode currently supports only store_and_return")
        return normalized


class TwitterVideoAsset(BaseModel):
    storage_key: str = Field(alias="storageKey")
    storage_backend: str = Field(alias="storageBackend")
    mime_type: str = Field(alias="mimeType")
    size_bytes: int = Field(alias="sizeBytes")
    duration_sec: int | None = Field(default=None, alias="durationSec")
    width: int | None = None
    height: int | None = None
    sha256: str


class TwitterPreviewImageAsset(BaseModel):
    storage_key: str = Field(alias="storageKey")
    mime_type: str = Field(alias="mimeType")


class TwitterVideoDownloadResult(BaseModel):
    post_url: str = Field(alias="postUrl")
    tweet_id: str = Field(alias="tweetId")
    status: str
    video: TwitterVideoAsset
    preview_image: TwitterPreviewImageAsset | None = Field(default=None, alias="previewImage")


class TwitterVideoDownloadResponse(BaseModel):
    service: ServiceDescriptor
    sources: list[SourceRecord] = Field(default_factory=list)
    freshness: FreshnessRecord
    result: TwitterVideoDownloadResult
    errors: list[ErrorRecord] = Field(default_factory=list)
