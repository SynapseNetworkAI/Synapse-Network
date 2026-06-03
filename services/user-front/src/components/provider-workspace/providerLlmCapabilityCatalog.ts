export type ProviderLlmCapability = {
  providerCode: string;
  providerName: string;
  modelId: string;
  displayName: string;
  serviceId: string;
  slug: string;
  pricingStatus: "operator_review_required";
  prodOptIn: false;
};

export const PROVIDER_LLM_CAPABILITIES: ProviderLlmCapability[] = [
  {
    providerCode: "openai",
    providerName: "OpenAI",
    modelId: "gpt-4.1",
    displayName: "OpenAI GPT-4.1",
    serviceId: "svc_openai_gpt_4_1",
    slug: "openai-gpt-4-1",
    pricingStatus: "operator_review_required",
    prodOptIn: false,
  },
  {
    providerCode: "xai",
    providerName: "xAI",
    modelId: "grok-4.3",
    displayName: "xAI Grok 4.3",
    serviceId: "svc_xai_grok_4_3",
    slug: "xai-grok-4-3",
    pricingStatus: "operator_review_required",
    prodOptIn: false,
  },
  {
    providerCode: "mistral",
    providerName: "Mistral",
    modelId: "mistral-large-latest",
    displayName: "Mistral Large",
    serviceId: "svc_mistral_large",
    slug: "mistral-large",
    pricingStatus: "operator_review_required",
    prodOptIn: false,
  },
  {
    providerCode: "groq",
    providerName: "Groq",
    modelId: "llama-3.3-70b-versatile",
    displayName: "Groq Llama 3.3 70B",
    serviceId: "svc_groq_llama_3_3_70b",
    slug: "groq-llama-3-3-70b",
    pricingStatus: "operator_review_required",
    prodOptIn: false,
  },
  {
    providerCode: "together",
    providerName: "Together",
    modelId: "openai/gpt-oss-120b",
    displayName: "Together GPT-OSS 120B",
    serviceId: "svc_together_gpt_oss_120b",
    slug: "together-gpt-oss-120b",
    pricingStatus: "operator_review_required",
    prodOptIn: false,
  },
  {
    providerCode: "fireworks",
    providerName: "Fireworks",
    modelId: "accounts/fireworks/models/llama-v3p1-405b-instruct",
    displayName: "Fireworks Llama 3.1 405B",
    serviceId: "svc_fireworks_llama_3_1_405b",
    slug: "fireworks-llama-3-1-405b",
    pricingStatus: "operator_review_required",
    prodOptIn: false,
  },
  {
    providerCode: "perplexity",
    providerName: "Perplexity",
    modelId: "sonar-pro",
    displayName: "Perplexity Sonar Pro",
    serviceId: "svc_perplexity_sonar_pro",
    slug: "perplexity-sonar-pro",
    pricingStatus: "operator_review_required",
    prodOptIn: false,
  },
  {
    providerCode: "moonshot",
    providerName: "Moonshot",
    modelId: "kimi-k2.5",
    displayName: "Moonshot Kimi K2.5",
    serviceId: "svc_moonshot_kimi_k2_5",
    slug: "moonshot-kimi-k2-5",
    pricingStatus: "operator_review_required",
    prodOptIn: false,
  },
  {
    providerCode: "cohere",
    providerName: "Cohere",
    modelId: "command-a-plus-05-2026",
    displayName: "Cohere Command A+",
    serviceId: "svc_cohere_command_a_plus",
    slug: "cohere-command-a-plus",
    pricingStatus: "operator_review_required",
    prodOptIn: false,
  },
  {
    providerCode: "qwen",
    providerName: "Qwen",
    modelId: "qwen-plus",
    displayName: "Qwen Plus",
    serviceId: "svc_qwen_plus",
    slug: "qwen-plus",
    pricingStatus: "operator_review_required",
    prodOptIn: false,
  },
];
