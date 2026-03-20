from __future__ import annotations

from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from .operation_metadata import OperationContextMetadata, WithdrawalTicketMetadata


class RuntimeStateRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    state_key: str = Field(alias="stateKey")
    updated_at: str = Field(default="", alias="updatedAt")


class WalletRoleState(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    wallet_address: str = Field(alias="walletAddress")
    role: str
    updated_at: str = Field(default="", alias="updatedAt")


class AuthSessionState(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    wallet_address: str = Field(alias="walletAddress")
    registered_at: int = Field(default=0, alias="registeredAt")
    last_login: int = Field(default=0, alias="lastLogin")
    status: str
    updated_at: str = Field(default="", alias="updatedAt")


class CredentialMetadataState(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    credential_type: str = Field(alias="credentialType")
    owner_address: str = Field(alias="ownerAddress")
    name: Optional[str] = None
    max_calls: Optional[int] = Field(default=None, alias="maxCalls")
    calls_used: Optional[int] = Field(default=None, alias="callsUsed")
    reset_interval: Optional[str] = Field(default=None, alias="resetInterval")
    expiration: Optional[int] = None
    created_at: Optional[str] = Field(default=None, alias="createdAt")
    updated_at: Optional[str] = Field(default=None, alias="updatedAt")


class ServiceManifestMetadataState(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    record_id: Optional[str] = Field(default=None, alias="recordId")
    schema_version: Optional[int] = Field(default=None, alias="schemaVersion")
    role: Optional[str] = None
    address: Optional[str] = None
    auth: dict[str, Any] = Field(default_factory=dict)
    health_check: dict[str, Any] = Field(default_factory=dict, alias="healthCheck")
    forwarding: dict[str, Any] = Field(default_factory=dict)
    metering: dict[str, Any] = Field(default_factory=dict)
    invoke: dict[str, Any] = Field(default_factory=dict)
    max_qps: Optional[int] = Field(default=None, alias="maxQps")
    max_request_bytes: Optional[int] = Field(default=None, alias="maxRequestBytes")
    max_response_bytes: Optional[int] = Field(default=None, alias="maxResponseBytes")
    created_at: Optional[str] = Field(default=None, alias="createdAt")
    updated_at: Optional[str] = Field(default=None, alias="updatedAt")


class ServiceHealthMetadataState(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    owner_address: Optional[str] = Field(default=None, alias="ownerAddress")
    weight: Optional[int] = None
    region: Optional[str] = None
    status: Optional[str] = None
    overall_status: Optional[str] = Field(default=None, alias="overallStatus")
    http_status: Optional[int] = Field(default=None, alias="httpStatus")
    consecutive_successes: int = Field(default=0, alias="consecutiveSuccesses")
    consecutive_failures: int = Field(default=0, alias="consecutiveFailures")
    probe_url: Optional[str] = Field(default=None, alias="probeUrl")
    last_checked_at: Optional[int] = Field(default=None, alias="lastCheckedAt")
    last_healthy_at: Optional[int] = Field(default=None, alias="lastHealthyAt")
    error: Optional[str] = None


class ServiceHealthHistoryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    service_id: str = Field(alias="serviceId")
    owner_address: Optional[str] = Field(default=None, alias="ownerAddress")
    target_url: str = Field(alias="targetUrl")
    status: Optional[str] = None
    http_status: Optional[int] = Field(default=None, alias="httpStatus")
    latency_ms: Optional[int] = Field(default=None, alias="latencyMs")
    probe_url: Optional[str] = Field(default=None, alias="probeUrl")
    consecutive_successes: int = Field(default=0, alias="consecutiveSuccesses")
    consecutive_failures: int = Field(default=0, alias="consecutiveFailures")
    checked_at: int = Field(default=0, alias="checkedAt")
    last_healthy_at: Optional[int] = Field(default=None, alias="lastHealthyAt")
    error: Optional[str] = None


class ServiceHealthHistoryState(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    rows: list[ServiceHealthHistoryItem] = Field(default_factory=list)


class DepositMetadataState(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    consumer_address: Optional[str] = Field(default=None, alias="consumerAddress")
    idempotency_key: Optional[str] = Field(default=None, alias="idempotencyKey")


class InvocationBillingState(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    owner_address: str = Field(default="", alias="ownerAddress")
    provider_address: str = Field(default="", alias="providerAddress")
    agent_id: Optional[str] = Field(default=None, alias="agentId")
    request_id: Optional[str] = Field(default=None, alias="requestId")
    origin_request_id: Optional[str] = Field(default=None, alias="originRequestId")
    origin_tx_hash: Optional[str] = Field(default=None, alias="originTxHash")
    unit_price: Decimal = Field(default=Decimal("0"), alias="unitPrice")
    protocol_fee: Decimal = Field(default=Decimal("0"), alias="protocolFee")
    routing_tax: Decimal = Field(default=Decimal("0"), alias="routingTax")
    total_charge: Decimal = Field(default=Decimal("0"), alias="totalCharge")
    latency_ms: Optional[int] = Field(default=None, alias="latencyMs")
    business_type: str = Field(default="charge", alias="businessType")
    risk_level: str = Field(default="green", alias="riskLevel")


class VaultWithdrawalMetadataState(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    flow_status: str = Field(default="REQUESTED", alias="flowStatus")
    business_type: str = Field(default="withdraw", alias="businessType")
    request_id: Optional[str] = Field(default=None, alias="requestId")
    idempotency_key: Optional[str] = Field(default=None, alias="idempotencyKey")
    consumer_address: Optional[str] = Field(default=None, alias="consumerAddress")
    provider_address: Optional[str] = Field(default=None, alias="providerAddress")
    amount_wei: Optional[str] = Field(default=None, alias="amountWei")
    fee_wei: Optional[str] = Field(default=None, alias="feeWei")
    chain_id: Optional[int] = Field(default=None, alias="chainId")
    contract_address: Optional[str] = Field(default=None, alias="contractAddress")
    signer_address: Optional[str] = Field(default=None, alias="signerAddress")
    risk_level: Optional[str] = Field(default=None, alias="riskLevel")
    risk_reason_code: Optional[str] = Field(default=None, alias="riskReasonCode")
    gas_payer: Optional[str] = Field(default=None, alias="gasPayer")
    gas_model: Optional[str] = Field(default=None, alias="gasModel")
    reason: Optional[str] = None
    refund_type: Optional[str] = Field(default=None, alias="refundType")
    destination_address: Optional[str] = Field(default=None, alias="destinationAddress")
    evidence_summary: Optional[str] = Field(default=None, alias="evidenceSummary")
    origin_request_id: Optional[str] = Field(default=None, alias="originRequestId")
    origin_tx_hash: Optional[str] = Field(default=None, alias="originTxHash")
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
    ticket: WithdrawalTicketMetadata = Field(default_factory=WithdrawalTicketMetadata)


class RouterPolicyState(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    owner_address: str = Field(alias="ownerAddress")
    daily_limit_usdc: Decimal = Field(default=Decimal("0"), alias="dailyLimitUsdc")
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")


class BackfillState(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    last_scanned_block: int = Field(default=0, alias="lastScannedBlock")
    last_scan_at: Optional[int] = Field(default=None, alias="lastScanAt")


class ReconciliationState(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    last_check_at: Optional[int] = Field(default=None, alias="lastCheckAt")
    chain_vault_usdc: Decimal = Field(default=Decimal("0"), alias="chainVaultUsdc")
    ledger_obligation_usdc: Decimal = Field(default=Decimal("0"), alias="ledgerObligationUsdc")
    delta_usdc: Decimal = Field(default=Decimal("0"), alias="deltaUsdc")
    alert: bool = False