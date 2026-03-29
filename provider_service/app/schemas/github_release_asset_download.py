from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.sentiment import ErrorRecord, FreshnessRecord, ServiceDescriptor, SourceRecord


_REPO_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


class GitHubReleaseAssetDownloadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    repo: str
    tag: str | None = None
    latest: bool = False
    asset_pattern: str | None = Field(default=None, alias="assetPattern")
    save_mode: str = Field(default="store_and_return", alias="saveMode")

    @field_validator("repo")
    @classmethod
    def validate_repo(cls, value: str) -> str:
        normalized = str(value or "").strip()
        if not _REPO_PATTERN.fullmatch(normalized):
            raise ValueError("repo must use owner/name format")
        return normalized

    @field_validator("tag")
    @classmethod
    def validate_tag(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        if not normalized:
            raise ValueError("tag cannot be empty")
        return normalized

    @field_validator("asset_pattern")
    @classmethod
    def validate_asset_pattern(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        if not normalized:
            raise ValueError("assetPattern cannot be empty")
        return normalized

    @field_validator("save_mode")
    @classmethod
    def validate_save_mode(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized != "store_and_return":
            raise ValueError("saveMode currently supports only store_and_return")
        return normalized

    @model_validator(mode="after")
    def validate_selector(self) -> "GitHubReleaseAssetDownloadRequest":
        if self.latest and self.tag:
            raise ValueError("tag and latest cannot both be set")
        if not self.latest and not self.tag:
            raise ValueError("either tag or latest=true is required")
        return self


class GitHubReleaseStoredAsset(BaseModel):
    storage_key: str = Field(alias="storageKey")
    storage_backend: str = Field(alias="storageBackend")
    mime_type: str = Field(alias="mimeType")
    size_bytes: int = Field(alias="sizeBytes")
    sha256: str


class GitHubReleaseAssetMetadata(BaseModel):
    repo: str
    release_tag: str = Field(alias="releaseTag")
    asset_name: str = Field(alias="assetName")
    asset_pattern: str | None = Field(default=None, alias="assetPattern")
    release_url: str | None = Field(default=None, alias="releaseUrl")
    download_url: str | None = Field(default=None, alias="downloadUrl")


class GitHubReleaseAssetDownloadResult(BaseModel):
    repo: str
    release_tag: str = Field(alias="releaseTag")
    status: str
    asset_name: str = Field(alias="assetName")
    signature_verified: bool = Field(alias="signatureVerified")
    asset: GitHubReleaseStoredAsset
    metadata: GitHubReleaseAssetMetadata


class GitHubReleaseAssetDownloadResponse(BaseModel):
    service: ServiceDescriptor
    sources: list[SourceRecord] = Field(default_factory=list)
    freshness: FreshnessRecord
    result: GitHubReleaseAssetDownloadResult
    errors: list[ErrorRecord] = Field(default_factory=list)
