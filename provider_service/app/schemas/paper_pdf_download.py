from __future__ import annotations

from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.sentiment import ErrorRecord, FreshnessRecord, ServiceDescriptor, SourceRecord


_SUPPORTED_SOURCES = {"arxiv", "openalex", "crossref"}


class PaperPdfDownloadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    paper_url: str | None = Field(default=None, alias="paperUrl")
    paper_id: str | None = Field(default=None, alias="paperId")
    source: str = "arxiv"
    save_mode: str = Field(default="store_and_return", alias="saveMode")

    @field_validator("paper_url")
    @classmethod
    def validate_paper_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        parsed = urlparse(normalized)
        if parsed.scheme.lower() != "https":
            raise ValueError("paperUrl must use https")
        if not parsed.netloc:
            raise ValueError("paperUrl must include a host")
        return normalized

    @field_validator("paper_id")
    @classmethod
    def validate_paper_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        if not normalized:
            raise ValueError("paperId cannot be empty")
        return normalized

    @field_validator("source")
    @classmethod
    def validate_source(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in _SUPPORTED_SOURCES:
            raise ValueError("source must be one of arxiv, openalex, crossref")
        return normalized

    @field_validator("save_mode")
    @classmethod
    def validate_save_mode(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized != "store_and_return":
            raise ValueError("saveMode currently supports only store_and_return")
        return normalized

    @model_validator(mode="after")
    def validate_selector(self) -> "PaperPdfDownloadRequest":
        if not self.paper_url and not self.paper_id:
            raise ValueError("paperUrl or paperId is required")
        return self


class PaperPdfStoredAsset(BaseModel):
    storage_key: str = Field(alias="storageKey")
    storage_backend: str = Field(alias="storageBackend")
    mime_type: str = Field(alias="mimeType")
    size_bytes: int = Field(alias="sizeBytes")
    sha256: str


class PaperPdfMetadata(BaseModel):
    title: str | None = None
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    doi: str | None = None
    source_url: str | None = Field(default=None, alias="sourceUrl")


class PaperPdfDownloadResult(BaseModel):
    source: str
    paper_id: str | None = Field(default=None, alias="paperId")
    status: str
    pdf: PaperPdfStoredAsset
    metadata: PaperPdfMetadata
    text_extract_job_id: str | None = Field(default=None, alias="textExtractJobId")


class PaperPdfDownloadResponse(BaseModel):
    service: ServiceDescriptor
    sources: list[SourceRecord] = Field(default_factory=list)
    freshness: FreshnessRecord
    result: PaperPdfDownloadResult
    errors: list[ErrorRecord] = Field(default_factory=list)
