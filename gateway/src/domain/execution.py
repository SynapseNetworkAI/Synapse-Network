from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class InvokeConstraintRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    body: dict[str, Any] = Field(default_factory=dict)


class ServiceQuoteRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    quote_id: str = Field(alias="quoteId")
    service_id: str = Field(alias="serviceId")
    credential_id: str = Field(alias="credentialId")
    agent_id: str = Field(alias="agentId")
    quoted_price_usdc: Decimal = Field(alias="quotedPriceUsdc")
    price_model: Literal["fixed", "tiered", "quote"] = Field(alias="priceModel")
    status: Literal["OPEN", "EXPIRED", "CONSUMED", "CANCELLED"] = "OPEN"
    request_fingerprint: str = Field(alias="requestFingerprint")
    response_mode: Literal["sync", "async", "stream"] = Field(default="sync", alias="responseMode")
    invoke_constraints: InvokeConstraintRecord = Field(default_factory=InvokeConstraintRecord, alias="invokeConstraints")
    expires_at: str = Field(alias="expiresAt")
    created_at: str = Field(default="", alias="createdAt")


class InvocationResultRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    digest: Optional[str] = None
    payload: dict[str, Any] = Field(default_factory=dict)


class InvocationRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    invocation_id: str = Field(alias="invocationId")
    quote_id: str = Field(alias="quoteId")
    service_id: str = Field(alias="serviceId")
    endpoint_id: Optional[str] = Field(default=None, alias="endpointId")
    credential_id: str = Field(alias="credentialId")
    agent_id: str = Field(alias="agentId")
    idempotency_key: str = Field(alias="idempotencyKey")
    request_digest: str = Field(alias="requestDigest")
    response_mode: Literal["sync", "async", "stream"] = Field(default="sync", alias="responseMode")
    status: Literal["PENDING", "RUNNING", "SUCCEEDED", "FAILED_RETRYABLE", "FAILED_FINAL", "SETTLED"] = "PENDING"
    charged_usdc: Decimal = Field(default=Decimal("0"), alias="chargedUsdc")
    error_code: Optional[str] = Field(default=None, alias="errorCode")
    error_action: Optional[str] = Field(default=None, alias="errorAction")
    upstream_status: Optional[int] = Field(default=None, alias="upstreamStatus")
    result: InvocationResultRecord = Field(default_factory=InvocationResultRecord)
    started_at: Optional[str] = Field(default=None, alias="startedAt")
    finished_at: Optional[str] = Field(default=None, alias="finishedAt")
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")


class BudgetEventRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    event_id: str = Field(alias="eventId")
    policy_id: str = Field(alias="policyId")
    credential_id: str = Field(alias="credentialId")
    quote_id: Optional[str] = Field(default=None, alias="quoteId")
    invocation_id: Optional[str] = Field(default=None, alias="invocationId")
    event_kind: Literal["reserve", "capture", "release", "adjust"] = Field(alias="eventKind")
    amount_usdc: Decimal = Field(alias="amountUsdc")
    remaining_lifetime_usdc: Optional[Decimal] = Field(default=None, alias="remainingLifetimeUsdc")
    remaining_daily_usdc: Optional[Decimal] = Field(default=None, alias="remainingDailyUsdc")
    created_at: str = Field(default="", alias="createdAt")