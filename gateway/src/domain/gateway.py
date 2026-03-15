"""Gateway domain entities — RouterConfigRow.

网关路由配置实体，对应 synapse_router_config 关系表（非 JSONB payload 模式）。
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class RouterConfigRow(BaseModel):
    """单条路由日限额配置（对应 synapse_router_config 行）。"""
    model_config = ConfigDict(populate_by_name=True)

    id: Optional[str] = None
    owner_address: str = Field(default="", alias="ownerAddress")
    daily_limit_usdc: float = Field(default=0.0, alias="dailyLimitUsdc")
    created_at: int = Field(default=0, alias="createdAt")
    updated_at: int = Field(default=0, alias="updatedAt")
