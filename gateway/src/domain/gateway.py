from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


"""Gateway domain entities — RouterConfigRow.

网关路由配置实体。当前存储实现仍可映射兼容表或 runtime_state，领域对象保持稳定。
"""


class RouterConfigRow(BaseModel):
    """单条路由日限额配置领域实体。"""

    model_config = ConfigDict(populate_by_name=True)

    id: Optional[str] = None
    owner_address: str = Field(default="", alias="ownerAddress")
    daily_limit_usdc: float = Field(default=0.0, alias="dailyLimitUsdc")
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")
