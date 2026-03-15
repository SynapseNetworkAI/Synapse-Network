from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class BalanceRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    owner_address: str = Field(default="", alias="ownerAddress")
    account_type: Literal["buyer", "seller", "platform_fee"] = Field(default="buyer", alias="accountType")
    available_balance: Decimal = Field(default=Decimal("0"), alias="availableBalance")
    pending_balance: Decimal = Field(default=Decimal("0"), alias="pendingBalance")
    frozen_balance: Decimal = Field(default=Decimal("0"), alias="frozenBalance")
    updated_at: str = Field(default="", alias="updatedAt")


class DepositIntentRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    owner_address: str = Field(alias="ownerAddress")
    tx_hash: str = Field(alias="txHash")
    request_id: Optional[str] = Field(default=None, alias="requestId")
    buyer_address: Optional[str] = Field(default=None, alias="buyerAddress")
    amount_usdc: Decimal = Field(default=Decimal("0"), alias="amountUsdc")
    idempotency_key: Optional[str] = Field(default=None, alias="idempotencyKey")
    status: str = "PENDING_CONFIRMATION"
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")


class RefundIntentRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    owner_address: str = Field(alias="ownerAddress")
    tx_hash: Optional[str] = Field(default=None, alias="txHash")
    status: str = "REQUESTED"
    request_id: Optional[str] = Field(default=None, alias="requestId")
    buyer_address: Optional[str] = Field(default=None, alias="buyerAddress")
    amount_usdc: Decimal = Field(default=Decimal("0"), alias="amountUsdc")
    idempotency_key: Optional[str] = Field(default=None, alias="idempotencyKey")
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")


class WithdrawalIntentRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    owner_address: str = Field(alias="ownerAddress")
    tx_hash: Optional[str] = Field(default=None, alias="txHash")
    status: Literal["REQUESTED", "APPROVED_AUTO", "PENDING_MANUAL_REVIEW", "REJECTED", "COMPLETED"] = "REQUESTED"
    request_id: Optional[str] = Field(default=None, alias="requestId")
    idempotency_key: Optional[str] = Field(default=None, alias="idempotencyKey")
    amount_usdc: Decimal = Field(default=Decimal("0"), alias="amountUsdc")
    amount_wei: Optional[str] = Field(default=None, alias="amountWei")
    fee_wei: Optional[str] = Field(default=None, alias="feeWei")
    nonce: Optional[int] = None
    deadline: Optional[int] = None
    signature: Optional[str] = None
    chain_id: Optional[int] = Field(default=None, alias="chainId")
    contract_address: Optional[str] = Field(default=None, alias="contractAddress")
    signer_address: Optional[str] = Field(default=None, alias="signerAddress")
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")


class WithdrawalDecision(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    decision: Literal["green", "yellow", "red"]
    withdrawal_id: str = Field(alias="withdrawalId")
    status: str
    amount_usdc: Optional[float] = Field(default=None, alias="amountUsdc")
    risk_reason_code: Optional[str] = Field(default=None, alias="riskReasonCode")
    ticket: Dict[str, Any] = Field(default_factory=dict)
    message: str = ""


class BuyerChargeResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    buyer_balance_after: float = Field(alias="buyerBalanceAfter")


class BalanceMutationResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    before_balance: float = Field(alias="beforeBalance")
    after_balance: float = Field(alias="afterBalance")
