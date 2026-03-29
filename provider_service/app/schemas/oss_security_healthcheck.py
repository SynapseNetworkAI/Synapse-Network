from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.sentiment import (
    ErrorRecord,
    FreshnessRecord,
    ServiceDescriptor,
    SourceRecord,
)


class OSSSecurityHealthcheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    repo_url: str | None = Field(default=None, alias="repoUrl")
    package_list: list[str] = Field(default_factory=list, alias="packageList", max_length=50)
    ecosystem: Literal["npm", "pypi", "mixed"] | None = None

    @model_validator(mode="after")
    def validate_target_presence(self) -> OSSSecurityHealthcheckRequest:
        repo_url = (self.repo_url or "").strip()
        packages = [item.strip() for item in self.package_list if str(item).strip()]
        if not repo_url and not packages:
            raise ValueError("either repoUrl or packageList must be provided")
        self.repo_url = repo_url or None
        self.package_list = packages
        return self


class VulnerabilityMatch(BaseModel):
    package: str
    ecosystem: str
    severity: str
    advisory_id: str
    fixed_version: str | None = None


class DependencyRiskItem(BaseModel):
    package: str
    risk_level: str
    recommendation: str


class OSSSecurityHealthcheckResult(BaseModel):
    repo_health_score: int
    vulnerability_matches: list[VulnerabilityMatch] = Field(default_factory=list)
    maintainer_activity: str
    dependency_risk_summary: list[DependencyRiskItem] = Field(default_factory=list)
    upgrade_advice: list[str] = Field(default_factory=list)


class OSSSecurityHealthcheckResponse(BaseModel):
    service: ServiceDescriptor
    sources: list[SourceRecord] = Field(default_factory=list)
    freshness: FreshnessRecord
    result: OSSSecurityHealthcheckResult
    errors: list[ErrorRecord] = Field(default_factory=list)
