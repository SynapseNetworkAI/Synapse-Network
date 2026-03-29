from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator

from app.schemas.sentiment import (
    ErrorRecord,
    FreshnessRecord,
    ServiceDescriptor,
    SourceRecord,
)


SUPPORTED_EVM_CHAINS = {
    "ethereum",
    "arbitrum",
    "optimism",
    "base",
    "polygon",
    "bsc",
}

ADDRESS_PATTERN = re.compile(r"^0x[a-fA-F0-9]{40}$")


class SmartContractAuditRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_address: str | None = Field(
        default=None,
        description="Verified contract address on a supported EVM chain.",
    )
    chain: str | None = Field(
        default=None,
        description="EVM chain name when contract_address is provided.",
    )
    source_bundle: str | None = Field(
        default=None,
        min_length=20,
        description="Inline Solidity source bundle for local static analysis.",
    )
    analysis_depth: Literal["fast", "standard"] = Field(default="standard")
    include_evidence: bool = Field(default=True)

    @field_validator("contract_address")
    @classmethod
    def validate_contract_address(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        if not ADDRESS_PATTERN.match(normalized):
            raise ValueError("contract_address must be a valid EVM address")
        return normalized

    @field_validator("chain")
    @classmethod
    def validate_chain(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip().lower()
        if normalized not in SUPPORTED_EVM_CHAINS:
            raise ValueError(
                f"chain must be one of {', '.join(sorted(SUPPORTED_EVM_CHAINS))}"
            )
        return normalized

    @field_validator("source_bundle")
    @classmethod
    def validate_source_bundle(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        if len(normalized) < 20:
            raise ValueError("source_bundle must contain Solidity source content")
        return normalized

    @model_validator(mode="after")
    def validate_input_mode(self) -> "SmartContractAuditRequest":
        has_address_mode = self.contract_address is not None or self.chain is not None
        has_full_address_mode = (
            self.contract_address is not None and self.chain is not None
        )
        has_source_mode = self.source_bundle is not None
        if has_source_mode and has_address_mode:
            raise ValueError(
                "provide either contract_address + chain or source_bundle, not both"
            )
        if not has_source_mode and not has_full_address_mode:
            raise ValueError(
                "either contract_address + chain or source_bundle is required"
            )
        if has_address_mode and not has_full_address_mode:
            raise ValueError("contract_address and chain must be provided together")
        return self


class AuditFinding(BaseModel):
    title: str
    severity: Literal["low", "medium", "high", "critical"]
    description: str
    evidence: str | None = None


class SmartContractAuditResult(BaseModel):
    target: str
    risk_score: int = Field(alias="riskScore")
    risk_level: Literal["low", "medium", "high", "critical"] = Field(
        alias="riskLevel"
    )
    critical_findings: list[AuditFinding] = Field(
        default_factory=list,
        alias="criticalFindings",
    )
    attack_surface_summary: str = Field(alias="attackSurfaceSummary")
    fix_suggestions: list[str] = Field(
        default_factory=list,
        alias="fixSuggestions",
        min_length=1,
    )
    analysis_mode: Literal["fast", "standard"] = Field(alias="analysisMode")


class SmartContractAuditResponse(BaseModel):
    service: ServiceDescriptor
    sources: list[SourceRecord] = Field(default_factory=list)
    freshness: FreshnessRecord
    result: SmartContractAuditResult
    errors: list[ErrorRecord] = Field(default_factory=list)
