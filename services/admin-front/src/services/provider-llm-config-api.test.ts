import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createProviderLlmRolloutRequest,
  getProviderLlmConfig,
} from "./provider-llm-config-api";

describe("provider LLM config API adapters", () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    storage.set("synapse.admin.csrfToken", "csrf-token");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { pathname: "/provider-llm-config", replace: vi.fn() },
        sessionStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => storage.set(key, value),
          removeItem: (key: string) => storage.delete(key),
          clear: () => storage.clear(),
        },
      },
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: globalThis.window.sessionStorage,
    });
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("loads provider LLM config from the governance endpoint", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          vendors: [
            {
              providerCode: "openai",
              displayName: "OpenAI",
              baseUrl: "https://api.openai.com/v1",
              apiDocsUrl: "https://platform.openai.com/docs",
              pricingUrl: "https://platform.openai.com/docs/pricing",
              environments: ["local", "staging"],
              defaultTimeoutS: 60,
              defaultQps: 1,
              secretReference: "secret-manager:OPENAI_API_KEY",
              secretPresent: false,
              secretLastRotatedAt: null,
              healthStatus: "configuration_required",
              lastSmokeStatus: "not_run",
              lastSmokeAt: null,
            },
          ],
          models: [],
          pricingReviews: [
            {
              serviceId: "svc_openai_gpt_4_1",
              providerCode: "openai",
              modelId: "gpt-4.1",
              pricingStatus: "operator_review_required",
              sourceCurrency: "USD",
              inputPricePer1MTokensUsdc: null,
              outputPricePer1MTokensUsdc: null,
              inputCacheHitPricePer1MTokensUsdc: null,
              inputCacheMissPricePer1MTokensUsdc: null,
              markupRate: "operator_config_required",
              displayAmountUsdc: "0.010000",
              holdBufferMultiplier: "1.2",
              maxAutoHoldUsdc: "1.000000",
              sourceUrl: "https://platform.openai.com/docs/pricing",
              reviewer: null,
              effectiveDate: null,
            },
          ],
          rolloutStates: [],
        },
        requestId: "req_llm_config",
      }),
    });

    const response = await getProviderLlmConfig();

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(url).toBe("/api/admin/v1/provider-llm-config");
    expect(response.vendors[0]?.providerCode).toBe("openai");
    expect(response.pricingReviews[0]?.pricingStatus).toBe(
      "operator_review_required"
    );
  });

  it("creates provider LLM rollout requests", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          requestId: "llm_rollout_1",
          serviceId: "svc_openai_gpt_4_1",
          environment: "prod",
          action: "prod_enable",
          status: "blocked",
          requestedBy: "adm_1",
          note: "review prod",
          blockedReason: "operator_review_required",
        },
        requestId: "req_llm_rollout",
      }),
    });

    const response = await createProviderLlmRolloutRequest({
      serviceId: "svc_openai_gpt_4_1",
      environment: "prod",
      action: "prod_enable",
      note: "review prod",
    });

    const [, init] =
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(
      JSON.stringify({
        serviceId: "svc_openai_gpt_4_1",
        environment: "prod",
        action: "prod_enable",
        note: "review prod",
      })
    );
    expect(response.status).toBe("blocked");
    expect(response.blockedReason).toBe("operator_review_required");
  });
});
