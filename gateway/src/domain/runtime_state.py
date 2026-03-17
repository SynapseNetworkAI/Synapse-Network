from __future__ import annotations

from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


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

    buyer_address: Optional[str] = Field(default=None, alias="buyerAddress")
    idempotency_key: Optional[str] = Field(default=None, alias="idempotencyKey")


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