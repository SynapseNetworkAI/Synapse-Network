import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildProviderDeployGatewayPayloadPreview,
  buildProviderDeployStandardManifest,
  DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET,
  DEFAULT_SERVICE_AUTH_MODE,
  DEFAULT_SERVICE_BILLABLE_STATUS_CLASSES,
  DEFAULT_SERVICE_BILLING_UNIT,
  DEFAULT_SERVICE_HEALTH_INTERVAL_SEC,
  DEFAULT_SERVICE_HEALTH_METHOD,
  DEFAULT_SERVICE_INVOKE_METHOD,
  DEFAULT_SERVICE_REQUEST_CONTENT_TYPE,
  DEFAULT_SERVICE_REQUEST_ID_HEADER,
  DEFAULT_SERVICE_RETRY_BACKOFF_MS,
  DEFAULT_SERVICE_RETRY_MAX_ATTEMPTS,
  DEFAULT_SERVICE_RETRY_ON_STATUS,
} from "@/utils/serviceStatus";
import { nowDateTimeString } from "@/utils/time";

describe("serviceStatus provider deploy builders", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds the V1 standard manifest with normalized provider deploy structure", () => {
    const manifest = buildProviderDeployStandardManifest({
      draft: {
        identity: {
          serviceId: "svc_quote_famous_top3",
          serviceName: " Famous Quotes Top3 ",
          serviceSlug: "",
          manifestVersion: "1.0.0",
        },
        modelUsage: {
          descriptionForModel: "Return top 3 famous quotes for a topic.",
          taskCategory: "quotes.famous",
          capabilities: ["quotes", "quotes", "top3"],
          limitations: ["cn only", "cn only", "topic required"],
          supportedLanguages: ["jp", "CN", "en"],
        },
        billing: {
          basePriceUsdc: "0.05",
          settlementCurrency: "",
        },
        runtime: {
          endpointUrl: "https://provider.example.com/api/v1/quotes/top3",
          authMode: "",
          timeoutMs: 12000,
          maxRequestBytes: 8192,
          maxResponseBytes: 16384,
        },
        gatewayExtensions: {
          healthCheck: {
            path: "healthz",
            timeoutMs: 2500,
          },
          rateLimitPolicy: {
            maxQps: 25,
          },
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          topic: { type: "string" },
        },
        required: ["topic"],
      },
      outputSchema: {
        type: "object",
        properties: {
          quotes: {
            type: "array",
          },
        },
      },
      examples: [{ topic: "perseverance" }],
      successCodes: [200],
      normalizedTargets: [
        {
          url: "https://provider.example.com/api/v1/quotes/top3",
          region: "ap-sg",
          weight: 100,
        },
      ],
    });

    expect(manifest).toEqual({
      service_id: "svc_quote_famous_top3",
      service_name: "Famous Quotes Top3",
      service_slug: "famous-quotes-top3",
      manifest_version: "1.0.0",
      model_usage: {
        description_for_model: "Return top 3 famous quotes for a topic.",
        task_category: "quotes.famous",
        capabilities: ["quotes", "top3"],
        limitations: ["cn only", "topic required"],
        supported_languages: ["cn"],
        examples: [{ topic: "perseverance" }],
      },
      io_schema: {
        input_schema: {
          type: "object",
          properties: {
            topic: { type: "string" },
          },
          required: ["topic"],
        },
        output_schema: {
          type: "object",
          properties: {
            quotes: {
              type: "array",
            },
          },
        },
      },
      billing: {
        price_model: DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.priceModel,
        base_price_usdc: "0.05",
        settlement_currency: DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.settlementCurrency,
      },
      runtime: {
        endpoint_url: "https://provider.example.com/api/v1/quotes/top3",
        auth_mode: DEFAULT_SERVICE_AUTH_MODE,
        timeout_ms: 12000,
        max_request_bytes: 8192,
        max_response_bytes: 16384,
      },
      gateway_extensions: {
        health_check: {
          method: DEFAULT_SERVICE_HEALTH_METHOD,
          path: "/healthz",
          interval_sec: DEFAULT_SERVICE_HEALTH_INTERVAL_SEC,
          timeout_ms: 2500,
          success_codes: [200],
        },
        routing_targets: [
          {
            url: "https://provider.example.com/api/v1/quotes/top3",
            region: "ap-sg",
            weight: 100,
          },
        ],
        forwarding_policy: {
          request_id_header: DEFAULT_SERVICE_REQUEST_ID_HEADER,
        },
        rate_limit_policy: {
          max_qps: 25,
        },
      },
    });
  });

  it("builds the V1 gateway payload preview with stable provider deploy defaults", () => {
    vi.useFakeTimers();
    const frozenNow = new Date("2026-03-19T08:09:10Z");
    vi.setSystemTime(frozenNow);

    const payload = buildProviderDeployGatewayPayloadPreview({
      address: "0xabc123",
      draft: {
        identity: {
          serviceId: "svc_quote_famous_top3",
          serviceName: " Famous Quotes Top3 ",
          serviceSlug: "quotes-famous",
          manifestVersion: "1.0.0",
        },
        modelUsage: {
          descriptionForModel: "Return top 3 famous quotes for a topic.",
          taskCategory: "quotes.famous",
          capabilities: ["quotes", "quotes", "top3"],
          limitations: ["cn only"],
          supportedLanguages: ["en"],
        },
        billing: {
          basePriceUsdc: "0.05",
          settlementCurrency: "USDC",
        },
        runtime: {
          endpointUrl: "https://provider.example.com/api/v1/quotes/top3",
          authMode: "gateway_forward",
          timeoutMs: 12000,
          maxRequestBytes: 8192,
          maxResponseBytes: 16384,
        },
        gatewayExtensions: {
          healthCheck: {
            path: "healthz",
            timeoutMs: 2500,
          },
          rateLimitPolicy: {
            maxQps: 25,
          },
        },
      },
      inputSchema: {
        type: "object",
        properties: {
          topic: { type: "string" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          quotes: { type: "array" },
        },
      },
      examples: [{ topic: "perseverance" }],
      successCodes: [200, 204],
      normalizedTargets: [
        {
          url: "https://provider.example.com/api/v1/quotes/top3",
          region: "ap-sg",
          weight: 100,
        },
      ],
    });

    expect(payload).toEqual({
      serviceId: "svc_quote_famous_top3",
      serviceName: "Famous Quotes Top3",
      createdAt: nowDateTimeString(frozenNow),
      updatedAt: nowDateTimeString(frozenNow),
      role: DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.role,
      address: "0xabc123",
      pricing: {
        currency: DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.settlementCurrency,
        amount: "0.05",
      },
      isActive: DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.isActive,
      status: DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.status,
      summary: "Return top 3 famous quotes for a topic.",
      tags: ["quotes-famous", "quotes.famous", "quotes", "top3"],
      auth: {
        type: DEFAULT_SERVICE_AUTH_MODE,
        headerName: "X-Credential",
      },
      healthCheck: {
        path: "/healthz",
        method: DEFAULT_SERVICE_HEALTH_METHOD,
        intervalSec: DEFAULT_SERVICE_HEALTH_INTERVAL_SEC,
        timeoutMs: 2500,
        successCodes: [200, 204],
        healthyThreshold: 2,
        unhealthyThreshold: 3,
      },
      constraints: {
        timeoutMs: 12000,
        maxRequestBytes: 8192,
        maxResponseBytes: 16384,
        maxQps: 25,
      },
      forwarding: {
        requestIdHeader: DEFAULT_SERVICE_REQUEST_ID_HEADER,
        injectHeaders: {
          "X-Synapse-Service-Id": "svc_quote_famous_top3",
        },
        retryPolicy: {
          maxAttempts: DEFAULT_SERVICE_RETRY_MAX_ATTEMPTS,
          backoffMs: DEFAULT_SERVICE_RETRY_BACKOFF_MS,
          retryOnStatus: [...DEFAULT_SERVICE_RETRY_ON_STATUS],
        },
      },
      metering: {
        billingUnit: DEFAULT_SERVICE_BILLING_UNIT,
        billOnError: false,
        billableStatusClasses: DEFAULT_SERVICE_BILLABLE_STATUS_CLASSES,
        requestIdRequired: true,
        responseSizeMetering: true,
      },
      invoke: {
        method: DEFAULT_SERVICE_INVOKE_METHOD,
        targets: [
          {
            url: "https://provider.example.com/api/v1/quotes/top3",
            region: "ap-sg",
            weight: 100,
          },
        ],
        timeoutMs: 12000,
        request: {
          contentType: DEFAULT_SERVICE_REQUEST_CONTENT_TYPE,
          schema: {
            type: "object",
            properties: {
              topic: { type: "string" },
            },
          },
        },
        response: {
          schema: {
            type: "object",
            properties: {
              quotes: { type: "array" },
            },
          },
        },
        headersTemplate: {
          [DEFAULT_SERVICE_REQUEST_ID_HEADER]: "{{requestId}}",
        },
        examples: [{ topic: "perseverance" }],
      },
    });
  });
});