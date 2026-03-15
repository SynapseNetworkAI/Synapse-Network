"""Service registry domain entities — ServiceTargetHealth / ServiceTargetHealthHistory.

服务探活状态实体，对应 synapse_service_target_health / _history 关系表（列映射模式）。
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


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
