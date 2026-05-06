// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";

import DashboardAuditPage from "@/components/dashboard-workspace/DashboardAuditPage";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY } from "@/i18n/config";

const { buildAuthedHeadersMock, getGatewayBaseUrlMock } = vi.hoisted(() => ({
  buildAuthedHeadersMock: vi.fn(() => ({ Authorization: "Bearer test" })),
  getGatewayBaseUrlMock: vi.fn(() => "http://gateway.test"),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0x82f1c188327bfc265357a85e8a6b4a34d562d6f8",
    isConnected: true,
  }),
}));

vi.mock("@/components/WalletAuthGuard", () => ({
  useAuth: () => ({
    isSessionAuthenticated: true,
  }),
}));

vi.mock("@/utils/authSession", () => ({
  buildAuthedHeaders: buildAuthedHeadersMock,
}));

vi.mock("@/utils/gatewayApi", () => ({
  getGatewayBaseUrl: getGatewayBaseUrlMock,
}));

const riskOverviewResponse = {
  overview: {
    systemIntegrity: { level: "green", anomalyCount24h: 0 },
    pendingReviews: { level: "green", count: 0 },
    alerts: [],
  },
};

function mockAuditLogs(logs: unknown[]) {
  const fetchMock = vi.fn((url: string | URL | Request) => {
    const target = String(url);
    if (target.includes("/api/v1/finance/risk-overview")) {
      return Promise.resolve({
        ok: true,
        json: async () => riskOverviewResponse,
      } as Response);
    }
    if (target.includes("/api/v1/finance/audit-logs")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ logs }),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${target}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPage() {
  return render(
    createElement(LanguageProvider, null, createElement(DashboardAuditPage))
  );
}

describe("DashboardAuditPage audit amount display", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.localStorage.setItem(I18N_STORAGE_KEY, "en");
  });

  it("renders withdrawal and provider audit amounts from normalized detail fields", async () => {
    mockAuditLogs([
      {
        id: "audit-provider-withdraw",
        timestamp: Math.floor(Date.now() / 1000) - 120,
        action: "PROVIDER_WITHDRAW_INTENT_CREATED",
        domain: "finance",
        ownerAddress: "0x82f1c188327bfc265357a85e8a6b4a34d562d6f8",
        details: {
          requestedAmountUsdc: "12.600000",
        },
      },
      {
        id: "audit-consumer-withdraw",
        timestamp: Math.floor(Date.now() / 1000) - 300,
        action: "CONSUMER_WITHDRAW_INTENT_CREATED",
        domain: "finance",
        ownerAddress: "0x82f1c188327bfc265357a85e8a6b4a34d562d6f8",
        details: {
          withdraw_amount_usdc: "8.50",
        },
      },
      {
        id: "audit-provider-release",
        timestamp: Math.floor(Date.now() / 1000) - 600,
        action: "PROVIDER_WITHDRAW_CANCELLED",
        domain: "finance",
        ownerAddress: "0x82f1c188327bfc265357a85e8a6b4a34d562d6f8",
        details: {
          releasedAmountUsdc: "5.000000",
        },
      },
    ]);

    renderPage();

    expect(await screen.findByText("$12.60")).toBeTruthy();
    expect(screen.getByText("$8.50")).toBeTruthy();
    expect(screen.getByText("$5.00")).toBeTruthy();
  });

  it("renders top-level and balance-diff audit amounts instead of falling back to a dash", async () => {
    mockAuditLogs([
      {
        id: "audit-refund-completed",
        timestamp: Math.floor(Date.now() / 1000) - 120,
        action: "REFUND_INTENT_COMPLETED",
        domain: "finance",
        ownerAddress: "0x82f1c188327bfc265357a85e8a6b4a34d562d6f8",
        amountDelta: "-10.000000",
        details: {},
      },
      {
        id: "audit-balance-diff",
        timestamp: Math.floor(Date.now() / 1000) - 300,
        action: "CONSUMER_DEPOSIT_CONFIRMED",
        domain: "finance",
        ownerAddress: "0x82f1c188327bfc265357a85e8a6b4a34d562d6f8",
        details: {
          before_balance: 40,
          after_balance: "65.000000",
        },
      },
    ]);

    renderPage();

    expect(await screen.findByText("$10.00")).toBeTruthy();
    expect(screen.getByText("$25.00")).toBeTruthy();
  });

  it("keeps a dash only when the audit row has no amount evidence", async () => {
    mockAuditLogs([
      {
        id: "audit-no-amount",
        timestamp: Math.floor(Date.now() / 1000) - 120,
        action: "UNKNOWN_AUDIT_EVENT",
        domain: "finance",
        ownerAddress: "0x82f1c188327bfc265357a85e8a6b4a34d562d6f8",
        details: {
          note: "health-only audit event",
        },
      },
    ]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Unknown Audit Event")).toBeTruthy();
    });
    expect(screen.getByText("—")).toBeTruthy();
  });
});
