import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginAdminMfaEnrollment,
  createAdminMenuItem,
  createAdminRole,
  createAdminUser,
  decideProviderWithdrawReview,
  deleteAdminMenuItem,
  deleteAdminRole,
  deleteAdminUser,
  deleteProviderService,
  forceProbeProviderService,
  getActivityTrends,
  getAdminAuthPolicy,
  getAdminMenuConfig,
  getDashboardOverview,
  getFinanceOverview,
  getForumResponseTask,
  getOperationsOverview,
  getReconciliationDetail,
  getReconciliationDrilldown,
  getSystemStatus,
  getVisibleAdminMenuConfig,
  listAdminPermissions,
  listAdminRoles,
  listAdminUsers,
  listAuditActions,
  listProviderWithdrawReviewHistory,
  logoutAdmin,
  publishAdminMenuConfig,
  retryExecutionJob,
  updateAdminMenuItem,
  updateAdminRole,
  updateAdminUser,
  verifyAdminMfaEnrollment,
} from "./admin-api";

describe("admin API adapter route coverage", () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const storage = new Map<string, string>();

  function okData(data: unknown) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data,
        requestId: "req_admin_route_coverage",
      }),
    };
  }

  function queueResponses(...items: unknown[]) {
    globalThis.fetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(okData(items.shift())));
  }

  beforeEach(() => {
    storage.clear();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { pathname: "/admin", replace: vi.fn() },
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
    globalThis.sessionStorage.setItem("synapse.admin.csrfToken", "csrf-admin");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("covers auth, dashboard, reconciliation, audit, execution, user, role, and menu routes", async () => {
    const session = {
      adminId: "adm_1",
      email: "cliff@synapse-network.ai",
      displayName: "Super Admin",
      roleKey: "super_admin",
      permissions: ["super_admin"],
      csrfToken: "csrf-next",
    };
    const reconciliation = {
      priorityApprovals: [],
      depositRepairApprovals: [],
      pendingWithdrawalReviews: [],
    };
    const executionJob = {
      id: "job_1",
      status: "SUCCEEDED",
      approvalId: "apr_1",
      targetSystem: "gateway",
      createdAt: "2026-05-01T00:00:00Z",
      updatedAt: "2026-05-01T00:00:00Z",
    };
    queueResponses(
      { factorId: "mfa_1", qrCodeDataUrl: "data:image/png;base64,abc" },
      session,
      { highRiskTotpRequired: true, totpIssuer: "SynapseNetwork Admin" },
      { adminId: "adm_1", loggedOut: true },
      { online: true },
      { database: "ok" },
      { platformFeePool: "1.000000" },
      { points: [] },
      { tasks: [] },
      reconciliation,
      reconciliation,
      { responseTaskId: "task_1" },
      { items: [] },
      executionJob,
      { items: [] },
      { roles: [] },
      { permissions: [] },
      { adminId: "adm_new" },
      { adminId: "adm_new" },
      { adminId: "adm_new", deleted: true },
      { roleKey: "ops" },
      { roleKey: "ops" },
      { roleKey: "ops", deleted: true },
      { items: [] },
      { items: [] },
      { items: [], publishedAt: "2026-05-01T00:00:00Z" }
    );

    await beginAdminMfaEnrollment("enroll-token");
    await verifyAdminMfaEnrollment({
      enrollmentToken: "enroll-token",
      factorId: "mfa_1",
      otpCode: "123456",
    });
    await getAdminAuthPolicy();
    await logoutAdmin("cookie-session");
    globalThis.sessionStorage.setItem("synapse.admin.csrfToken", "csrf-admin");
    await getDashboardOverview("cookie-session");
    await getSystemStatus("cookie-session");
    await getFinanceOverview("cookie-session");
    await getActivityTrends("cookie-session");
    await getOperationsOverview("cookie-session");
    await getReconciliationDetail("cookie-session");
    await getReconciliationDrilldown("cookie-session", {
      ownerAddress: "0xabc",
    });
    await getForumResponseTask("cookie-session", "task_1");
    await listAuditActions("cookie-session", { limit: 10 });
    await retryExecutionJob("cookie-session", "job_1", "123456");
    await listAdminUsers("cookie-session", { status: "active" });
    await listAdminRoles("cookie-session");
    await listAdminPermissions("cookie-session");
    await createAdminUser("cookie-session", {
      email: "new@synapse-network.ai",
      displayName: "New Admin",
      roleKey: "ops",
      password: "local-password",
      requireMfa: true,
    });
    await updateAdminUser("cookie-session", "adm_new", {
      displayName: "New Admin",
      roleKey: "ops",
      requireMfa: true,
      status: "active",
    });
    await deleteAdminUser("cookie-session", "adm_new");
    await createAdminRole("cookie-session", {
      roleKey: "ops",
      roleName: "Ops",
      status: "active",
      permissions: ["dashboard:read"],
    });
    await updateAdminRole("cookie-session", "ops", {
      roleName: "Ops",
      status: "active",
      permissions: ["dashboard:read"],
    });
    await deleteAdminRole("cookie-session", "ops");
    await getAdminMenuConfig("cookie-session", { stage: "draft" });
    await getVisibleAdminMenuConfig("cookie-session");
    await publishAdminMenuConfig("cookie-session", "123456");

    const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[0]
    );
    expect(urls).toContain("/api/admin/v1/auth/mfa/enroll/begin");
    expect(urls).toContain("/api/admin/v1/auth/mfa/enroll/verify");
    expect(urls).toContain("/api/admin/v1/config/menu-items/publish");
  });

  it("covers withdrawal decision, history, provider force-probe, and provider delete routes", async () => {
    const providerServicePayload = {
      serviceId: "svc_quotes",
      ownerAddress: "0xabc",
      serviceName: "Quotes",
      summary: "Quote endpoint",
      tags: ["quote"],
      pricing: { amount: "1.00", currency: "USDC" },
      controlStatus: "active",
      status: "active",
      isActive: true,
      runtimeStatus: "healthy",
      runtimeAvailable: true,
      probeTier: "standard",
      health: {},
      targets: [],
      adaptiveConcurrencyLimit: 8,
      inFlight: 0,
      queueDepth: 0,
      latencyP95Ms: 10,
      errorRate: 0,
      circuitState: "closed",
      downstreamTargets: [],
      createdAt: "2026-05-01T00:00:00Z",
      updatedAt: "2026-05-01T00:00:00Z",
    };
    queueResponses(
      { items: [] },
      {
        withdrawalId: "wd_1",
        withdrawalKind: null,
        reviewType: null,
        ownerAddress: "0xowner",
        subjectAddress: null,
        status: "APPROVED_AUTO",
      },
      { service: providerServicePayload },
      { status: "active" }
    );

    await listProviderWithdrawReviewHistory("cookie-session", {
      currentStatus: "PENDING_MANUAL_REVIEW",
    });
    const decision = await decideProviderWithdrawReview(
      "cookie-session",
      "wd_1",
      {
        decision: "APPROVE",
        note: "approved",
        otpCode: "123456",
      }
    );
    await forceProbeProviderService("cookie-session", "svc_quotes");
    await deleteProviderService("cookie-session", "svc_quotes", "cleanup");

    expect(decision.withdrawalKind).toBe("provider_withdrawal");
    expect(decision.reviewType).toBe("provider_withdraw_review");
    expect(decision.subjectAddress).toBe("0xowner");
  });

  it("covers menu item mutation routes", async () => {
    queueResponses({ items: [] }, { items: [] }, { items: [] });
    const input = {
      itemId: "finance",
      sectionId: "ops",
      sectionLabel: "Ops",
      sectionDescription: "Operations",
      label: "Finance",
      href: "/finance",
      description: "Finance actions",
      requiredRoles: ["super_admin"],
      requiredPermissions: ["finance:read"],
    };

    await createAdminMenuItem("cookie-session", input);
    await updateAdminMenuItem("cookie-session", "finance", input);
    await deleteAdminMenuItem("cookie-session", "finance");

    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });
});
