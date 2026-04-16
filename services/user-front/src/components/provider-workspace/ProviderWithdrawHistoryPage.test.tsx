// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, configure, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, type ReactNode } from "react";

configure({ reactStrictMode: false });

import ProviderWithdrawHistoryPage from "@/components/provider-workspace/ProviderWithdrawHistoryPage";

/* ── hoisted mocks ─────────────────────────────────────────── */

const { connectModalMock, reloadDashboardMock } = vi.hoisted(() => ({
  connectModalMock: vi.fn(),
  reloadDashboardMock: vi.fn(),
}));

const TRANSLATIONS: Record<string, string> = {
  "providerSettlements.backToWithdraw": "Back to Withdraw",
  "providerSettlements.invocationRecordsTitle": "Invocation Records",
  "providerSettlements.invocationRecordsDescription": "Settlement events from provider service invocations.",
  "providerSettlements.searchRequestPlaceholder": "Search Request ID",
  "providerSettlements.searchServicePlaceholder": "Search Service",
  "providerSettlements.searchButton": "Search",
  "providerSettlements.summaryNetEarned": "Net Earned",
  "providerSettlements.summaryGrossEarnings": "Gross Earnings",
  "providerSettlements.summaryProtocolFee": "Protocol Fee",
  "providerSettlements.summaryRoutingTax": "Routing Tax",
  "providerSettlements.eventsTableRequestId": "Request ID",
  "providerSettlements.eventsTableService": "Service",
  "providerSettlements.eventsTableGross": "Gross",
  "providerSettlements.eventsTableProtocolFee": "Protocol Fee (col)",
  "providerSettlements.eventsTableRoutingTax": "Routing Tax (col)",
  "providerSettlements.eventsTableNet": "Net",
  "providerSettlements.eventsTableCallTime": "Call Time",
  "providerSettlements.eventsTableEmpty": "No invocation records yet.",
  "providerSettlements.unknownService": "unknown",
  "providerSettlements.paginationPrev": "Prev",
  "providerSettlements.paginationNext": "Next",
};

function buildEvent(overrides: Record<string, unknown> = {}) {
  return {
    txHash: "0xaaa111",
    blockNumber: 100,
    serviceId: "svc-gpt",
    amount: 1.5,
    fee: 0.15,
    routingTax: 0.05,
    timestamp: Math.floor(Date.now() / 1000) - 300,
    ...overrides,
  };
}

let paidEventsMock: ReturnType<typeof buildEvent>[] = [];

vi.mock("@/components/i18n/LanguageProvider", () => {
  const tFn = (key: string, vars?: Record<string, string | number>) => {
    let text = TRANSLATIONS[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{{${k}}}`, String(v));
      }
    }
    return text;
  };
  return {
    useLanguage: () => ({
      lang: "en",
      t: tFn,
    }),
  };
});

vi.mock("@/hooks/useDashboardData", () => ({
  useDashboardData: () => ({
    providerStats: {
      totalApiCalls: 0,
      totalEarned: 50.0,
      totalFees: 5.0,
      totalRoutingTax: 1.0,
      netEarned: 44.0,
      receivable: 12.5,
      paidCount24h: 0,
      duplicateRowsDropped: 0,
    },
    paidEvents: paidEventsMock,
    handleRefresh: reloadDashboardMock,
  }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xabc", isConnected: true }),
}));

vi.mock("@rainbow-me/rainbowkit", () => ({
  useConnectModal: () => ({ openConnectModal: connectModalMock }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => {
    return createElement("a", { href, ...rest }, children);
  },
}));

/* ── helpers ───────────────────────────────────────────────── */

function renderPage() {
  return render(<ProviderWithdrawHistoryPage />);
}

/* ── tests ─────────────────────────────────────────────────── */

describe("ProviderWithdrawHistoryPage (Invocation Records)", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    paidEventsMock = [];
  });

  /* ── Header ──────────────────────────────────────────────── */

  it("renders page title with Database icon", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /Invocation Records/i })).toBeTruthy();
  });

  it("renders back link to /provider/withdraw", () => {
    renderPage();
    const link = screen.getByText(/Back to Withdraw/i).closest("a") as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/provider/withdraw");
  });

  /* ── Summary cards ───────────────────────────────────────── */

  it("renders 4 summary cards with correct values", () => {
    renderPage();
    expect(screen.getByText("44.0000 USDC")).toBeTruthy();
    expect(screen.getByText("50.0000 USDC")).toBeTruthy();
    expect(screen.getByText("5.0000 USDC")).toBeTruthy();
    expect(screen.getByText("1.0000 USDC")).toBeTruthy();
  });

  /* ── Search bar ──────────────────────────────────────────── */

  it("renders request and service search inputs", () => {
    renderPage();
    expect(screen.getByPlaceholderText(/Request ID/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/Service/i)).toBeTruthy();
  });

  it("renders search button", () => {
    renderPage();
    expect(screen.getByRole("button", { name: /Search/i })).toBeTruthy();
  });

  /* ── Empty state ─────────────────────────────────────────── */

  it("shows empty state when no events", () => {
    renderPage();
    expect(screen.getByText(/No invocation records/i)).toBeTruthy();
  });

  /* ── Table columns ───────────────────────────────────────── */

  it("renders all expected table column headers", () => {
    paidEventsMock = [buildEvent()];
    renderPage();
    expect(screen.getByText(/Request ID/i)).toBeTruthy();
    expect(screen.getByText(/Service/)).toBeTruthy();
    expect(screen.getByText("Gross")).toBeTruthy();
    expect(screen.getByText("Protocol Fee (col)")).toBeTruthy();
    expect(screen.getByText("Routing Tax (col)")).toBeTruthy();
    expect(screen.getByText("Net")).toBeTruthy();
    expect(screen.getByText(/Call Time/i)).toBeTruthy();
  });

  /* ── Data rendering ──────────────────────────────────────── */

  it("renders event data in the table", () => {
    paidEventsMock = [
      buildEvent({ txHash: "0xaaa111", serviceId: "svc-gpt", amount: 1.5, fee: 0.15, routingTax: 0.05 }),
    ];
    renderPage();
    expect(screen.getByText("0xaaa111")).toBeTruthy();
    expect(screen.getByText("svc-gpt")).toBeTruthy();
    expect(screen.getByText("1.5000")).toBeTruthy();
    expect(screen.getByText("0.1500")).toBeTruthy();
    expect(screen.getByText("0.0500")).toBeTruthy();
    expect(screen.getByText("1.3500")).toBeTruthy();
  });

  /* ── Search filtering ────────────────────────────────────── */

  it("filters by request ID after clicking search", async () => {
    const user = userEvent.setup();
    paidEventsMock = [
      buildEvent({ txHash: "0xaaa111" }),
      buildEvent({ txHash: "0xbbb222", blockNumber: 101 }),
    ];
    renderPage();
    expect(screen.getByText("0xaaa111")).toBeTruthy();
    expect(screen.getByText("0xbbb222")).toBeTruthy();

    const input = screen.getByPlaceholderText(/Request ID/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "aaa");
    await user.click(screen.getByRole("button", { name: /Search/i }));

    await waitFor(() => {
      expect(screen.getByText("0xaaa111")).toBeTruthy();
      expect(screen.queryByText("0xbbb222")).toBeNull();
    });
  });

  it("filters by service name", async () => {
    const user = userEvent.setup();
    paidEventsMock = [
      buildEvent({ txHash: "0xaa1", blockNumber: 1, serviceId: "svc-gpt" }),
      buildEvent({ txHash: "0xbb2", blockNumber: 2, serviceId: "svc-dalle" }),
    ];
    renderPage();
    expect(screen.getByText("0xaa1")).toBeTruthy();

    const svcInput = screen.getByPlaceholderText(/Service/i) as HTMLInputElement;
    await user.clear(svcInput);
    await user.type(svcInput, "dalle");
    await user.click(screen.getByRole("button", { name: /Search/i }));

    await waitFor(() => {
      expect(screen.getByText("0xbb2")).toBeTruthy();
      expect(screen.queryByText("0xaa1")).toBeNull();
    });
  });

  /* ── Pagination ──────────────────────────────────────────── */

  it("paginates at 10 rows per page", () => {
    paidEventsMock = Array.from({ length: 25 }, (_, i) =>
      buildEvent({ txHash: `0x${String(i).padStart(4, "0")}`, blockNumber: i }),
    );
    renderPage();
    expect(screen.getByText("1 / 3")).toBeTruthy();
    const rows = document.querySelectorAll("tbody tr");
    expect(rows.length).toBe(10);
  });

  it("navigates to next and previous pages", async () => {
    const user = userEvent.setup();
    paidEventsMock = Array.from({ length: 15 }, (_, i) =>
      buildEvent({ txHash: `0xp${String(i).padStart(3, "0")}`, blockNumber: i }),
    );
    renderPage();
    expect(screen.getByText("1 / 2")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Next/i }));
    await waitFor(() => expect(screen.getByText("2 / 2")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: /Previous|Prev/i }));
    await waitFor(() => expect(screen.getByText("1 / 2")).toBeTruthy());
  });

  /* ── Enter key triggers search ───────────────────────────── */

  it("triggers search on Enter key press in request input", async () => {
    const user = userEvent.setup();
    paidEventsMock = [
      buildEvent({ txHash: "0xenter1" }),
      buildEvent({ txHash: "0xenter2", blockNumber: 2 }),
    ];
    renderPage();
    const input = screen.getByPlaceholderText(/Request ID/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "enter1{Enter}");

    await waitFor(() => {
      expect(screen.getByText("0xenter1")).toBeTruthy();
      expect(screen.queryByText("0xenter2")).toBeNull();
    });
  });
});
