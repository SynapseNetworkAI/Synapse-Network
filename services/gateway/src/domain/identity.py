from __future__ import annotations

from decimal import Decimal
from typing import Literal, Optional

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from src.domain.runtime_state import CredentialMetadataState


class OwnerAccountRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    owner_id: str = Field(alias="ownerId")
    owner_wallet: str = Field(alias="ownerWallet")
    status: Literal["active", "suspended", "closed"] = "active"
    default_currency: str = Field(default="USDC", alias="defaultCurrency")
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")


class OwnerProfileRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    owner_id: str = Field(alias="ownerId")
    owner_wallet: str = Field(alias="ownerWallet")
    display_name: Optional[str] = Field(default=None, alias="displayName")
    email: Optional[str] = None
    email_verified: bool = Field(default=False, alias="emailVerified")
    notify_marketing: bool = Field(default=True, alias="notifyMarketing")
    notify_alerts: bool = Field(default=True, alias="notifyAlerts")
    status: Literal["active", "suspended", "closed"] = "active"
    default_currency: str = Field(default="USDC", alias="defaultCurrency")
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")


class ProviderProfileRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    provider_id: str = Field(
        validation_alias=AliasChoices("providerId"),
        serialization_alias="providerId",
    )
    owner_id: str = Field(alias="ownerId")
    owner_wallet: str = Field(alias="ownerWallet")
    display_name: str = Field(alias="displayName")
    status: Literal["active", "paused", "archived"] = "active"
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")

class AgentProfileRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    agent_id: str = Field(alias="agentId")
    owner_id: str = Field(alias="ownerId")
    name: str
    purpose: Optional[str] = None
    status: Literal["active", "paused", "revoked"] = "active"
    runtime_label: Optional[str] = Field(default=None, alias="runtimeLabel")
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")


class AgentCredentialRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    credential_id: str = Field(alias="credentialId")
    agent_id: str = Field(alias="agentId")
    secret_hash: str = Field(alias="secretHash")
    secret_prefix: str = Field(alias="secretPrefix")
    status: Literal["active", "revoked", "expired"] = "active"
    issued_at: str = Field(default="", alias="issuedAt")
    expires_at: Optional[str] = Field(default=None, alias="expiresAt")
    revoked_at: Optional[str] = Field(default=None, alias="revokedAt")
    last_used_at: Optional[str] = Field(default=None, alias="lastUsedAt")


class BudgetPolicyRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    policy_id: str = Field(alias="policyId")
    credential_id: str = Field(alias="credentialId")
    lifetime_cap_usdc: Decimal = Field(default=Decimal("0"), alias="lifetimeCapUsdc")
    daily_cap_usdc: Decimal = Field(default=Decimal("0"), alias="dailyCapUsdc")
    per_invocation_cap_usdc: Decimal = Field(default=Decimal("0"), alias="perInvocationCapUsdc")
    rpm_limit: int = Field(default=0, alias="rpmLimit")
    qps_limit: int = Field(default=0, alias="qpsLimit")
    allowed_service_tags: list[str] = Field(default_factory=list, alias="allowedServiceTags")
    allowed_service_ids: list[str] = Field(default_factory=list, alias="allowedServiceIds")
    blocked_service_ids: list[str] = Field(default_factory=list, alias="blockedServiceIds")
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")


class RuntimeCredentialRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    owner: OwnerAccountRecord
    agent: AgentProfileRecord
    credential: AgentCredentialRecord
    policy: Optional[BudgetPolicyRecord] = None
    metadata: Optional[CredentialMetadataState] = None


class CredentialPatch(BaseModel):
    """Partial update applied by clone_runtime_credential. All fields are optional."""

    model_config = ConfigDict(extra="forbid")

    calls_used: Optional[int] = None
    status: Optional[str] = None
    secret_hash: Optional[str] = None
    secret_prefix: Optional[str] = None
    credit_limit: Optional[float] = None
    rpm: Optional[int] = None
    max_calls: Optional[int] = None
    reset_interval: Optional[str] = None
    expiration: Optional[int] = None
    expires_at: Optional[int] = None
    issued_at: Optional[str] = None
    updated_at: Optional[str] = None
    revoked_at: Optional[int] = None
    clear_revoked_at: bool = False
