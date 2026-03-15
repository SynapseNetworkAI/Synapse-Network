from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class DepositDedupRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    tx_hash: str = Field(default="", alias="txHash")
    owner_address: str = Field(default="", alias="ownerAddress")
    request_id: Optional[str] = Field(default=None, alias="requestId")


class WithdrawTxDedupRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    owner_address: str = Field(default="", alias="ownerAddress")
    tx_hash: str = Field(default="", alias="txHash")
    kind: str


class ProcessedDepositEventRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    dedup_key: str = Field(alias="dedupKey")
    updated_at: str = Field(default="", alias="updatedAt")


class ServiceRegistryRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    service_id: str = Field(alias="serviceId")
    owner_address: str = Field(alias="ownerAddress")
    service_name: str = Field(default="", alias="serviceName")
    summary: Optional[str] = None
    endpoint: Optional[str] = None
    status: str = "active"
    is_active: bool = Field(default=True, alias="isActive")
    pricing_amount: Decimal = Field(default=Decimal("0"), alias="pricingAmount")
    pricing_currency: str = Field(default="USDC", alias="pricingCurrency")
    timeout_ms: Optional[int] = Field(default=None, alias="timeoutMs")
    max_qps: Optional[int] = Field(default=None, alias="maxQps")
    max_request_bytes: Optional[int] = Field(default=None, alias="maxRequestBytes")
    max_response_bytes: Optional[int] = Field(default=None, alias="maxResponseBytes")
    id: Optional[str] = None
    schema_version: Optional[int] = Field(default=None, alias="schemaVersion")
    role: Optional[str] = None
    address: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    auth: Dict[str, Any] = Field(default_factory=dict)
    health_check: Dict[str, Any] = Field(default_factory=dict, alias="healthCheck")
    forwarding: Dict[str, Any] = Field(default_factory=dict)
    metering: Dict[str, Any] = Field(default_factory=dict)
    invoke: Dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")


class PlatformFeePolicyDefaultRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    singleton_id: int = Field(default=1, alias="singletonId")
    default_rate: Decimal = Field(default=Decimal("0"), alias="defaultRate")
    updated_at: Optional[str] = Field(default=None, alias="updatedAt")
    updated_by: Optional[str] = Field(default=None, alias="updatedBy")


class PlatformFeePolicyOwnerRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    owner_address: str = Field(alias="ownerAddress")
    fee_rate: Decimal = Field(default=Decimal("0"), alias="feeRate")


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
