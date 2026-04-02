from __future__ import annotations

from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


"""Gateway domain entities — OwnerSpendLimitRow."""


class OwnerSpendLimitRow(BaseModel):
    """Owner account billing-cycle spend limit entity."""

    model_config = ConfigDict(populate_by_name=True)

    id: Optional[str] = None
    owner_address: str = Field(default="", alias="ownerAddress")
    spending_limit_usdc: Optional[Decimal] = Field(default=None, alias="spendingLimitUsdc")
    cycle_interval: Literal["monthly"] = Field(default="monthly", alias="cycleInterval")
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")
