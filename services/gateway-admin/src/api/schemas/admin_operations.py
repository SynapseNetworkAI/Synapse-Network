from pydantic import BaseModel, ConfigDict, Field


class PaginationSchema(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    page: int
    page_size: int = Field(alias="pageSize")
    total: int
    total_pages: int = Field(alias="totalPages")
    has_next_page: bool = Field(alias="hasNextPage")
    has_previous_page: bool = Field(alias="hasPreviousPage")


class OwnerAccountItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    owner_id: str = Field(alias="ownerId")
    owner_wallet: str = Field(alias="ownerWallet")
    account_name: str | None = Field(alias="accountName")
    email: str | None
    email_verified: bool = Field(alias="emailVerified")
    pending_email: str | None = Field(alias="pendingEmail")
    status: str
    roles: list[str]
    agent_count: int = Field(alias="agentCount")
    provider_service_count: int = Field(alias="providerServiceCount")
    support_case_count: int = Field(alias="supportCaseCount")
    created_at: str | None = Field(alias="createdAt")
    updated_at: str | None = Field(alias="updatedAt")
    last_active_at: str | None = Field(alias="lastActiveAt")


class BalanceSummarySchema(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    consumer_available_usdc: str = Field(alias="consumerAvailableUsdc")
    consumer_frozen_usdc: str = Field(alias="consumerFrozenUsdc")
    provider_available_usdc: str = Field(alias="providerAvailableUsdc")
    provider_frozen_usdc: str = Field(alias="providerFrozenUsdc")


class ConsumerDepositItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    deposit_id: str = Field(alias="depositId")
    owner_id: str = Field(alias="ownerId")
    owner_wallet: str = Field(alias="ownerWallet")
    owner_email: str | None = Field(alias="ownerEmail")
    tx_hash: str = Field(alias="txHash")
    amount_usdc: str = Field(alias="amountUsdc")
    network: str | None
    status: str
    confirmations: int | None
    credited_at: str | None = Field(alias="creditedAt")
    created_at: str | None = Field(alias="createdAt")
    updated_at: str | None = Field(alias="updatedAt")


class ProviderWithdrawalItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    withdrawal_id: str = Field(alias="withdrawalId")
    provider_id: str | None = Field(alias="providerId")
    provider_name: str | None = Field(alias="providerName")
    owner_id: str = Field(alias="ownerId")
    owner_wallet: str = Field(alias="ownerWallet")
    owner_email: str | None = Field(alias="ownerEmail")
    amount_usdc: str = Field(alias="amountUsdc")
    fee_usdc: str | None = Field(alias="feeUsdc")
    status: str
    tx_hash: str | None = Field(alias="txHash")
    ticket_id: str | None = Field(alias="ticketId")
    request_id: str | None = Field(alias="requestId")
    review_decision: str | None = Field(alias="reviewDecision")
    funds_state: str = Field(alias="fundsState")
    created_at: str | None = Field(alias="createdAt")
    updated_at: str | None = Field(alias="updatedAt")


class OwnerAccountListResponse(BaseModel):
    items: list[OwnerAccountItem]
    pagination: PaginationSchema


class OwnerAccountDetailResponse(BaseModel):
    account: OwnerAccountItem
    balances: BalanceSummarySchema
    recent_deposits: list[ConsumerDepositItem] = Field(alias="recentDeposits")
    recent_provider_withdrawals: list[ProviderWithdrawalItem] = Field(alias="recentProviderWithdrawals")
    recent_invocations: list[dict] = Field(alias="recentInvocations")
    support_cases: list[dict] = Field(alias="supportCases")


class ConsumerDepositListResponse(BaseModel):
    items: list[ConsumerDepositItem]
    pagination: PaginationSchema


class ConsumerDepositDetailResponse(BaseModel):
    deposit: ConsumerDepositItem
    ledger_entries: list[dict] = Field(alias="ledgerEntries")
    audit_events: list[dict] = Field(alias="auditEvents")
    notification_events: list[dict] = Field(alias="notificationEvents")


class ProviderWithdrawalListResponse(BaseModel):
    items: list[ProviderWithdrawalItem]
    pagination: PaginationSchema


class ProviderWithdrawalDetailResponse(BaseModel):
    withdrawal: ProviderWithdrawalItem
    ledger_entries: list[dict] = Field(alias="ledgerEntries")
    audit_events: list[dict] = Field(alias="auditEvents")
    notification_events: list[dict] = Field(alias="notificationEvents")
    review_history: list[dict] = Field(alias="reviewHistory")
