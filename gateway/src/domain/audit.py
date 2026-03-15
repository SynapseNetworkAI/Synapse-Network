"""Audit domain entity — AuditLogEntry.

审计日志采用统一事件协议，按 domain 路由到不同物理表：
1. finance -> synapse_audit_log
2. system -> synapse_system_activity_log
"""
from __future__ import annotations

from typing import Any, Dict, Literal

from pydantic import BaseModel, ConfigDict, Field


class AuditLogEntry(BaseModel):
    """单条审计日志事件实体（统一协议）。"""
    model_config = ConfigDict(populate_by_name=True)

    id: str = ""
    timestamp: int = 0
    action: str = ""
    domain: Literal["finance", "system"] = "finance"
    owner_address: str = Field(default="", alias="ownerAddress")
    details: Dict[str, Any] = Field(default_factory=dict)
