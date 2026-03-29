from __future__ import annotations

from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.sentiment import ErrorRecord, FreshnessRecord, ServiceDescriptor, SourceRecord


_ALLOWED_HOSTS = {
    "www.tiktok.com",
    "tiktok.com",
    "m.tiktok.com",
    "vm.tiktok.com",
    "vt.tiktok.com",
}


class TikTokVideoDownloadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    video_url: str = Field(alias="videoUrl")
    preferred_quality: str = Field(default="best", alias="preferredQuality")
    max_duration_sec: int = Field(default=300, ge=10, le=1800, alias="maxDurationSec")
    with_subtitle: bool = Field(default=False, alias="withSubtitle")
    save_mode: str = Field(default="store_and_return", alias="saveMode")

    @field_validator("video_url")
    @classmethod
    def validate_video_url(cls, value: str) -> str:
        normalized = str(value or "").strip()
        parsed = urlparse(normalized)
        if parsed.scheme.lower() != "https":
            raise ValueError("videoUrl must use https")
        if parsed.netloc.lower() not in _ALLOWED_HOSTS:
            raise ValueError("videoUrl host must be a tiktok domain")
        if "/video/" not in parsed.path:
            raise ValueError("videoUrl must include /video/<id>")
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


class TikTokVideoAsset(BaseModel):
    storage_key: str = Field(alias="storageKey")
    storage_backend: str = Field(alias="storageBackend")
    mime_type: str = Field(alias="mimeType")
    size_bytes: int = Field(alias="sizeBytes")
    duration_sec: int | None = Field(default=None, alias="durationSec")
    width: int | None = None
    height: int | None = None
    sha256: str


class TikTokSubtitleAsset(BaseModel):
    storage_key: str = Field(alias="storageKey")
    mime_type: str = Field(default="text/vtt", alias="mimeType")


class TikTokDownloadTrace(BaseModel):
    source_platform: str = Field(alias="sourcePlatform")
    fallback_used: bool = Field(alias="fallbackUsed")


class TikTokVideoDownloadResult(BaseModel):
    video_url: str = Field(alias="videoUrl")
    video_id: str = Field(alias="videoId")
    status: str
    video: TikTokVideoAsset
    subtitle: TikTokSubtitleAsset | None = None
    download_trace: TikTokDownloadTrace = Field(alias="downloadTrace")


class TikTokVideoDownloadResponse(BaseModel):
    service: ServiceDescriptor
    sources: list[SourceRecord] = Field(default_factory=list)
    freshness: FreshnessRecord
    result: TikTokVideoDownloadResult
    errors: list[ErrorRecord] = Field(default_factory=list)
