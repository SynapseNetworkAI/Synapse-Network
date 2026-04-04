from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


"""Idempotency & rate-limit domain entities.

幂等键与限流行实体，对应 synapse_idempotency_keys / synapse_finance_rate_limit 关系表。
"""


class IdempotencyRow(BaseModel):
    """幂等键行实体（对应 synapse_idempotency_keys 行）。"""

    model_config = ConfigDict(populate_by_name=True)

    id: str = ""
    scope: str = ""
    owner_address: str = Field(default="", alias="ownerAddress")
    idempotency_key: str = Field(default="", alias="idempotencyKey")
    request_hash: str = Field(default="", alias="requestHash")
    response: Optional[dict[str, Any]] = None
    created_at: str = Field(default="", alias="createdAt")
    expires_at: int = Field(default=0, alias="expiresAt")


class RateLimitRow(BaseModel):
    """限流窗口行实体（对应 synapse_finance_rate_limit 行）。"""

    model_config = ConfigDict(populate_by_name=True)

    id: str = ""
    owner_address: str = Field(default="", alias="ownerAddress")
    action: str = ""
    window_start: int = Field(default=0, alias="windowStart")
    count: int = 0
    updated_at: str = Field(default="", alias="updatedAt")


class IdempotencyKeyRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    scope: str
    owner_address: str = Field(alias="ownerAddress")
    idempotency_key: str = Field(alias="idempotencyKey")
    request_hash: str = Field(alias="requestHash")
    response_code: Optional[str] = Field(default=None, alias="responseCode")
    response_digest: Optional[str] = Field(default=None, alias="responseDigest")
    created_at: str = Field(default="", alias="createdAt")
    expires_at: int = Field(default=0, alias="expiresAt")


class FinanceRateLimitRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    owner_address: str = Field(alias="ownerAddress")
    action: str
    window_start: int = Field(default=0, alias="windowStart")
    count: int = 0
    updated_at: str = Field(default="", alias="updatedAt")
