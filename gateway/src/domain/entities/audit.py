from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class AuditLogRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: Optional[int] = None
    action_type: str = Field(default="", alias="actionType")
    business_type: Literal["deposit", "charge", "refund", "withdraw", "freeze", "unfreeze"] = Field(
        default="charge", alias="businessType"
    )
    risk_level: Literal["green", "yellow", "red"] = Field(default="green", alias="riskLevel")
    owner_address: str = Field(default="", alias="ownerAddress")
    actor: Optional[str] = None
    request_id: Optional[str] = Field(default=None, alias="requestId")
    trace_id: Optional[str] = Field(default=None, alias="traceId")
    tx_hash: Optional[str] = Field(default=None, alias="txHash")
    counterparty_address: Optional[str] = Field(default=None, alias="counterpartyAddress")
    direction: Optional[str] = None
    status: Optional[str] = None
    risk_reason_code: Optional[str] = Field(default=None, alias="riskReasonCode")
    ledger_id: Optional[str] = Field(default=None, alias="ledgerId")
    client_ip: Optional[str] = Field(default=None, alias="clientIp")
    user_agent: Optional[str] = Field(default=None, alias="userAgent")
    amount_delta: Optional[Decimal] = Field(default=None, alias="amountDelta")
    before_balance: Optional[Decimal] = Field(default=None, alias="beforeBalance")
    after_balance: Optional[Decimal] = Field(default=None, alias="afterBalance")
    result_status: Optional[str] = Field(default=None, alias="resultStatus")
    error_code: Optional[str] = Field(default=None, alias="errorCode")
    message: Optional[str] = None
    created_at: Optional[str] = Field(default=None, alias="createdAt")


class SystemAuditLogRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: Optional[int] = None
    action_type: str = Field(default="", alias="actionType")
    owner_address: str = Field(default="", alias="ownerAddress")
    actor: Optional[str] = None
    request_id: Optional[str] = Field(default=None, alias="requestId")
    trace_id: Optional[str] = Field(default=None, alias="traceId")
    resource_type: Optional[str] = Field(default=None, alias="resourceType")
    resource_id: Optional[str] = Field(default=None, alias="resourceId")
    result_status: Optional[str] = Field(default=None, alias="resultStatus")
    error_code: Optional[str] = Field(default=None, alias="errorCode")
    ip_address: Optional[str] = Field(default=None, alias="ipAddress")
    user_agent: Optional[str] = Field(default=None, alias="userAgent")
    detail_json: Dict[str, Any] = Field(default_factory=dict, alias="detailJson")
    created_at: Optional[str] = Field(default=None, alias="createdAt")


class UsageLogRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    ts: int
    request_id: Optional[str] = Field(default=None, alias="requestId")
    service_id: Optional[str] = Field(default=None, alias="serviceId")
    buyer_address: Optional[str] = Field(default=None, alias="buyerAddress")
    seller_address: Optional[str] = Field(default=None, alias="sellerAddress")
    status: Optional[str] = None
    unit_price: Optional[Decimal] = Field(default=None, alias="unitPrice")
    protocol_fee: Optional[Decimal] = Field(default=None, alias="protocolFee")
    routing_tax: Optional[Decimal] = Field(default=None, alias="routingTax")
    total_charge: Optional[Decimal] = Field(default=None, alias="totalCharge")
    business_type: Literal["deposit", "charge", "refund", "withdraw", "freeze", "unfreeze"] = Field(
        default="charge", alias="businessType"
    )
    risk_level: Literal["green", "yellow", "red"] = Field(default="green", alias="riskLevel")


class FinanceRateLimitRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    owner_address: str = Field(alias="ownerAddress")
    action: str
    window_start: int = Field(default=0, alias="windowStart")
    count: int = 0
    updated_at: str = Field(default="", alias="updatedAt")


class UsageAppendBatch(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    rows: List[UsageLogRow] = Field(default_factory=list)
