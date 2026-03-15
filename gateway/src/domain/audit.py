"""Audit domain entity — AuditLogEntry.

审计日志不可变（append-only），字段类型明确化后
杜绝上层用 Dict[str, Any] 漏字段或拼错 key 的风险。
"""
from __future__ import annotations

from typing import Any, Dict

from pydantic import BaseModel, ConfigDict, Field


class AuditLogEntry(BaseModel):
    """单条审计日志实体（对应 synapse_audit_log.payload JSONB）。"""
    model_config = ConfigDict(populate_by_name=True)

    id: str = ""
    timestamp: int = 0
    action: str = ""
    owner_address: str = Field(default="", alias="ownerAddress")
    details: Dict[str, Any] = Field(default_factory=dict)
