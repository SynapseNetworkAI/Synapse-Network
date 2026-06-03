import { describe, expect, it } from "vitest";

import type { ProviderLlmConfigSnapshot } from "@/services/provider-llm-config-api";

import {
  buildProviderLlmRolloutMetrics,
  buildProviderLlmRolloutNote,
  findProviderLlmRollout,
  formatProviderLlmRolloutNotice,
  getProviderLlmServiceId,
  resolveProviderLlmRolloutEnvironment,
} from "./provider-llm-config-presenters";

const snapshot = {
  vendors: [
    {
      providerCode: "openai",
      displayName: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      apiDocsUrl: "https://platform.openai.com/docs",
      pricingUrl: "https://openai.com/pricing",
      environments: ["staging", "prod"],
      defaultTimeoutS: 60,
      defaultQps: 10,
      secretReference: "secret://openai",
      secretPresent: true,
      secretLastRotatedAt: null,
      healthStatus: "healthy",
      lastSmokeStatus: "passed",
      lastSmokeAt: null,
    },
  ],
  models: [
    {
      providerCode: "openai",
      modelId: "gpt-5",
      displayName: "GPT-5",
      defaultContextTokens: 128000,
      supportsStreaming: false,
      supportsToolCalling: true,
      defaultMaxOutputTokens: 4096,
      status: "active",
      pricingSourceUrl: "https://openai.com/pricing",
      lastReviewedAt: null,
      boundServiceIds: ["svc_openai_gpt_5"],
    },
  ],
  pricingReviews: [
    {
      serviceId: "svc_openai_gpt_5",
      providerCode: "openai",
      modelId: "gpt-5",
      pricingStatus: "operator_review_required",
      sourceCurrency: "USD",
      inputPricePer1MTokensUsdc: "1.00",
      outputPricePer1MTokensUsdc: "2.00",
      inputCacheHitPricePer1MTokensUsdc: null,
      inputCacheMissPricePer1MTokensUsdc: null,
      markupRate: "0.100000",
      displayAmountUsdc: "0.010000",
      holdBufferMultiplier: "1.000000",
      maxAutoHoldUsdc: "1.000000",
      sourceUrl: "https://openai.com/pricing",
      reviewer: null,
      effectiveDate: null,
    },
  ],
  rolloutStates: [
    {
      serviceId: "svc_openai_gpt_5",
      providerCode: "openai",
      environment: "prod",
      eligibilityStatus: "blocked",
      prodOptIn: true,
      onboardingAction: "prod_enable",
      lastRequestId: "rollout-1",
      lastSmokeStatus: "passed",
      blockedReason: "pricing review required",
    },
  ],
} satisfies ProviderLlmConfigSnapshot;

describe("provider LLM config presenters", () => {
  it("builds rollout metrics from backend snapshot", () => {
    expect(buildProviderLlmRolloutMetrics(snapshot)).toEqual({
      vendors: 1,
      models: 1,
      pricingBlocked: 1,
      prodOptIn: 1,
    });
    expect(buildProviderLlmRolloutMetrics(null)).toEqual({
      vendors: 0,
      models: 0,
      pricingBlocked: 0,
      prodOptIn: 0,
    });
  });

  it("resolves service and rollout lookup without frontend-only status invention", () => {
    expect(getProviderLlmServiceId(snapshot.models[0])).toBe(
      "svc_openai_gpt_5"
    );
    expect(
      findProviderLlmRollout(snapshot.rolloutStates, "svc_openai_gpt_5")
    ).toMatchObject({ eligibilityStatus: "blocked" });
    expect(
      findProviderLlmRollout(snapshot.rolloutStates, "missing")
    ).toBeNull();
  });

  it("formats rollout requests and notices", () => {
    expect(resolveProviderLlmRolloutEnvironment("smoke")).toBe("staging");
    expect(resolveProviderLlmRolloutEnvironment("prod_enable")).toBe("prod");
    expect(buildProviderLlmRolloutNote("smoke")).toBe(
      "smoke requested from LLM config control plane."
    );
    expect(
      formatProviderLlmRolloutNotice({
        blockedReason: "pricing review required",
        serviceId: "svc_openai_gpt_5",
        status: "blocked",
      })
    ).toContain("blocked request");
  });
});
