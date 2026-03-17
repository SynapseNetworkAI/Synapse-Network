from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class LedgerAccountRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    account_id: str = Field(alias="accountId")
    account_kind: Literal["owner_vault", "seller_receivable", "platform_revenue", "budget_hold"] = Field(alias="accountKind")
    owner_id: Optional[str] = Field(default=None, alias="ownerId")
    seller_id: Optional[str] = Field(default=None, alias="sellerId")
    currency: str = "USDC"
    status: Literal["active", "paused", "closed"] = "active"
    created_at: str = Field(default="", alias="createdAt")
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
    request_meta: dict[str, Any] = Field(default_factory=dict, alias="requestMeta")
    message: Optional[str] = None
    ticket: dict[str, Any] = Field(default_factory=dict)
    completed_at: Optional[int] = Field(default=None, alias="completedAt")
    complete_meta: dict[str, Any] = Field(default_factory=dict, alias="completeMeta")
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")


class AccountBalanceRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    account_id: str = Field(alias="accountId")
    available_balance: Decimal = Field(default=Decimal("0"), alias="availableBalance")
    pending_balance: Decimal = Field(default=Decimal("0"), alias="pendingBalance")
    frozen_balance: Decimal = Field(default=Decimal("0"), alias="frozenBalance")
    updated_at: str = Field(default="", alias="updatedAt")


class LedgerEntryRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    entry_id: str = Field(alias="entryId")
    reference_type: str = Field(alias="referenceType")
    reference_id: str = Field(alias="referenceId")
    business_type: str = Field(alias="businessType")
    debit_account_id: str = Field(alias="debitAccountId")
    credit_account_id: str = Field(alias="creditAccountId")
    amount_usdc: Decimal = Field(alias="amountUsdc")
    status: Literal["pending", "posted", "reversed"] = "posted"
    request_id: Optional[str] = Field(default=None, alias="requestId")
    trace_id: Optional[str] = Field(default=None, alias="traceId")
    created_at: str = Field(default="", alias="createdAt")


class VaultDepositRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    deposit_id: str = Field(alias="depositId")
    owner_id: str = Field(alias="ownerId")
    tx_hash: str = Field(alias="txHash")
    amount_usdc: Decimal = Field(alias="amountUsdc")
    status: Literal["PENDING_CONFIRMATION", "CONFIRMED", "FAILED"] = "PENDING_CONFIRMATION"
    block_number: Optional[int] = Field(default=None, alias="blockNumber")
    request_id: Optional[str] = Field(default=None, alias="requestId")
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")


class VaultWithdrawalRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    withdrawal_id: str = Field(alias="withdrawalId")
    owner_id: str = Field(alias="ownerId")
    tx_hash: Optional[str] = Field(default=None, alias="txHash")
    amount_usdc: Decimal = Field(alias="amountUsdc")
    status: Literal["REQUESTED", "SIGNED", "BROADCASTED", "CONFIRMED", "FAILED"] = "REQUESTED"
    request_id: Optional[str] = Field(default=None, alias="requestId")
    signature: Optional[str] = None
    nonce: Optional[int] = None
    deadline: Optional[int] = None
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")


class PlatformRevenueRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    fee_accrued: Decimal = Field(default=Decimal("0"), alias="feeAccrued")


class BalanceLedgerRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    buyer_accounts: dict[str, AccountBalanceRecord] = Field(default_factory=dict, alias="buyerAccounts")
    seller_accounts: dict[str, AccountBalanceRecord] = Field(default_factory=dict, alias="sellerAccounts")
    platform_revenue: PlatformRevenueRecord = Field(default_factory=PlatformRevenueRecord, alias="platformRevenue")
    updated_at: str = Field(default="", alias="updatedAt")