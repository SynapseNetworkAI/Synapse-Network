from pydantic import BaseModel, ConfigDict, Field


class PlatformFeeTreasuryDraftRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    amount_usdc: str = Field(alias="amountUsdc", min_length=1, max_length=64)
    reason: str = Field(min_length=3, max_length=512)
    request_id: str | None = Field(default=None, alias="requestId", max_length=128)


class SafeTransactionDraftResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    to: str
    value: str
    data: str
    operation: int


class PlatformFeeTreasuryDraftResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    status: str
    request_id: str = Field(alias="requestId")
    amount_usdc: str = Field(alias="amountUsdc")
    amount_atomic: str = Field(alias="amountAtomic")
    safe_address: str = Field(alias="safeAddress")
    ledger_signer_address: str = Field(alias="ledgerSignerAddress")
    synapse_core_address: str = Field(alias="synapseCoreAddress")
    selector: str
    calldata_hash: str = Field(alias="calldataHash")
    platform_fee_pool_atomic: str = Field(alias="platformFeePoolAtomic")
    safe_tx: SafeTransactionDraftResponse = Field(alias="safeTx")
