from __future__ import annotations

from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class CredentialRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    credential_type: str = Field(alias="credentialType")
    owner_address: str = Field(alias="ownerAddress")
    name: Optional[str] = None
    token_hash: Optional[str] = Field(default=None, alias="tokenHash")
    token_prefix: Optional[str] = Field(default=None, alias="tokenPrefix")
    status: Optional[str] = None
    max_calls: Optional[int] = Field(default=None, alias="maxCalls")
    calls_used: Optional[int] = Field(default=None, alias="callsUsed")
    rpm: Optional[int] = None
    credit_limit: Optional[Decimal] = Field(default=None, alias="creditLimit")
    reset_interval: Optional[str] = Field(default=None, alias="resetInterval")
    expiration: Optional[int] = None
    expires_at: Optional[int] = Field(default=None, alias="expiresAt")
    created_at: Optional[str] = Field(default=None, alias="createdAt")
    updated_at: Optional[str] = Field(default=None, alias="updatedAt")
    revoked_at: Optional[int] = Field(default=None, alias="revokedAt")


class WalletRoleRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    wallet_address: str = Field(alias="walletAddress")
    role: str
    updated_at: str = Field(default="", alias="updatedAt")


class AuthSessionRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    wallet_address: str = Field(alias="walletAddress")
    registered_at: int = Field(default=0, alias="registeredAt")
    last_login: int = Field(default=0, alias="lastLogin")
    status: str
    updated_at: str = Field(default="", alias="updatedAt")
