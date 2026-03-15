from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


"""Service registry domain entities — ServiceTargetHealth / ServiceTargetHealthHistory.

服务探活状态实体，对应 synapse_service_target_health / _history 关系表（列映射模式）。
"""


class ServiceTargetHealth(BaseModel):
    """服务目标健康状态行实体（对应 synapse_service_target_health 行）。"""

    model_config = ConfigDict(populate_by_name=True)

    service_id: str = Field(default="", alias="serviceId")
    owner_address: Optional[str] = Field(default=None, alias="ownerAddress")
    target_url: str = Field(default="", alias="targetUrl")
    weight: Optional[int] = None
    region: Optional[str] = None
    status: Optional[str] = None
    overall_status: Optional[str] = Field(default=None, alias="overallStatus")
    http_status: Optional[int] = Field(default=None, alias="httpStatus")
    latency_ms: Optional[int] = Field(default=None, alias="latencyMs")
    consecutive_successes: int = Field(default=0, alias="consecutiveSuccesses")
    consecutive_failures: int = Field(default=0, alias="consecutiveFailures")
    probe_url: Optional[str] = Field(default=None, alias="probeUrl")
    last_checked_at: Optional[int] = Field(default=None, alias="lastCheckedAt")
    last_healthy_at: Optional[int] = Field(default=None, alias="lastHealthyAt")
    error: Optional[str] = None


class ServiceTargetHealthHistory(BaseModel):
    """服务探活历史行实体（对应 synapse_service_target_health_history 行）。"""

    model_config = ConfigDict(populate_by_name=True)

    service_id: str = Field(default="", alias="serviceId")
    owner_address: Optional[str] = Field(default=None, alias="ownerAddress")
    target_url: str = Field(default="", alias="targetUrl")
    status: Optional[str] = None
    http_status: Optional[int] = Field(default=None, alias="httpStatus")
    latency_ms: Optional[int] = Field(default=None, alias="latencyMs")
    probe_url: Optional[str] = Field(default=None, alias="probeUrl")
    consecutive_successes: int = Field(default=0, alias="consecutiveSuccesses")
    consecutive_failures: int = Field(default=0, alias="consecutiveFailures")
    checked_at: int = Field(default=0, alias="checkedAt")
    last_healthy_at: Optional[int] = Field(default=None, alias="lastHealthyAt")
    error: Optional[str] = None


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
