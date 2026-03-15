from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


"""Audit domain entity — AuditLogEntry.

审计日志采用统一事件协议，按 domain 路由到不同物理表：
1. finance -> synapse_audit_log
2. system -> synapse_system_activity_log
"""


class AuditLogEntry(BaseModel):
    """单条审计日志事件实体（统一协议）。"""

    model_config = ConfigDict(populate_by_name=True)

    id: str = ""
    timestamp: int = 0
    action: str = ""
    domain: Literal["finance", "system"] = "finance"
    owner_address: str = Field(default="", alias="ownerAddress")
    details: Dict[str, Any] = Field(default_factory=dict)


class AuditLogRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: Optional[int] = None
    action_type: str = Field(default="", alias="actionType")
    business_type: Literal[
        "deposit", "charge", "refund", "withdraw", "freeze", "unfreeze"
    ] = Field(default="charge", alias="businessType")
    risk_level: Literal["green", "yellow", "red"] = Field(
        default="green", alias="riskLevel"
    )
    owner_address: str = Field(default="", alias="ownerAddress")
    actor: Optional[str] = None
    request_id: Optional[str] = Field(default=None, alias="requestId")
    trace_id: Optional[str] = Field(default=None, alias="traceId")
    tx_hash: Optional[str] = Field(default=None, alias="txHash")
    counterparty_address: Optional[str] = Field(
        default=None, alias="counterpartyAddress"
    )
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
