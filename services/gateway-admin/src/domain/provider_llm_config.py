from __future__ import annotations

from dataclasses import dataclass


ProviderRolloutAction = str
ProviderRolloutEnvironment = str


@dataclass(frozen=True)
class LlmVendorConfig:
    provider_code: str
    display_name: str
    base_url: str
    api_docs_url: str
    pricing_url: str
    environments: tuple[str, ...]
    default_timeout_s: int
    default_qps: int
    secret_reference: str
    secret_present: bool
    secret_last_rotated_at: str | None
    health_status: str
    last_smoke_status: str
    last_smoke_at: str | None


@dataclass(frozen=True)
class LlmModelConfig:
    provider_code: str
    model_id: str
    display_name: str
    default_context_tokens: int
    supports_streaming: bool
    supports_tool_calling: bool
    default_max_output_tokens: int
    status: str
    pricing_source_url: str
    last_reviewed_at: str | None
    bound_service_ids: tuple[str, ...]


@dataclass(frozen=True)
class LlmPricingReview:
    service_id: str
    provider_code: str
    model_id: str
    pricing_status: str
    source_currency: str
    input_price_per_1m_tokens_usdc: str | None
    output_price_per_1m_tokens_usdc: str | None
    input_cache_hit_price_per_1m_tokens_usdc: str | None
    input_cache_miss_price_per_1m_tokens_usdc: str | None
    markup_rate: str
    display_amount_usdc: str
    hold_buffer_multiplier: str
    max_auto_hold_usdc: str
    source_url: str
    reviewer: str | None
    effective_date: str | None


@dataclass(frozen=True)
class LlmRolloutState:
    service_id: str
    provider_code: str
    environment: ProviderRolloutEnvironment
    eligibility_status: str
    prod_opt_in: bool
    onboarding_action: str
    last_request_id: str | None
    last_smoke_status: str
    blocked_reason: str | None


@dataclass(frozen=True)
class LlmConfigSnapshot:
    vendors: tuple[LlmVendorConfig, ...]
    models: tuple[LlmModelConfig, ...]
    pricing_reviews: tuple[LlmPricingReview, ...]
    rollout_states: tuple[LlmRolloutState, ...]


@dataclass(frozen=True)
class LlmRolloutRequest:
    request_id: str
    service_id: str
    environment: ProviderRolloutEnvironment
    action: ProviderRolloutAction
    status: str
    requested_by: str
    note: str | None
    blocked_reason: str | None
