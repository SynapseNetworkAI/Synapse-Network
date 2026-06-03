import { request } from "./admin-api";

export type ProviderLlmVendorConfig = {
  providerCode: string;
  displayName: string;
  baseUrl: string;
  apiDocsUrl: string;
  pricingUrl: string;
  environments: string[];
  defaultTimeoutS: number;
  defaultQps: number;
  secretReference: string;
  secretPresent: boolean;
  secretLastRotatedAt: string | null;
  healthStatus: string;
  lastSmokeStatus: string;
  lastSmokeAt: string | null;
};

export type ProviderLlmModelConfig = {
  providerCode: string;
  modelId: string;
  displayName: string;
  defaultContextTokens: number;
  supportsStreaming: boolean;
  supportsToolCalling: boolean;
  defaultMaxOutputTokens: number;
  status: string;
  pricingSourceUrl: string;
  lastReviewedAt: string | null;
  boundServiceIds: string[];
};

export type ProviderLlmPricingReview = {
  serviceId: string;
  providerCode: string;
  modelId: string;
  pricingStatus: string;
  sourceCurrency: string;
  inputPricePer1MTokensUsdc: string | null;
  outputPricePer1MTokensUsdc: string | null;
  inputCacheHitPricePer1MTokensUsdc: string | null;
  inputCacheMissPricePer1MTokensUsdc: string | null;
  markupRate: string;
  displayAmountUsdc: string;
  holdBufferMultiplier: string;
  maxAutoHoldUsdc: string;
  sourceUrl: string;
  reviewer: string | null;
  effectiveDate: string | null;
};

export type ProviderLlmRolloutState = {
  serviceId: string;
  providerCode: string;
  environment: string;
  eligibilityStatus: string;
  prodOptIn: boolean;
  onboardingAction: string;
  lastRequestId: string | null;
  lastSmokeStatus: string;
  blockedReason: string | null;
};

export type ProviderLlmConfigSnapshot = {
  vendors: ProviderLlmVendorConfig[];
  models: ProviderLlmModelConfig[];
  pricingReviews: ProviderLlmPricingReview[];
  rolloutStates: ProviderLlmRolloutState[];
};

export type ProviderLlmRolloutRequest = {
  requestId: string;
  serviceId: string;
  environment: string;
  action: string;
  status: string;
  requestedBy: string;
  note: string | null;
  blockedReason: string | null;
};

export async function getProviderLlmConfig(): Promise<ProviderLlmConfigSnapshot> {
  return request<ProviderLlmConfigSnapshot>("/api/admin/v1/provider-llm-config");
}

export async function createProviderLlmRolloutRequest(input: {
  serviceId: string;
  environment: string;
  action: string;
  note?: string;
}): Promise<ProviderLlmRolloutRequest> {
  return request<ProviderLlmRolloutRequest>(
    "/api/admin/v1/provider-llm-config/rollout-requests",
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
}
