from __future__ import annotations

from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class DepositDedupRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    tx_hash: str = Field(default="", alias="txHash")
    owner_address: str = Field(default="", alias="ownerAddress")
    request_id: Optional[str] = Field(default=None, alias="requestId")


class WithdrawTxDedupRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    owner_address: str = Field(default="", alias="ownerAddress")
    tx_hash: str = Field(default="", alias="txHash")
    kind: str


class ProcessedDepositEventRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    dedup_key: str = Field(alias="dedupKey")
    updated_at: str = Field(default="", alias="updatedAt")


class PlatformFeePolicyDefaultRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    singleton_id: int = Field(default=1, alias="singletonId")
    default_rate: Decimal = Field(default=Decimal("0"), alias="defaultRate")
    updated_at: Optional[str] = Field(default=None, alias="updatedAt")
    updated_by: Optional[str] = Field(default=None, alias="updatedBy")


class PlatformFeePolicyOwnerRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    owner_address: str = Field(alias="ownerAddress")
    fee_rate: Decimal = Field(default=Decimal("0"), alias="feeRate")
