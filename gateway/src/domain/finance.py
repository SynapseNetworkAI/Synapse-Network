from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


"""Finance domain entities — BalanceLedger & FeePolicyEntity.

所有金额字段均使用 float（与现有六位精度 quantize 保持一致），
禁止业务层使用裸 Dict[str, Any] 传递账本或费率数据。
"""


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
    sellers_locked: Dict[str, float] = Field(
        default_factory=dict, alias="sellersLocked"
    )
    sellers_frozen: Dict[str, float] = Field(
        default_factory=dict, alias="sellersFrozen"
    )
    platform: PlatformFees = Field(default_factory=PlatformFees)
    updated_at: str = Field(default="", alias="updatedAt")


class FeePolicyEntity(BaseModel):
    """平台费率策略实体（全局默认 + 按 owner 覆盖）。"""

    model_config = ConfigDict(populate_by_name=True)

    default_rate: float = Field(default=0.0, alias="defaultRate")
    owner_rates: Dict[str, float] = Field(default_factory=dict, alias="ownerRates")
    updated_at: Optional[str] = Field(default=None, alias="updatedAt")
    updated_by: Optional[str] = Field(default=None, alias="updatedBy")


class BalanceRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    owner_address: str = Field(default="", alias="ownerAddress")
    account_type: Literal["buyer", "seller", "platform_fee"] = Field(
        default="buyer", alias="accountType"
    )
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
    status: Literal[
        "REQUESTED", "APPROVED_AUTO", "PENDING_MANUAL_REVIEW", "REJECTED", "COMPLETED"
    ] = "REQUESTED"
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


class UsageLogRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    ts: int
    request_id: Optional[str] = Field(default=None, alias="requestId")
    service_id: Optional[str] = Field(default=None, alias="serviceId")
    buyer_address: Optional[str] = Field(default=None, alias="buyerAddress")
    seller_address: Optional[str] = Field(default=None, alias="sellerAddress")
    status: Optional[str] = None
    unit_price: Optional[Decimal] = Field(default=None, alias="unitPrice")
    protocol_fee: Optional[Decimal] = Field(default=None, alias="protocolFee")
    routing_tax: Optional[Decimal] = Field(default=None, alias="routingTax")
    total_charge: Optional[Decimal] = Field(default=None, alias="totalCharge")
    business_type: Literal[
        "deposit", "charge", "refund", "withdraw", "freeze", "unfreeze"
    ] = Field(default="charge", alias="businessType")
    risk_level: Literal["green", "yellow", "red"] = Field(
        default="green", alias="riskLevel"
    )


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


class UsageAppendBatch(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    rows: List[UsageLogRow] = Field(default_factory=list)
