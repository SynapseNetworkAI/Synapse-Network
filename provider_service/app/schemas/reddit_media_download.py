from __future__ import annotations

from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.sentiment import ErrorRecord, FreshnessRecord, ServiceDescriptor, SourceRecord


_ALLOWED_HOSTS = {
    "reddit.com",
    "www.reddit.com",
    "old.reddit.com",
    "redd.it",
    "v.redd.it",
    "i.redd.it",
}


class RedditMediaDownloadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    post_url: str = Field(alias="postUrl")
    max_file_size_mb: int = Field(default=512, ge=5, le=4096, alias="maxFileSizeMb")
    save_mode: str = Field(default="store_and_return", alias="saveMode")

    @field_validator("post_url")
    @classmethod
    def validate_post_url(cls, value: str) -> str:
        normalized = str(value or "").strip()
        parsed = urlparse(normalized)
        if parsed.scheme.lower() != "https":
            raise ValueError("postUrl must use https")
        if parsed.netloc.lower() not in _ALLOWED_HOSTS:
            raise ValueError("postUrl host must be a reddit domain")
        if parsed.netloc.lower() in {"reddit.com", "www.reddit.com", "old.reddit.com"}:
            if not parsed.path.startswith("/r/"):
                raise ValueError("postUrl must be a reddit post path")
        return normalized

    @field_validator("save_mode")
    @classmethod
    def validate_save_mode(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized != "store_and_return":
            raise ValueError("saveMode currently supports only store_and_return")
        return normalized


class RedditMediaAsset(BaseModel):
    storage_key: str = Field(alias="storageKey")
    storage_backend: str = Field(alias="storageBackend")
    mime_type: str = Field(alias="mimeType")
    size_bytes: int = Field(alias="sizeBytes")
    sha256: str


class RedditPostMeta(BaseModel):
    subreddit: str
    post_id: str = Field(alias="postId")
    author: str
    created_utc: int = Field(alias="createdUtc")


class RedditMediaDownloadResult(BaseModel):
    post_url: str = Field(alias="postUrl")
    media_type: str = Field(alias="mediaType")
    status: str
    media: RedditMediaAsset
    post_meta: RedditPostMeta = Field(alias="postMeta")


class RedditMediaDownloadResponse(BaseModel):
    service: ServiceDescriptor
    sources: list[SourceRecord] = Field(default_factory=list)
    freshness: FreshnessRecord
    result: RedditMediaDownloadResult
    errors: list[ErrorRecord] = Field(default_factory=list)
