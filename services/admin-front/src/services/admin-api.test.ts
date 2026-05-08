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
  buildAdminRequestUrl,
  closeForumTopic,
  getForumTopic,
  ignoreForumResponseTask,
  listApprovals,
  listExecutionJobs,
  listForumResponseTasks,
  listForumTopics,
  listProviderServices,
  listProviderWithdrawReviews,
  pinForumTopic,
  reopenForumTopic,
  sendForumResponseReply,
  shouldUseSameOriginAdminProxy,
  unpinForumTopic,
  updateProviderServiceLifecycle,
  resolveAdminApiBaseUrl,
} from "./admin-api";
import { createPlatformFeeSafeDraft } from "./platform-fee-treasury-api";

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
    globalThis.sessionStorage.setItem(
      "synapse.admin.csrfToken",
      "persisted-token"
    );
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

    await expect(getCurrentAdmin("cookie-session")).rejects.toThrow(
      "Admin session expired"
    );
    expect(
      globalThis.sessionStorage.getItem("synapse.admin.csrfToken")
    ).toBeNull();
    expect(replaceSpy).toHaveBeenCalledWith("/login");
  });
});

describe("resolveAdminApiBaseUrl", () => {
  it("falls back to same-origin requests when no public API base URL is configured", () => {
    expect(resolveAdminApiBaseUrl(undefined)).toBe("");
    expect(resolveAdminApiBaseUrl("   ")).toBe("");
  });

  it("strips a trailing slash from explicit API base URLs", () => {
    expect(resolveAdminApiBaseUrl("http://localhost:8300/")).toBe(
      "http://localhost:8300"
    );
  });

  it("preserves relative API prefixes when they are explicitly configured", () => {
    expect(resolveAdminApiBaseUrl("/gateway-admin/")).toBe("/gateway-admin");
  });
});

describe("shouldUseSameOriginAdminProxy", () => {
  it("routes local absolute admin API URLs through the same-origin proxy", () => {
    expect(
      shouldUseSameOriginAdminProxy("http://localhost:8300", {
        protocol: "http:",
        hostname: "127.0.0.1",
        origin: "http://127.0.0.1:3200",
      })
    ).toBe(true);
  });

  it("preserves non-local absolute admin API URLs", () => {
    expect(
      shouldUseSameOriginAdminProxy(
        "https://admin-api-staging.synapse-network.ai",
        {
          protocol: "https:",
          hostname: "admin-staging.synapse-network.ai",
          origin: "https://admin-staging.synapse-network.ai",
        }
      )
    ).toBe(false);
  });

  it("does not rewrite relative API prefixes", () => {
    expect(
      shouldUseSameOriginAdminProxy("/gateway-admin", {
        protocol: "http:",
        hostname: "127.0.0.1",
        origin: "http://127.0.0.1:3200",
      })
    ).toBe(false);
  });
});

describe("buildAdminRequestUrl", () => {
  it("keeps local browser requests on the Next.js same-origin proxy", () => {
    expect(
      buildAdminRequestUrl(
        "/api/admin/v1/auth/login",
        "http://localhost:8300",
        {
          protocol: "http:",
          hostname: "127.0.0.1",
          origin: "http://127.0.0.1:3200",
        }
      )
    ).toBe("/api/admin/v1/auth/login");
  });

  it("uses explicit external admin API origins outside local browser dev", () => {
    expect(
      buildAdminRequestUrl(
        "/api/admin/v1/auth/login",
        "https://admin-api-staging.synapse-network.ai",
        {
          protocol: "https:",
          hostname: "admin-staging.synapse-network.ai",
          origin: "https://admin-staging.synapse-network.ai",
        }
      )
    ).toBe(
      "https://admin-api-staging.synapse-network.ai/api/admin/v1/auth/login"
    );
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

    const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[0]
    );
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

describe("platform fee treasury API adapter", () => {
  const originalFetch = globalThis.fetch;
  const storage = new Map<string, string>();
  const originalWindow = globalThis.window;

  beforeEach(() => {
    storage.clear();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          pathname: "/finance",
          replace: vi.fn(),
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
    globalThis.sessionStorage.setItem("synapse.admin.csrfToken", "csrf-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("creates a super-admin Safe draft with CSRF and OTP headers", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          status: "ready_for_safe",
          requestId: "platform-fee-test",
          amountUsdc: "1.000000",
          amountAtomic: "1000000000000000000",
          safeAddress: "0x1111111111111111111111111111111111111111",
          ledgerSignerAddress: "0x2222222222222222222222222222222222222222",
          synapseCoreAddress: "0x3333333333333333333333333333333333333333",
          selector: "0x6aa21416",
          calldataHash: "0xhash",
          platformFeePoolAtomic: "2000000000000000000",
          safeTx: {
            to: "0x3333333333333333333333333333333333333333",
            value: "0",
            data: "0x6aa21416",
            operation: 0,
          },
        },
        requestId: "req_platform_fee",
      }),
    }) as typeof fetch;

    const draft = await createPlatformFeeSafeDraft({
      amountUsdc: "1.000000",
      reason: "Move platform fees to Safe.",
      requestId: "platform-fee-test",
      otpCode: "123456",
    });

    expect(draft.selector).toBe("0x6aa21416");
    const [, requestInit] =
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(requestInit?.method).toBe("POST");
    expect((requestInit?.headers as Headers).get("X-CSRF-Token")).toBe(
      "csrf-token"
    );
    expect((requestInit?.headers as Headers).get("X-Admin-OTP-Code")).toBe(
      "123456"
    );
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      amountUsdc: "1.000000",
      reason: "Move platform fees to Safe.",
      requestId: "platform-fee-test",
    });
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
    globalThis.sessionStorage.setItem(
      "synapse.admin.csrfToken",
      "csrf-provider-services"
    );
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

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(url).toBe(
      "/api/admin/v1/provider-services?query=quote&status=active&runtimeStatus=healthy&page=2&pageSize=10"
    );
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

    const [, init] =
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(
      JSON.stringify({ action: "PAUSE", note: "ops pause" })
    );
  });
});

describe("forum support API adapters", () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { pathname: "/forum-support", replace: vi.fn() },
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
    globalThis.sessionStorage.setItem(
      "synapse.admin.csrfToken",
      "csrf-forum-support"
    );
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          items: [],
          pagination: {
            page: 1,
            pageSize: 20,
            total: 0,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false,
          },
          responseTaskId: "frt_1",
          status: "responded",
        },
        requestId: "req_forum_support",
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

  it("maps list pageSize to the gateway-admin page_size query", async () => {
    await listForumResponseTasks("cookie-session", {
      status: "awaiting_response,draft_ready",
      classification: "bug",
      page: 2,
      pageSize: 30,
    });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(url).toBe(
      "/api/admin/v1/forum/response-tasks?status=awaiting_response%2Cdraft_ready&classification=bug&page=2&page_size=30"
    );
  });

  it("posts human-reviewed forum replies with editable author context", async () => {
    await sendForumResponseReply("cookie-session", "frt_1", {
      body: "Thanks, we are investigating this.",
      authorDisplay: "Synapse Ops",
      authorAddress: "synapse:ops",
    });

    const [, init] =
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("X-CSRF-Token")).toBeTruthy();
    expect(init?.body).toBe(
      JSON.stringify({
        body: "Thanks, we are investigating this.",
        authorDisplay: "Synapse Ops",
        authorAddress: "synapse:ops",
      })
    );
  });

  it("posts ignore decisions with a required reason payload", async () => {
    await ignoreForumResponseTask("cookie-session", "frt_1", {
      reason: "Duplicate of an already answered topic.",
    });

    const [, init] =
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("X-CSRF-Token")).toBeTruthy();
    expect(init?.body).toBe(
      JSON.stringify({ reason: "Duplicate of an already answered topic." })
    );
  });

  it("maps forum topic list filters to backend pagination parameters", async () => {
    await listForumTopics("cookie-session", {
      status: "open,awaiting_admin",
      q: "wallet",
      pinned: true,
      page: 3,
      pageSize: 40,
    });

    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(url).toBe(
      "/api/admin/v1/forum/topics?status=open%2Cawaiting_admin&q=wallet&pinned=true&page=3&page_size=40"
    );
  });

  it("reads forum topic detail and posts moderation lifecycle actions", async () => {
    await getForumTopic("cookie-session", "topic_1");
    await closeForumTopic("cookie-session", "topic_1", {
      reason: "Duplicate issue.",
    });
    await reopenForumTopic("cookie-session", "topic_1");
    await pinForumTopic("cookie-session", "topic_1");
    await unpinForumTopic("cookie-session", "topic_1");

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]?.[0]).toBe("/api/admin/v1/forum/topics/topic_1");
    expect(calls[1]?.[0]).toBe("/api/admin/v1/forum/topics/topic_1/close");
    expect(calls[1]?.[1]?.method).toBe("POST");
    expect(calls[1]?.[1]?.body).toBe(
      JSON.stringify({ reason: "Duplicate issue." })
    );
    expect(calls[2]?.[0]).toBe("/api/admin/v1/forum/topics/topic_1/reopen");
    expect(calls[3]?.[0]).toBe("/api/admin/v1/forum/topics/topic_1/pin");
    expect(calls[4]?.[0]).toBe("/api/admin/v1/forum/topics/topic_1/unpin");
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
                reviewExpiresAt: "2026-03-22T10:00:00Z",
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
    expect(reviews.items[0]?.withdrawalKind).toBe("provider_withdrawal");
    expect(reviews.items[0]?.reviewType).toBe("provider_withdraw_review");
    expect(reviews.items[0]?.subjectAddress).toBe("0xabc");
    expect(reviews.items[0]?.reviewExpiresAt).toBe("2026-03-22T10:00:00Z");
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

    await expect(listApprovals("cookie-session")).rejects.toThrow(
      "Unknown approval status: WAITING_FOR_MAGIC"
    );
  });
});
