from typing import Literal

from pydantic import BaseModel, Field

RegistryStatus = Literal["ok", "warning", "critical"]


class ContractRegistryNetwork(BaseModel):
    env: Literal["prod", "staging", "local"]
    chain_id: int = Field(alias="chainId", serialization_alias="chainId")
    chain_name: str = Field(alias="chainName", serialization_alias="chainName")
    explorer_base_url: str = Field(alias="explorerBaseUrl", serialization_alias="explorerBaseUrl")
    latest_block: int | None = Field(alias="latestBlock", serialization_alias="latestBlock")
    rpc_status: Literal["healthy", "degraded"] = Field(alias="rpcStatus", serialization_alias="rpcStatus")
    checked_at: str = Field(alias="checkedAt", serialization_alias="checkedAt")


class ContractRegistryContract(BaseModel):
    key: Literal["synapseCore", "usdc"]
    label: str
    address: str
    expected_address: str | None = Field(default=None, alias="expectedAddress", serialization_alias="expectedAddress")
    explorer_url: str = Field(alias="explorerUrl", serialization_alias="explorerUrl")
    status: RegistryStatus


class ContractRegistryRole(BaseModel):
    key: str
    label: str
    address: str
    purpose: str
    source: Literal["env", "terraform", "safe", "kms", "manual"]
    explorer_url: str = Field(alias="explorerUrl", serialization_alias="explorerUrl")
    native_balance: str = Field(alias="nativeBalance", serialization_alias="nativeBalance")
    usdc_balance: str = Field(alias="usdcBalance", serialization_alias="usdcBalance")
    status: RegistryStatus


class ContractRegistryCheck(BaseModel):
    key: Literal["owner", "platformSigner", "usdc"]
    label: str
    expected: str
    actual: str
    status: Literal["ok", "critical"]


class ContractRegistryBalances(BaseModel):
    vault_usdc: str = Field(alias="vaultUsdc", serialization_alias="vaultUsdc")
    vault_native: str = Field(alias="vaultNative", serialization_alias="vaultNative")
    treasury_safe_usdc: str = Field(alias="treasurySafeUsdc", serialization_alias="treasurySafeUsdc")
    treasury_safe_native: str = Field(alias="treasurySafeNative", serialization_alias="treasurySafeNative")
    platform_fee_pool_usdc: str = Field(alias="platformFeePoolUsdc", serialization_alias="platformFeePoolUsdc")
    ledger_platform_fee_usdc: str = Field(alias="ledgerPlatformFeeUsdc", serialization_alias="ledgerPlatformFeeUsdc")
    ledger_obligation_usdc: str | None = Field(alias="ledgerObligationUsdc", serialization_alias="ledgerObligationUsdc")
    vault_ledger_delta_usdc: str | None = Field(alias="vaultLedgerDeltaUsdc", serialization_alias="vaultLedgerDeltaUsdc")


class ContractRegistryFeeSummary(BaseModel):
    today_platform_fee_usdc: str = Field(alias="todayPlatformFeeUsdc", serialization_alias="todayPlatformFeeUsdc")
    seven_day_platform_fee_usdc: str = Field(alias="sevenDayPlatformFeeUsdc", serialization_alias="sevenDayPlatformFeeUsdc")
    thirty_day_platform_fee_usdc: str = Field(alias="thirtyDayPlatformFeeUsdc", serialization_alias="thirtyDayPlatformFeeUsdc")


class ContractAddressRegistry(BaseModel):
    network: ContractRegistryNetwork
    contracts: list[ContractRegistryContract]
    roles: list[ContractRegistryRole]
    contract_checks: list[ContractRegistryCheck] = Field(alias="contractChecks", serialization_alias="contractChecks")
    balances: ContractRegistryBalances
    fee_summary: ContractRegistryFeeSummary = Field(alias="feeSummary", serialization_alias="feeSummary")
