from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Callable, Dict, List, Literal, Optional

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
    """买家/卖家/平台全局余额账本（由 ledger_accounts + account_balances 聚合）。"""

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
    event_key: Optional[str] = Field(default=None, alias="eventKey")
    confirmations: Optional[int] = None
    credited_amount_usdc: Optional[Decimal] = Field(
        default=None, alias="creditedAmountUsdc"
    )
    confirmed_at: Optional[int] = Field(default=None, alias="confirmedAt")
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")


class DepositAttemptRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: Optional[int] = None
    attempt_id: str = Field(alias="attemptId")
    owner_address: str = Field(alias="ownerAddress")
    client_request_id: Optional[str] = Field(default=None, alias="clientRequestId")
    tx_hash: Optional[str] = Field(default=None, alias="txHash")
    amount_usdc: Decimal = Field(default=Decimal("0"), alias="amountUsdc")
    stage: Literal[
        "SIGN_REQUESTED",
        "TX_BROADCASTED",
        "RECEIPT_FAILED",
        "RECEIPT_CONFIRMED",
        "INTENT_REGISTERED",
    ]
    failure_reason: Optional[str] = Field(default=None, alias="failureReason")
    request_id: Optional[str] = Field(default=None, alias="requestId")
    client_ip: Optional[str] = Field(default=None, alias="clientIp")
    user_agent: Optional[str] = Field(default=None, alias="userAgent")
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
    reason: Optional[str] = None
    signature: Optional[str] = None
    gas_payer: Optional[str] = Field(default=None, alias="gasPayer")
    gas_model: Optional[str] = Field(default=None, alias="gasModel")
    origin_request_id: Optional[str] = Field(default=None, alias="originRequestId")
    origin_tx_hash: Optional[str] = Field(default=None, alias="originTxHash")
    refund_type: Optional[str] = Field(default=None, alias="refundType")
    destination_address: Optional[str] = Field(default=None, alias="destinationAddress")
    evidence_summary: Optional[str] = Field(default=None, alias="evidenceSummary")
    risk_level: Optional[str] = Field(default=None, alias="riskLevel")
    risk_reason_code: Optional[str] = Field(default=None, alias="riskReasonCode")
    message: Optional[str] = None
    request_meta: Dict[str, Any] = Field(default_factory=dict, alias="requestMeta")
    review_decision: Optional[str] = Field(default=None, alias="reviewDecision")
    reviewer_address: Optional[str] = Field(default=None, alias="reviewerAddress")
    reviewer_note: Optional[str] = Field(default=None, alias="reviewerNote")
    reviewed_at: Optional[int] = Field(default=None, alias="reviewedAt")
    completed_at: Optional[int] = Field(default=None, alias="completedAt")
    complete_meta: Dict[str, Any] = Field(default_factory=dict, alias="completeMeta")
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
    business_type: Optional[str] = Field(default=None, alias="businessType")
    risk_level: Optional[str] = Field(default=None, alias="riskLevel")
    request_meta: Dict[str, Any] = Field(default_factory=dict, alias="requestMeta")
    message: Optional[str] = None
    ticket: Dict[str, Any] = Field(default_factory=dict)
    completed_at: Optional[int] = Field(default=None, alias="completedAt")
    complete_meta: Dict[str, Any] = Field(default_factory=dict, alias="completeMeta")
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")


class UsageLogRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    ts: int
    request_id: Optional[str] = Field(default=None, alias="requestId")
    origin_request_id: Optional[str] = Field(default=None, alias="originRequestId")
    origin_tx_hash: Optional[str] = Field(default=None, alias="originTxHash")
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


@dataclass(frozen=True)
class RefundOriginRef:
    request_id: str = ""
    tx_hash: str = ""


@dataclass(frozen=True)
class RefundCreateContext:
    amount_usdc: float
    reason: str
    evidence_summary: str
    origin: RefundOriginRef
    refund_type: str
    destination_address: str
    request_hash: str


@dataclass(frozen=True)
class RefundReviewContext:
    decision: str
    reviewer_address: str
    reviewer_note: str


@dataclass(frozen=True)
class DepositIntentDraft:
    tx_hash: str
    amount_usdc: Decimal
    intent_id: str
    status: str
    created_at: str
    request_hash: str


@dataclass(frozen=True)
class DepositBalanceMove:
    available_before: float
    available_after: float
    pending_before: float
    pending_after: float


@dataclass(frozen=True)
class WithdrawCreateContext:
    amount_usdc: float
    request_hash: str


@dataclass(frozen=True)
class PreparedWithdrawTicket:
    requires_manual_review: bool
    amount_wei: int
    fee_wei: int
    nonce: int
    chain_id: int
    deadline: int
    signature: str
    signer_address: str
    ticket: Dict[str, Any]


@dataclass(frozen=True)
class AtomicWithdrawalResult:
    decision: str
    withdrawal_id: str
    status: str
    amount_usdc: float
    ticket: Dict[str, Any]
    message: str
    risk_reason_code: str
    request_id: str


@dataclass(frozen=True)
class DepositIntentRegisterCommand:
    owner_wallet: str
    tx_hash: str
    request_id: str
    intent_row: DepositIntentRow


@dataclass(frozen=True)
class DepositIntentConfirmCommand:
    owner_wallet: str
    deposit_intent_id: str
    event_key: str
    confirmations: int


@dataclass(frozen=True)
class WithdrawalAtomicRequestCommand:
    seller_address: str
    amount_usdc: Decimal
    request_id: str
    idempotency_key: str
    request_meta: Optional[Dict[str, Any]]
    single_limit_usdc: Decimal
    rolling_24h_limit_usdc: Decimal
    window_seconds: int
    high_risk_override: bool
    sign_ticket_factory: Optional[Callable[[Decimal], PreparedWithdrawTicket]] = None


@dataclass(frozen=True)
class CompleteWithdrawTxCommand:
    owner_wallet: str
    tx_hash: str
    kind: str


@dataclass(frozen=True)
class ChargeBuyerUsageCommand:
    owner_wallet: str
    seller_wallet: str
    total_charge: Decimal
    seller_net: Decimal
    platform_fee_total: Decimal
    usage_row: UsageLogRow


@dataclass(frozen=True)
class ReserveSellerWithdrawCommand:
    owner_wallet: str
    amount_usdc: Decimal
