from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Callable, Dict, List, Literal, Optional

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator

from .execution import (
    CompleteWithdrawTxCommand,
    DepositIntentConfirmCommand,
    DepositIntentRegisterCommand,
    InvocationRecord,
    PreparedWithdrawTicket,
    ReserveProviderWithdrawCommand,
    WithdrawalAtomicRequestCommand,
    WithdrawalDecision,
)
from .ledger import DepositIntentRow, WithdrawalIntentRow
from .operation_metadata import OperationContextMetadata


"""Finance domain entities — BalanceLedger & FeePolicyEntity.

所有金额字段均使用 float（与现有六位精度 quantize 保持一致），
禁止业务层使用裸 Dict[str, Any] 传递账本或费率数据。
"""


class PlatformFees(BaseModel):
    """平台手续费池聚合。"""

    model_config = ConfigDict(populate_by_name=True)

    fee_accrued: float = Field(default=0.0, alias="feeAccrued")


class ConsumerWalletRecord(BaseModel):
    """Owner-scoped consumer wallet aggregate inside the balance ledger."""

    model_config = ConfigDict(populate_by_name=True)

    owner_address: str = Field(
        default="",
        validation_alias=AliasChoices("ownerAddress", "consumerAddress"),
        serialization_alias="ownerAddress",
    )
    available_balance: float = Field(default=0.0, alias="availableBalance")
    pending_balance: float = Field(default=0.0, alias="pendingBalance")
    frozen_balance: float = Field(default=0.0, alias="frozenBalance")
    updated_at: str = Field(default="", alias="updatedAt")


class ProviderWalletRecord(BaseModel):
    """Owner/provider-scoped receivable wallet aggregate inside the balance ledger."""

    model_config = ConfigDict(populate_by_name=True)

    owner_address: str = Field(default="", alias="ownerAddress")
    provider_id: Optional[str] = Field(default=None, alias="providerId")
    available_balance: float = Field(default=0.0, alias="availableBalance")
    pending_balance: float = Field(default=0.0, alias="pendingBalance")
    frozen_balance: float = Field(default=0.0, alias="frozenBalance")
    updated_at: str = Field(default="", alias="updatedAt")


class BalanceLedger(BaseModel):
    """Owner 消费侧 / Provider 供给侧 / 平台费池余额聚合。"""

    model_config = ConfigDict(populate_by_name=True)

    consumer_wallets: List[ConsumerWalletRecord] = Field(
        default_factory=list,
        validation_alias=AliasChoices("consumerWallets", "consumer_wallets"),
        serialization_alias="consumerWallets",
    )
    provider_wallets: List[ProviderWalletRecord] = Field(
        default_factory=list,
        validation_alias=AliasChoices("providerWallets", "provider_wallets"),
        serialization_alias="providerWallets",
    )
    platform: PlatformFees = Field(default_factory=PlatformFees)
    updated_at: str = Field(default="", alias="updatedAt")

    @model_validator(mode="before")
    @classmethod
    def _upgrade_legacy_balance_maps(cls, raw: Any) -> Any:
        if not isinstance(raw, dict):
            return raw

        payload = dict(raw)
        payload.setdefault(
            "consumerWallets",
            cls._consumer_wallets_from_legacy_maps(
                payload.pop("consumerAvailable", {}),
                payload.pop("consumerPending", {}),
                payload.pop("consumerFrozen", {}),
            ),
        )
        payload.setdefault(
            "providerWallets",
            cls._provider_wallets_from_legacy_maps(
                payload.pop("providerReceivable", {}),
                payload.pop("providerLocked", {}),
                payload.pop("providerFrozen", {}),
            ),
        )
        return payload

    @staticmethod
    def _normalize_owner(owner_address: str) -> str:
        return str(owner_address or "").strip().lower()

    @classmethod
    def _consumer_wallets_from_legacy_maps(
        cls,
        available_map: Dict[str, float],
        pending_map: Dict[str, float],
        frozen_map: Dict[str, float],
    ) -> List[ConsumerWalletRecord]:
        owners = {cls._normalize_owner(owner) for owner in available_map}
        owners |= {cls._normalize_owner(owner) for owner in pending_map}
        owners |= {cls._normalize_owner(owner) for owner in frozen_map}
        return [
            ConsumerWalletRecord(
                ownerAddress=owner,
                availableBalance=float(available_map.get(owner, 0.0) or 0.0),
                pendingBalance=float(pending_map.get(owner, 0.0) or 0.0),
                frozenBalance=float(frozen_map.get(owner, 0.0) or 0.0),
            )
            for owner in sorted(owner for owner in owners if owner)
        ]

    @classmethod
    def _provider_wallets_from_legacy_maps(
        cls,
        available_map: Dict[str, float],
        pending_map: Dict[str, float],
        frozen_map: Dict[str, float],
    ) -> List[ProviderWalletRecord]:
        owners = {cls._normalize_owner(owner) for owner in available_map}
        owners |= {cls._normalize_owner(owner) for owner in pending_map}
        owners |= {cls._normalize_owner(owner) for owner in frozen_map}
        return [
            ProviderWalletRecord(
                ownerAddress=owner,
                availableBalance=float(available_map.get(owner, 0.0) or 0.0),
                pendingBalance=float(pending_map.get(owner, 0.0) or 0.0),
                frozenBalance=float(frozen_map.get(owner, 0.0) or 0.0),
            )
            for owner in sorted(owner for owner in owners if owner)
        ]

    def consumer_wallet(self, owner_address: str) -> Optional[ConsumerWalletRecord]:
        owner = self._normalize_owner(owner_address)
        for wallet in self.consumer_wallets:
            if self._normalize_owner(wallet.owner_address) == owner:
                return wallet
        return None

    def ensure_consumer_wallet(self, owner_address: str) -> ConsumerWalletRecord:
        owner = self._normalize_owner(owner_address)
        found = self.consumer_wallet(owner)
        if found is not None:
            return found
        wallet = ConsumerWalletRecord(ownerAddress=owner)
        self.consumer_wallets.append(wallet)
        return wallet

    def provider_wallet(self, owner_address: str) -> Optional[ProviderWalletRecord]:
        owner = self._normalize_owner(owner_address)
        for wallet in self.provider_wallets:
            if self._normalize_owner(wallet.owner_address) == owner:
                return wallet
        return None

    def ensure_provider_wallet(self, owner_address: str) -> ProviderWalletRecord:
        owner = self._normalize_owner(owner_address)
        found = self.provider_wallet(owner)
        if found is not None:
            return found
        wallet = ProviderWalletRecord(ownerAddress=owner)
        self.provider_wallets.append(wallet)
        return wallet

    def consumer_available_balance(self, owner_address: str) -> float:
        wallet = self.consumer_wallet(owner_address)
        return round(float(wallet.available_balance or 0.0), 6) if wallet else 0.0

    def consumer_pending_balance(self, owner_address: str) -> float:
        wallet = self.consumer_wallet(owner_address)
        return round(float(wallet.pending_balance or 0.0), 6) if wallet else 0.0

    def consumer_frozen_balance(self, owner_address: str) -> float:
        wallet = self.consumer_wallet(owner_address)
        return round(float(wallet.frozen_balance or 0.0), 6) if wallet else 0.0

    def provider_receivable_balance(self, owner_address: str) -> float:
        wallet = self.provider_wallet(owner_address)
        return round(float(wallet.available_balance or 0.0), 6) if wallet else 0.0

    def provider_locked_balance(self, owner_address: str) -> float:
        wallet = self.provider_wallet(owner_address)
        return round(float(wallet.pending_balance or 0.0), 6) if wallet else 0.0

    def provider_frozen_balance(self, owner_address: str) -> float:
        wallet = self.provider_wallet(owner_address)
        return round(float(wallet.frozen_balance or 0.0), 6) if wallet else 0.0

    def total_consumer_obligation(self) -> float:
        return round(
            sum(float(wallet.available_balance or 0.0) for wallet in self.consumer_wallets)
            + sum(float(wallet.pending_balance or 0.0) for wallet in self.consumer_wallets),
            6,
        )


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
    account_type: Literal["consumer_wallet", "provider_wallet", "platform_fee"] = Field(
        default="consumer_wallet", alias="accountType"
    )
    available_balance: Decimal = Field(default=Decimal("0"), alias="availableBalance")
    pending_balance: Decimal = Field(default=Decimal("0"), alias="pendingBalance")
    frozen_balance: Decimal = Field(default=Decimal("0"), alias="frozenBalance")
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
    consumer_address: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("consumerAddress"),
        serialization_alias="consumerAddress",
    )
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
    request_meta: OperationContextMetadata = Field(
        default_factory=OperationContextMetadata, alias="requestMeta"
    )
    review_decision: Optional[str] = Field(default=None, alias="reviewDecision")
    reviewer_address: Optional[str] = Field(default=None, alias="reviewerAddress")
    reviewer_note: Optional[str] = Field(default=None, alias="reviewerNote")
    reviewed_at: Optional[int] = Field(default=None, alias="reviewedAt")
    completed_at: Optional[int] = Field(default=None, alias="completedAt")
    complete_meta: OperationContextMetadata = Field(
        default_factory=OperationContextMetadata, alias="completeMeta"
    )
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")

class UsageLogRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    ts: int
    agent_id: Optional[str] = Field(default=None, alias="agentId")
    request_id: Optional[str] = Field(default=None, alias="requestId")
    origin_request_id: Optional[str] = Field(default=None, alias="originRequestId")
    origin_tx_hash: Optional[str] = Field(default=None, alias="originTxHash")
    service_id: Optional[str] = Field(default=None, alias="serviceId")
    consumer_address: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("consumerAddress"),
        serialization_alias="consumerAddress",
    )
    provider_address: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("providerAddress"),
        serialization_alias="providerAddress",
    )
    status: Optional[str] = None
    unit_price: Optional[Decimal] = Field(default=None, alias="unitPrice")
    protocol_fee: Optional[Decimal] = Field(default=None, alias="protocolFee")
    routing_tax: Optional[Decimal] = Field(default=None, alias="routingTax")
    total_charge: Optional[Decimal] = Field(default=None, alias="totalCharge")
    latency_ms: Optional[int] = Field(default=None, alias="latencyMs")
    business_type: Literal[
        "deposit", "charge", "refund", "withdraw", "freeze", "unfreeze"
    ] = Field(default="charge", alias="businessType")
    risk_level: Literal["green", "yellow", "red"] = Field(
        default="green", alias="riskLevel"
    )

class ConsumerChargeResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    consumer_available_balance_after: float = Field(
        validation_alias=AliasChoices("consumerAvailableBalanceAfter"),
        serialization_alias="consumerAvailableBalanceAfter",
    )

UsageChargeResult = ConsumerChargeResult


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
class ChargeConsumerUsageCommand:
    owner_wallet: str
    provider_wallet: str
    total_charge: Decimal
    provider_net: Decimal
    platform_fee_total: Decimal
    usage_row: UsageLogRow
    request_id: str = ""
    unit_price: Decimal = Decimal("0")
    protocol_fee: Decimal = Decimal("0")
    routing_tax: Decimal = Decimal("0")
    invocation: Optional[InvocationRecord] = None


