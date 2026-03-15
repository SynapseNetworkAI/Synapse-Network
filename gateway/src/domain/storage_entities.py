from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class AuditLogRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: Optional[int] = None
    action_type: str = Field(default="", alias="actionType")
    business_type: Literal["deposit", "charge", "refund", "withdraw", "freeze", "unfreeze"] = Field(
        default="charge", alias="businessType"
    )
    risk_level: Literal["green", "yellow", "red"] = Field(default="green", alias="riskLevel")
    owner_address: str = Field(default="", alias="ownerAddress")
    actor: Optional[str] = None
    request_id: Optional[str] = Field(default=None, alias="requestId")
    trace_id: Optional[str] = Field(default=None, alias="traceId")
    tx_hash: Optional[str] = Field(default=None, alias="txHash")
    counterparty_address: Optional[str] = Field(default=None, alias="counterpartyAddress")
    direction: Optional[str] = None
    status: Optional[str] = None
    risk_reason_code: Optional[str] = Field(default=None, alias="riskReasonCode")
    ledger_id: Optional[str] = Field(default=None, alias="ledgerId")
    client_ip: Optional[str] = Field(default=None, alias="clientIp")
    user_agent: Optional[str] = Field(default=None, alias="userAgent")
    amount_delta: Optional[Decimal] = Field(default=None, alias="amountDelta")
    before_balance: Optional[Decimal] = Field(default=None, alias="beforeBalance")
    after_balance: Optional[Decimal] = Field(default=None, alias="afterBalance")
    result_status: Optional[str] = Field(default=None, alias="resultStatus")
    error_code: Optional[str] = Field(default=None, alias="errorCode")
    message: Optional[str] = None
    created_at: Optional[int] = Field(default=None, alias="createdAt")


class SystemAuditLogRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: Optional[int] = None
    action_type: str = Field(default="", alias="actionType")
    owner_address: str = Field(default="", alias="ownerAddress")
    actor: Optional[str] = None
    request_id: Optional[str] = Field(default=None, alias="requestId")
    trace_id: Optional[str] = Field(default=None, alias="traceId")
    resource_type: Optional[str] = Field(default=None, alias="resourceType")
    resource_id: Optional[str] = Field(default=None, alias="resourceId")
    result_status: Optional[str] = Field(default=None, alias="resultStatus")
    error_code: Optional[str] = Field(default=None, alias="errorCode")
    ip_address: Optional[str] = Field(default=None, alias="ipAddress")
    user_agent: Optional[str] = Field(default=None, alias="userAgent")
    detail_json: Dict[str, Any] = Field(default_factory=dict, alias="detailJson")
    created_at: Optional[int] = Field(default=None, alias="createdAt")


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


class BalanceRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    owner_address: str = Field(default="", alias="ownerAddress")
    account_type: Literal["buyer", "seller", "platform_fee"] = Field(default="buyer", alias="accountType")
    available_balance: Decimal = Field(default=Decimal("0"), alias="availableBalance")
    pending_balance: Decimal = Field(default=Decimal("0"), alias="pendingBalance")
    frozen_balance: Decimal = Field(default=Decimal("0"), alias="frozenBalance")
    updated_at: int = Field(default=0, alias="updatedAt")


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
    created_at: int = Field(default=0, alias="createdAt")
    updated_at: int = Field(default=0, alias="updatedAt")


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
    created_at: int = Field(default=0, alias="createdAt")
    updated_at: int = Field(default=0, alias="updatedAt")


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
    created_at: int = Field(default=0, alias="createdAt")
    updated_at: int = Field(default=0, alias="updatedAt")


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
    business_type: Literal["deposit", "charge", "refund", "withdraw", "freeze", "unfreeze"] = Field(
        default="charge", alias="businessType"
    )
    risk_level: Literal["green", "yellow", "red"] = Field(default="green", alias="riskLevel")


class ProcessedDepositEventRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    dedup_key: str = Field(alias="dedupKey")
    updated_at: int = Field(default=0, alias="updatedAt")


class ServiceRegistryRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    service_id: str = Field(alias="serviceId")
    owner_address: str = Field(alias="ownerAddress")
    service_name: str = Field(default="", alias="serviceName")
    summary: Optional[str] = None
    endpoint: Optional[str] = None
    status: str = "active"
    is_active: bool = Field(default=True, alias="isActive")
    pricing_amount: Decimal = Field(default=Decimal("0"), alias="pricingAmount")
    pricing_currency: str = Field(default="USDC", alias="pricingCurrency")
    timeout_ms: Optional[int] = Field(default=None, alias="timeoutMs")
    max_qps: Optional[int] = Field(default=None, alias="maxQps")
    max_request_bytes: Optional[int] = Field(default=None, alias="maxRequestBytes")
    max_response_bytes: Optional[int] = Field(default=None, alias="maxResponseBytes")
    created_at: int = Field(default=0, alias="createdAt")
    updated_at: int = Field(default=0, alias="updatedAt")


class CredentialRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    credential_type: str = Field(alias="credentialType")
    owner_address: str = Field(alias="ownerAddress")
    name: Optional[str] = None
    token_hash: Optional[str] = Field(default=None, alias="tokenHash")
    token_prefix: Optional[str] = Field(default=None, alias="tokenPrefix")
    status: Optional[str] = None
    max_calls: Optional[int] = Field(default=None, alias="maxCalls")
    calls_used: Optional[int] = Field(default=None, alias="callsUsed")
    rpm: Optional[int] = None
    credit_limit: Optional[Decimal] = Field(default=None, alias="creditLimit")
    reset_interval: Optional[str] = Field(default=None, alias="resetInterval")
    expiration: Optional[int] = None
    expires_at: Optional[int] = Field(default=None, alias="expiresAt")
    created_at: Optional[int] = Field(default=None, alias="createdAt")
    updated_at: Optional[int] = Field(default=None, alias="updatedAt")
    revoked_at: Optional[int] = Field(default=None, alias="revokedAt")


class WalletRoleRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    wallet_address: str = Field(alias="walletAddress")
    role: str
    updated_at: int = Field(default=0, alias="updatedAt")


class AuthSessionRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    wallet_address: str = Field(alias="walletAddress")
    registered_at: int = Field(default=0, alias="registeredAt")
    last_login: int = Field(default=0, alias="lastLogin")
    status: str
    updated_at: int = Field(default=0, alias="updatedAt")


class PlatformFeePolicyDefaultRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    singleton_id: int = Field(default=1, alias="singletonId")
    default_rate: Decimal = Field(default=Decimal("0"), alias="defaultRate")
    updated_at: Optional[int] = Field(default=None, alias="updatedAt")
    updated_by: Optional[str] = Field(default=None, alias="updatedBy")


class PlatformFeePolicyOwnerRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    owner_address: str = Field(alias="ownerAddress")
    fee_rate: Decimal = Field(default=Decimal("0"), alias="feeRate")


class IdempotencyKeyRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    scope: str
    owner_address: str = Field(alias="ownerAddress")
    idempotency_key: str = Field(alias="idempotencyKey")
    request_hash: str = Field(alias="requestHash")
    response_code: Optional[str] = Field(default=None, alias="responseCode")
    response_digest: Optional[str] = Field(default=None, alias="responseDigest")
    created_at: int = Field(default=0, alias="createdAt")
    expires_at: int = Field(default=0, alias="expiresAt")


class FinanceRateLimitRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    owner_address: str = Field(alias="ownerAddress")
    action: str
    window_start: int = Field(default=0, alias="windowStart")
    count: int = 0
    updated_at: int = Field(default=0, alias="updatedAt")


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
