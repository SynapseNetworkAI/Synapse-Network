// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";

import OwnerBillingPage from "@/components/dashboard-workspace/OwnerBillingPage";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY } from "@/i18n/config";

const { useFundsDataMock } = vi.hoisted(() => ({
  useFundsDataMock: vi.fn(),
}));

vi.mock("@/hooks/useFundsData", () => ({
  useFundsData: () => useFundsDataMock(),
}));

describe("OwnerBillingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.localStorage.setItem(I18N_STORAGE_KEY, "en");
    useFundsDataMock.mockReturnValue({
      loading: false,
      records: [
        {
          id: "abc123456789",
          type: "Refund",
          amount: 5,
          txHash: "0xdeadbeef",
          timestamp: new Date("2026-03-31T02:52:00Z").getTime(),
          status: "COMPLETED",
        },
      ],
    });
  });

  it("renders the x-style payments ledger surface", () => {
    render(
      createElement(LanguageProvider, null, createElement(OwnerBillingPage))
    );

    expect(screen.getByRole("heading", { name: "Payments" })).toBeTruthy();
    expect(
      screen.getByText("View all billing transactions and payment history for your account")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "FROM" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "TO" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset to last 3 months" })).toBeTruthy();
    expect(screen.getByText("Voucher")).toBeTruthy();
    expect(screen.getByText("$5.00")).toBeTruthy();
  });

  it("renders payment timestamps in fixed YYYY-MM-DD HH:mm:ss format", () => {
    useFundsDataMock.mockReturnValue({
      loading: false,
      records: [
        {
          id: "abc123456789",
          type: "Deposit",
          amount: 20,
          txHash: "0xbeadfeed",
          timestamp: new Date(2026, 3, 8, 10, 56, 0).getTime(),
          status: "COMPLETED",
        },
      ],
    });

    render(
      createElement(LanguageProvider, null, createElement(OwnerBillingPage))
    );

    expect(screen.getByText("2026-04-08 10:56:00")).toBeTruthy();
  });
});
