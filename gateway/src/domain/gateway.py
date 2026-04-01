from __future__ import annotations

from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


"""Gateway domain entities — RouterConfigRow / OwnerSpendLimitRow.

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


class OwnerSpendLimitRow(BaseModel):
    """Owner account billing-cycle spend limit entity."""

    model_config = ConfigDict(populate_by_name=True)

    id: Optional[str] = None
    owner_address: str = Field(default="", alias="ownerAddress")
    spending_limit_usdc: Optional[Decimal] = Field(default=None, alias="spendingLimitUsdc")
    cycle_interval: Literal["monthly"] = Field(default="monthly", alias="cycleInterval")
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")
