from pydantic import BaseModel, ConfigDict, Field


class ProviderWithdrawReviewSummary(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    withdrawal_id: str = Field(alias="withdrawalId")
    owner_address: str = Field(alias="ownerAddress")
    amount_usdc: str = Field(alias="amountUsdc")
    status: str
    request_id: str | None = Field(default=None, alias="requestId")
    tx_hash: str | None = Field(default=None, alias="txHash")
    risk_level: str | None = Field(default=None, alias="riskLevel")
    risk_reason_code: str | None = Field(default=None, alias="riskReasonCode")
    evidence_summary: str | None = Field(default=None, alias="evidenceSummary")
    message: str | None = None
    created_at: str | None = Field(default=None, alias="createdAt")
    updated_at: str | None = Field(default=None, alias="updatedAt")


class ProviderWithdrawReviewListResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    items: list[ProviderWithdrawReviewSummary]
    next_cursor: str | None = Field(default=None, alias="nextCursor")


class ProviderWithdrawReviewDecisionRequest(BaseModel):
    decision: str = Field(min_length=7, max_length=16)
    note: str = Field(default="", max_length=512)


class ProviderWithdrawReviewDecisionResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    withdrawal_id: str = Field(alias="withdrawalId")
    owner_address: str = Field(alias="ownerAddress")
    review_decision: str = Field(alias="reviewDecision")
    status: str
    message: str | None = None
    requested_by: str | None = Field(default=None, alias="requestedBy")
    ticket: dict = Field(default_factory=dict)