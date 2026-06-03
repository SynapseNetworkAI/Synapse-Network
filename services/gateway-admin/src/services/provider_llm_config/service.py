from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4

from src.domain.provider_llm_config import (
    LlmConfigSnapshot,
    LlmModelConfig,
    LlmPricingReview,
    LlmRolloutRequest,
    LlmRolloutState,
    LlmVendorConfig,
)
from src.services.auth.service import AdminIdentity


DEFAULT_TIMEOUT_S = 60
DEFAULT_QPS = 1
DEFAULT_MAX_OUTPUT_TOKENS = 2048
HOLD_BUFFER_MULTIPLIER = "1.2"
MAX_AUTO_HOLD_USDC = "1.000000"
REFERENCE_PRICE_USDC = "0.010000"


@dataclass(frozen=True)
class LlmCatalogRow:
    provider_code: str
    provider_name: str
    base_url: str
    model_id: str
    display_name: str
    service_id: str
    slug: str
    api_docs_url: str
    pricing_url: str


LLM_ROWS = (
    LlmCatalogRow(
        "openai",
        "OpenAI",
        "https://api.openai.com/v1",
        "gpt-4.1",
        "OpenAI GPT-4.1",
        "svc_openai_gpt_4_1",
        "openai-gpt-4-1",
        "https://platform.openai.com/docs/api-reference/chat/create",
        "https://platform.openai.com/docs/pricing",
    ),
    LlmCatalogRow(
        "xai",
        "xAI",
        "https://api.x.ai/v1",
        "grok-4.3",
        "xAI Grok 4.3",
        "svc_xai_grok_4_3",
        "xai-grok-4-3",
        "https://docs.x.ai/docs/api-reference",
        "https://docs.x.ai/docs/models",
    ),
    LlmCatalogRow(
        "mistral",
        "Mistral",
        "https://api.mistral.ai/v1",
        "mistral-large-latest",
        "Mistral Large",
        "svc_mistral_large",
        "mistral-large",
        "https://docs.mistral.ai/api/",
        "https://mistral.ai/products/la-plateforme#pricing",
    ),
    LlmCatalogRow(
        "groq",
        "Groq",
        "https://api.groq.com/openai/v1",
        "llama-3.3-70b-versatile",
        "Groq Llama 3.3 70B",
        "svc_groq_llama_3_3_70b",
        "groq-llama-3-3-70b",
        "https://console.groq.com/docs/openai",
        "https://groq.com/pricing/",
    ),
    LlmCatalogRow(
        "together",
        "Together",
        "https://api.together.ai/v1",
        "openai/gpt-oss-120b",
        "Together GPT-OSS 120B",
        "svc_together_gpt_oss_120b",
        "together-gpt-oss-120b",
        "https://docs.together.ai/docs/openai-api-compatibility",
        "https://www.together.ai/pricing",
    ),
    LlmCatalogRow(
        "fireworks",
        "Fireworks",
        "https://api.fireworks.ai/inference/v1",
        "accounts/fireworks/models/llama-v3p1-405b-instruct",
        "Fireworks Llama 3.1 405B",
        "svc_fireworks_llama_3_1_405b",
        "fireworks-llama-3-1-405b",
        "https://docs.fireworks.ai/api-reference/post-chatcompletions",
        "https://fireworks.ai/pricing",
    ),
    LlmCatalogRow(
        "perplexity",
        "Perplexity",
        "https://api.perplexity.ai",
        "sonar-pro",
        "Perplexity Sonar Pro",
        "svc_perplexity_sonar_pro",
        "perplexity-sonar-pro",
        "https://docs.perplexity.ai/api-reference/chat-completions",
        "https://docs.perplexity.ai/guides/pricing",
    ),
    LlmCatalogRow(
        "moonshot",
        "Moonshot",
        "https://api.moonshot.ai/v1",
        "kimi-k2.5",
        "Moonshot Kimi K2.5",
        "svc_moonshot_kimi_k2_5",
        "moonshot-kimi-k2-5",
        "https://platform.moonshot.ai/docs/api/chat",
        "https://platform.moonshot.ai/docs/pricing",
    ),
    LlmCatalogRow(
        "cohere",
        "Cohere",
        "https://api.cohere.ai/compatibility/v1",
        "command-a-plus-05-2026",
        "Cohere Command A+",
        "svc_cohere_command_a_plus",
        "cohere-command-a-plus",
        "https://docs.cohere.com/docs/compatibility-api",
        "https://cohere.com/pricing",
    ),
    LlmCatalogRow(
        "qwen",
        "Qwen",
        "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        "qwen-plus",
        "Qwen Plus",
        "svc_qwen_plus",
        "qwen-plus",
        "https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope",
        "https://www.alibabacloud.com/help/en/model-studio/billing-for-model-studio",
    ),
)


class ProviderLlmConfigService:
    def snapshot(self) -> LlmConfigSnapshot:
        return LlmConfigSnapshot(
            vendors=tuple(self._vendor(row) for row in LLM_ROWS),
            models=tuple(self._model(row) for row in LLM_ROWS),
            pricing_reviews=tuple(self._pricing(row) for row in LLM_ROWS),
            rollout_states=tuple(self._rollout(row) for row in LLM_ROWS),
        )

    def create_rollout_request(
        self,
        *,
        actor: AdminIdentity,
        service_id: str,
        environment: str,
        action: str,
        note: str | None,
    ) -> LlmRolloutRequest:
        normalized_action = action.strip().lower()
        normalized_environment = environment.strip().lower()
        row = self._find_row(service_id)
        blocked_reason = self._blocked_reason(normalized_environment, normalized_action)
        return LlmRolloutRequest(
            request_id=f"llm_rollout_{uuid4().hex[:12]}",
            service_id=row.service_id,
            environment=normalized_environment,
            action=normalized_action,
            status="blocked" if blocked_reason else "queued",
            requested_by=actor.admin_id,
            note=note,
            blocked_reason=blocked_reason,
        )

    @staticmethod
    def _find_row(service_id: str) -> LlmCatalogRow:
        normalized = service_id.strip()
        for row in LLM_ROWS:
            if row.service_id == normalized or row.slug == normalized:
                return row
        raise ValueError("LLM_SERVICE_NOT_FOUND")

    @staticmethod
    def _blocked_reason(environment: str, action: str) -> str | None:
        if environment == "prod" and action == "prod_enable":
            return "operator_review_required"
        return None

    @staticmethod
    def _vendor(row: LlmCatalogRow) -> LlmVendorConfig:
        return LlmVendorConfig(
            provider_code=row.provider_code,
            display_name=row.provider_name,
            base_url=row.base_url,
            api_docs_url=row.api_docs_url,
            pricing_url=row.pricing_url,
            environments=("local", "staging"),
            default_timeout_s=DEFAULT_TIMEOUT_S,
            default_qps=DEFAULT_QPS,
            secret_reference=f"secret-manager:{row.provider_code.upper()}_API_KEY",
            secret_present=False,
            secret_last_rotated_at=None,
            health_status="configuration_required",
            last_smoke_status="not_run",
            last_smoke_at=None,
        )

    @staticmethod
    def _model(row: LlmCatalogRow) -> LlmModelConfig:
        return LlmModelConfig(
            provider_code=row.provider_code,
            model_id=row.model_id,
            display_name=row.display_name,
            default_context_tokens=0,
            supports_streaming=False,
            supports_tool_calling=False,
            default_max_output_tokens=DEFAULT_MAX_OUTPUT_TOKENS,
            status="operator_review_required",
            pricing_source_url=row.pricing_url,
            last_reviewed_at=None,
            bound_service_ids=(row.service_id,),
        )

    @staticmethod
    def _pricing(row: LlmCatalogRow) -> LlmPricingReview:
        return LlmPricingReview(
            service_id=row.service_id,
            provider_code=row.provider_code,
            model_id=row.model_id,
            pricing_status="operator_review_required",
            source_currency="USD",
            input_price_per_1m_tokens_usdc=None,
            output_price_per_1m_tokens_usdc=None,
            input_cache_hit_price_per_1m_tokens_usdc=None,
            input_cache_miss_price_per_1m_tokens_usdc=None,
            markup_rate="operator_config_required",
            display_amount_usdc=REFERENCE_PRICE_USDC,
            hold_buffer_multiplier=HOLD_BUFFER_MULTIPLIER,
            max_auto_hold_usdc=MAX_AUTO_HOLD_USDC,
            source_url=row.pricing_url,
            reviewer=None,
            effective_date=None,
        )

    @staticmethod
    def _rollout(row: LlmCatalogRow) -> LlmRolloutState:
        return LlmRolloutState(
            service_id=row.service_id,
            provider_code=row.provider_code,
            environment="prod",
            eligibility_status="operator_review_required",
            prod_opt_in=False,
            onboarding_action="blocked_until_pricing_review",
            last_request_id=None,
            last_smoke_status="not_run",
            blocked_reason="operator_review_required",
        )
