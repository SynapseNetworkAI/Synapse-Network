from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from src.domain.provider_llm_config import (
    LlmConfigSnapshot,
    LlmRolloutRequest,
)


class LlmVendorConfigResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    provider_code: str = Field(alias="providerCode")
    display_name: str = Field(alias="displayName")
    base_url: str = Field(alias="baseUrl")
    api_docs_url: str = Field(alias="apiDocsUrl")
    pricing_url: str = Field(alias="pricingUrl")
    environments: list[str]
    default_timeout_s: int = Field(alias="defaultTimeoutS")
    default_qps: int = Field(alias="defaultQps")
    secret_reference: str = Field(alias="secretReference")
    secret_present: bool = Field(alias="secretPresent")
    secret_last_rotated_at: str | None = Field(alias="secretLastRotatedAt")
    health_status: str = Field(alias="healthStatus")
    last_smoke_status: str = Field(alias="lastSmokeStatus")
    last_smoke_at: str | None = Field(alias="lastSmokeAt")


class LlmModelConfigResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    provider_code: str = Field(alias="providerCode")
    model_id: str = Field(alias="modelId")
    display_name: str = Field(alias="displayName")
    default_context_tokens: int = Field(alias="defaultContextTokens")
    supports_streaming: bool = Field(alias="supportsStreaming")
    supports_tool_calling: bool = Field(alias="supportsToolCalling")
    default_max_output_tokens: int = Field(alias="defaultMaxOutputTokens")
    status: str
    pricing_source_url: str = Field(alias="pricingSourceUrl")
    last_reviewed_at: str | None = Field(alias="lastReviewedAt")
    bound_service_ids: list[str] = Field(alias="boundServiceIds")


class LlmPricingReviewResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    service_id: str = Field(alias="serviceId")
    provider_code: str = Field(alias="providerCode")
    model_id: str = Field(alias="modelId")
    pricing_status: str = Field(alias="pricingStatus")
    source_currency: str = Field(alias="sourceCurrency")
    input_price_per_1m_tokens_usdc: str | None = Field(alias="inputPricePer1MTokensUsdc")
    output_price_per_1m_tokens_usdc: str | None = Field(alias="outputPricePer1MTokensUsdc")
    input_cache_hit_price_per_1m_tokens_usdc: str | None = Field(alias="inputCacheHitPricePer1MTokensUsdc")
    input_cache_miss_price_per_1m_tokens_usdc: str | None = Field(alias="inputCacheMissPricePer1MTokensUsdc")
    markup_rate: str = Field(alias="markupRate")
    display_amount_usdc: str = Field(alias="displayAmountUsdc")
    hold_buffer_multiplier: str = Field(alias="holdBufferMultiplier")
    max_auto_hold_usdc: str = Field(alias="maxAutoHoldUsdc")
    source_url: str = Field(alias="sourceUrl")
    reviewer: str | None
    effective_date: str | None = Field(alias="effectiveDate")


class LlmRolloutStateResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    service_id: str = Field(alias="serviceId")
    provider_code: str = Field(alias="providerCode")
    environment: str
    eligibility_status: str = Field(alias="eligibilityStatus")
    prod_opt_in: bool = Field(alias="prodOptIn")
    onboarding_action: str = Field(alias="onboardingAction")
    last_request_id: str | None = Field(alias="lastRequestId")
    last_smoke_status: str = Field(alias="lastSmokeStatus")
    blocked_reason: str | None = Field(alias="blockedReason")


class ProviderLlmConfigSnapshotResponse(BaseModel):
    vendors: list[LlmVendorConfigResponse]
    models: list[LlmModelConfigResponse]
    pricing_reviews: list[LlmPricingReviewResponse] = Field(alias="pricingReviews")
    rollout_states: list[LlmRolloutStateResponse] = Field(alias="rolloutStates")

    @classmethod
    def from_snapshot(cls, snapshot: LlmConfigSnapshot) -> "ProviderLlmConfigSnapshotResponse":
        return cls.model_validate(
            {
                "vendors": snapshot.vendors,
                "models": snapshot.models,
                "pricingReviews": snapshot.pricing_reviews,
                "rolloutStates": snapshot.rollout_states,
            },
            from_attributes=True,
        )


class LlmRolloutRequestCreate(BaseModel):
    service_id: str = Field(alias="serviceId", min_length=1, max_length=128)
    environment: str = Field(min_length=1, max_length=16)
    action: str = Field(min_length=1, max_length=32)
    note: str | None = Field(default=None, max_length=500)


class LlmRolloutRequestResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    request_id: str = Field(alias="requestId")
    service_id: str = Field(alias="serviceId")
    environment: str
    action: str
    status: str
    requested_by: str = Field(alias="requestedBy")
    note: str | None
    blocked_reason: str | None = Field(alias="blockedReason")

    @classmethod
    def from_request(cls, request: LlmRolloutRequest) -> "LlmRolloutRequestResponse":
        return cls.model_validate(request, from_attributes=True)
