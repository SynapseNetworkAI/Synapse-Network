import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAnalyticsConsumerFunnel,
  getAnalyticsDataQuality,
  getAnalyticsInvocationRevenue,
  getAnalyticsMoneyFlow,
  getAnalyticsOverview,
  getAnalyticsProviderRevenue,
  getAnalyticsRiskHealth,
  getCurrentAdmin,
  listApprovals,
  listExecutionJobs,
  listProviderServices,
  listProviderWithdrawReviews,
  updateProviderServiceLifecycle,
  resolveAdminApiBaseUrl,
} from "./admin-api";

describe("admin session expiry handling", () => {
  const originalFetch = globalThis.fetch;
  const replaceSpy = vi.fn();
  const storage = new Map<string, string>();
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.restoreAllMocks();
    replaceSpy.mockReset();
    storage.clear();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          pathname: "/withdrawal-reviews",
          replace: replaceSpy,
        },
        sessionStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => {
            storage.set(key, value);
          },
          removeItem: (key: string) => {
            storage.delete(key);
          },
          clear: () => {
            storage.clear();
          },
        },
      },
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: globalThis.window.sessionStorage,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("clears the csrf token and redirects to login when the admin session has expired", async () => {
    globalThis.sessionStorage.setItem("synapse.admin.csrfToken", "persisted-token");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Admin session expired",
        },
        requestId: "req_expired",
      }),
    }) as typeof fetch;

    await expect(getCurrentAdmin("cookie-session")).rejects.toThrow("Admin session expired");
    expect(globalThis.sessionStorage.getItem("synapse.admin.csrfToken")).toBeNull();
    expect(replaceSpy).toHaveBeenCalledWith("/login");
  });
});

describe("resolveAdminApiBaseUrl", () => {
  it("falls back to same-origin requests when no public API base URL is configured", () => {
    expect(resolveAdminApiBaseUrl(undefined)).toBe("");
    expect(resolveAdminApiBaseUrl("   ")).toBe("");
  });

  it("strips a trailing slash from explicit API base URLs", () => {
    expect(resolveAdminApiBaseUrl("http://localhost:8300/")).toBe("http://localhost:8300");
  });

  it("preserves relative API prefixes when they are explicitly configured", () => {
    expect(resolveAdminApiBaseUrl("/gateway-admin/")).toBe("/gateway-admin");
  });
});

describe("analytics API adapters", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {},
        requestId: "req_analytics",
      }),
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls each analytics drilldown endpoint with the selected window", async () => {
    await getAnalyticsOverview("cookie-session", "7d");
    await getAnalyticsConsumerFunnel("cookie-session", "7d");
    await getAnalyticsInvocationRevenue("cookie-session", "7d");
    await getAnalyticsProviderRevenue("cookie-session", "7d");
    await getAnalyticsMoneyFlow("cookie-session", "7d");
    await getAnalyticsRiskHealth("cookie-session", "7d");
    await getAnalyticsDataQuality("cookie-session", "1h");

    const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(urls).toEqual([
      "/api/admin/v1/dashboard/analytics/overview?window=7d",
      "/api/admin/v1/dashboard/analytics/consumer-funnel?window=7d",
      "/api/admin/v1/dashboard/analytics/invocation-revenue?window=7d",
      "/api/admin/v1/dashboard/analytics/provider-revenue?window=7d",
      "/api/admin/v1/dashboard/analytics/money-flow?window=7d",
      "/api/admin/v1/dashboard/analytics/risk-health?window=7d",
      "/api/admin/v1/dashboard/analytics/data-quality?window=1h",
    ]);
  });
});

describe("provider services API adapters", () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { pathname: "/provider-services", replace: vi.fn() },
        sessionStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => {
            storage.set(key, value);
          },
          removeItem: (key: string) => {
            storage.delete(key);
          },
          clear: () => {
            storage.clear();
          },
        },
      },
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: globalThis.window.sessionStorage,
    });
    globalThis.sessionStorage.setItem("synapse.admin.csrfToken", "csrf-provider-services");
    const providerServicePayload = {
      serviceId: "svc_quotes",
      ownerAddress: "0xabc",
      serviceName: "Quotes",
      summary: "Quote endpoint",
      tags: ["quote"],
      pricing: {
        amount: "1.00",
        currency: "USDC",
      },
      controlStatus: "active",
      status: "active",
      isActive: true,
      runtimeStatus: "healthy",
      runtimeAvailable: true,
      probeTier: "standard",
      health: {},
      targets: [],
      adaptiveConcurrencyLimit: 8,
      inFlight: 1,
      queueDepth: 0,
      latencyP95Ms: 42,
      errorRate: 0.125,
      circuitState: "closed",
      lastConcurrencyAdjustmentAt: 1710000000000,
      downstreamTargets: [
        {
          targetUrl: "https://provider.test/invoke",
          adaptiveConcurrencyLimit: 8,
          inFlight: 1,
          queueDepth: 0,
          latencyP95Ms: 42,
          errorRate: 0.125,
          circuitState: "closed",
          lastConcurrencyAdjustmentAt: 1710000000000,
        },
      ],
      createdAt: "2026-03-21T10:00:00Z",
      updatedAt: "2026-03-21T10:00:00Z",
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          items: [providerServicePayload],
          page: 1,
          pageSize: 20,
          totalCount: 1,
          totalPages: 1,
          service: providerServicePayload,
        },
        requestId: "req_provider_services",
      }),
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("passes canonical provider service filters to gateway-admin", async () => {
    const response = await listProviderServices("cookie-session", {
      query: "quote",
      status: "active",
      runtimeStatus: "healthy",
      page: 2,
      pageSize: 10,
    });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(url).toBe("/api/admin/v1/provider-services?query=quote&status=active&runtimeStatus=healthy&page=2&pageSize=10");
    expect(response.items[0]?.adaptiveConcurrencyLimit).toBe(8);
    expect(response.items[0]?.inFlight).toBe(1);
    expect(response.items[0]?.latencyP95Ms).toBe(42);
    expect(response.items[0]?.errorRate).toBe(0.125);
    expect(response.items[0]?.circuitState).toBe("closed");
  });

  it("posts lifecycle actions through the provider services endpoint", async () => {
    await updateProviderServiceLifecycle("cookie-session", "svc_quotes", {
      action: "PAUSE",
      note: "ops pause",
    });

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ action: "PAUSE", note: "ops pause" }));
  });
});

describe("status normalization adapters", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("normalizes admin approval, withdrawal review, and execution statuses into domain types", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            items: [
              {
                approvalId: "appr-1",
                approvalType: "provider_withdraw_review",
                status: "SUBMITTED",
                approvalLevel: "L2",
                requesterRole: "ops",
                amountUsdc: "12.00",
                createdAt: "2026-03-21T10:00:00Z",
              },
            ],
            nextCursor: null,
          },
          requestId: "req_approvals",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            items: [
              {
                withdrawalId: "wd-1",
                ownerAddress: "0xabc",
                amountUsdc: "8.00",
                status: "PENDING_MANUAL_REVIEW",
                requestId: null,
                txHash: null,
                riskLevel: "yellow",
                riskReasonCode: "velocity_spike",
                evidenceSummary: null,
                message: null,
                createdAt: "2026-03-21T10:00:00Z",
                updatedAt: "2026-03-21T10:05:00Z",
              },
            ],
            nextCursor: null,
          },
          requestId: "req_reviews",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            items: [
              {
                jobId: "job-1",
                approvalId: "appr-1",
                executionType: "withdrawal_release",
                targetSystem: "gateway",
                status: "EXECUTING",
                idempotencyKey: "idem-1",
                errorCode: null,
                errorMessage: null,
                retryCount: 0,
                maxRetryCount: 3,
                queuedBy: "ops",
                updatedAt: "2026-03-21T11:00:00Z",
                attempts: [
                  {
                    attemptNo: 1,
                    status: "QUEUED",
                    errorCode: null,
                    errorSummary: null,
                    finishedAt: null,
                  },
                ],
              },
            ],
            nextCursor: null,
          },
          requestId: "req_jobs",
        }),
      }) as typeof fetch;

    const [approvals, reviews, jobs] = await Promise.all([
      listApprovals("cookie-session"),
      listProviderWithdrawReviews("cookie-session"),
      listExecutionJobs("cookie-session"),
    ]);

    expect(approvals.items[0]?.status).toBe("SUBMITTED");
    expect(reviews.items[0]?.status).toBe("PENDING_MANUAL_REVIEW");
    expect(reviews.items[0]?.riskLevel).toBe("yellow");
    expect(jobs.items[0]?.status).toBe("RUNNING");
    expect(jobs.items[0]?.attempts[0]?.status).toBe("PENDING");
  });

  it("rejects unknown canonical statuses instead of leaking raw strings past the API adapter", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          items: [
            {
              approvalId: "appr-1",
              approvalType: "provider_withdraw_review",
              status: "WAITING_FOR_MAGIC",
              approvalLevel: "L2",
              requesterRole: "ops",
              amountUsdc: "12.00",
              createdAt: "2026-03-21T10:00:00Z",
            },
          ],
          nextCursor: null,
        },
        requestId: "req_bad_approvals",
      }),
    }) as typeof fetch;

    await expect(listApprovals("cookie-session")).rejects.toThrow("Unknown approval status: WAITING_FOR_MAGIC");
  });
});
