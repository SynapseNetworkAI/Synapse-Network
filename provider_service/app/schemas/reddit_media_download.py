from __future__ import annotations

from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.sentiment import ErrorRecord, FreshnessRecord, ServiceDescriptor, SourceRecord


_ALLOWED_HOSTS = {
    "reddit.com",
    "www.reddit.com",
    "old.reddit.com",
    "redd.it",
}

_ALLOWED_MEDIA_TYPE = {"video", "image_set", "gif", "auto"}


class RedditMediaDownloadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    post_url: str = Field(alias="postUrl")
    media_type: str = Field(default="auto", alias="mediaType")
    max_file_size_mb: int = Field(default=200, ge=10, le=2048, alias="maxFileSizeMb")

    @field_validator("post_url")
    @classmethod
    def validate_post_url(cls, value: str) -> str:
        normalized = str(value or "").strip()
        parsed = urlparse(normalized)
        if parsed.scheme.lower() != "https":
            raise ValueError("postUrl must use https")
        if parsed.netloc.lower() not in _ALLOWED_HOSTS:
            raise ValueError("postUrl host must be reddit.com or redd.it")
        if "/comments/" not in parsed.path and parsed.netloc.lower() != "redd.it":
            raise ValueError("postUrl must include /comments/<post_id>")
        return normalized

    @field_validator("media_type")
    @classmethod
    def validate_media_type(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in _ALLOWED_MEDIA_TYPE:
            raise ValueError("mediaType must be one of auto, video, image_set, gif")
        return normalized


class RedditMediaAsset(BaseModel):
    storage_key: str = Field(alias="storageKey")
    storage_backend: str = Field(alias="storageBackend")
    mime_type: str = Field(alias="mimeType")
    size_bytes: int = Field(alias="sizeBytes")
    sha256: str


class RedditMediaMeta(BaseModel):
    post_id: str = Field(alias="postId")
    subreddit: str | None = None
    author: str | None = None
    media_kind: str = Field(alias="mediaKind")


class RedditMediaDownloadResult(BaseModel):
    post_url: str = Field(alias="postUrl")
    status: str
    asset: RedditMediaAsset
    meta: RedditMediaMeta


class RedditMediaDownloadResponse(BaseModel):
    service: ServiceDescriptor
    sources: list[SourceRecord] = Field(default_factory=list)
    freshness: FreshnessRecord
    result: RedditMediaDownloadResult
    errors: list[ErrorRecord] = Field(default_factory=list)
