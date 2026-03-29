from __future__ import annotations

from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.sentiment import ErrorRecord, FreshnessRecord, ServiceDescriptor, SourceRecord


_ALLOWED_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
    "www.youtu.be",
}


class YouTubeVideoDownloadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    video_url: str = Field(alias="videoUrl")
    preferred_quality: str = Field(default="best", alias="preferredQuality")
    max_duration_sec: int = Field(default=1800, ge=30, le=21600, alias="maxDurationSec")
    max_file_size_mb: int = Field(default=500, ge=10, le=4096, alias="maxFileSizeMb")
    save_mode: str = Field(default="store_and_return", alias="saveMode")

    @field_validator("video_url")
    @classmethod
    def validate_video_url(cls, value: str) -> str:
        normalized = str(value or "").strip()
        parsed = urlparse(normalized)
        if parsed.scheme.lower() != "https":
            raise ValueError("videoUrl must use https")
        if parsed.netloc.lower() not in _ALLOWED_HOSTS:
            raise ValueError("videoUrl host must be youtube.com or youtu.be")
        if "youtu.be" in parsed.netloc.lower() and not parsed.path.strip("/"):
            raise ValueError("videoUrl must include short video id path")
        if "youtube.com" in parsed.netloc.lower() and not (
            parsed.path == "/watch" or parsed.path.startswith("/shorts/")
        ):
            raise ValueError("videoUrl must be youtube watch/shorts URL")
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


class YouTubeVideoAsset(BaseModel):
    storage_key: str = Field(alias="storageKey")
    storage_backend: str = Field(alias="storageBackend")
    mime_type: str = Field(alias="mimeType")
    size_bytes: int = Field(alias="sizeBytes")
    duration_sec: int | None = Field(default=None, alias="durationSec")
    width: int | None = None
    height: int | None = None
    sha256: str


class YouTubeVideoDownloadResult(BaseModel):
    video_url: str = Field(alias="videoUrl")
    video_id: str = Field(alias="videoId")
    status: str
    video: YouTubeVideoAsset


class YouTubeVideoDownloadResponse(BaseModel):
    service: ServiceDescriptor
    sources: list[SourceRecord] = Field(default_factory=list)
    freshness: FreshnessRecord
    result: YouTubeVideoDownloadResult
    errors: list[ErrorRecord] = Field(default_factory=list)
