"""Finance domain entities — BalanceLedger & FeePolicyEntity.

所有金额字段均使用 float（与现有六位精度 quantize 保持一致），
禁止业务层使用裸 Dict[str, Any] 传递账本或费率数据。
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from pydantic import BaseModel, ConfigDict, Field


class PlatformFees(BaseModel):
    """平台手续费池聚合。"""
    model_config = ConfigDict(populate_by_name=True)

    fee_accrued: float = Field(default=0.0, alias="feeAccrued")


class BalanceLedger(BaseModel):
    """买家/卖家/平台全局余额账本（对应 synapse_balances 聚合视图）。"""
    model_config = ConfigDict(populate_by_name=True)

    buyers: Dict[str, float] = Field(default_factory=dict)
    buyers_locked: Dict[str, float] = Field(default_factory=dict, alias="buyersLocked")
    buyers_frozen: Dict[str, float] = Field(default_factory=dict, alias="buyersFrozen")
    sellers: Dict[str, float] = Field(default_factory=dict)
    sellers_locked: Dict[str, float] = Field(default_factory=dict, alias="sellersLocked")
    sellers_frozen: Dict[str, float] = Field(default_factory=dict, alias="sellersFrozen")
    platform: PlatformFees = Field(default_factory=PlatformFees)
    updated_at: str = Field(default="", alias="updatedAt")


class FeePolicyEntity(BaseModel):
    """平台费率策略实体（全局默认 + 按 owner 覆盖）。"""
    model_config = ConfigDict(populate_by_name=True)

    default_rate: float = Field(default=0.0, alias="defaultRate")
    owner_rates: Dict[str, float] = Field(default_factory=dict, alias="ownerRates")
    updated_at: Optional[str] = Field(default=None, alias="updatedAt")
    updated_by: Optional[str] = Field(default=None, alias="updatedBy")
