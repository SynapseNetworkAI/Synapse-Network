// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";

import OwnerBillingPage from "@/components/dashboard-workspace/OwnerBillingPage";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY } from "@/i18n/config";

const { useFundsDataMock } = vi.hoisted(() => ({
  useFundsDataMock: vi.fn(),
}));

const { toastSuccessMock, clipboardWriteTextMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  clipboardWriteTextMock: vi.fn(),
}));

vi.mock("@/hooks/useFundsData", () => ({
  useFundsData: () => useFundsDataMock(),
}));

vi.mock("react-hot-toast", () => ({
  default: {
    success: toastSuccessMock,
    error: vi.fn(),
  },
}));

describe("OwnerBillingPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteTextMock },
    });
    clipboardWriteTextMock.mockResolvedValue(undefined);
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
      screen.getByText(
        "View all billing transactions and payment history for your account"
      )
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "FROM" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "TO" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Reset to last 3 months" })
    ).toBeTruthy();
    expect(screen.getByText("Voucher")).toBeTruthy();
    expect(screen.getByText("$5.00")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
  });

  it("copies the full transaction id while showing the short id", async () => {
    render(
      createElement(LanguageProvider, null, createElement(OwnerBillingPage))
    );

    expect(screen.getByText("ab...6789")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Copy Transaction ID" })
    );

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith("abc123456789");
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Transaction ID copied");
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

  it("renders pending deposit rows as Pending until Gateway confirmation", () => {
    useFundsDataMock.mockReturnValue({
      loading: false,
      records: [
        {
          id: "deposit-pending-1",
          type: "Deposit",
          amount: 100,
          txHash: "0xbeadfeed",
          timestamp: new Date(2026, 4, 4, 12, 14, 24).getTime(),
          status: "PENDING",
        },
      ],
    });

    render(
      createElement(LanguageProvider, null, createElement(OwnerBillingPage))
    );

    expect(screen.getByText("Pending / Syncing")).toBeTruthy();
    expect(screen.queryByText("Completed")).toBeNull();
    expect(screen.getByText("$100.00")).toBeTruthy();
  });

  it("renders pending withdrawal rows as withdrawal processing, not deposit syncing", () => {
    useFundsDataMock.mockReturnValue({
      loading: false,
      records: [
        {
          id: "withdraw-pending-1",
          type: "Withdraw",
          amount: 185.99,
          txHash: null,
          timestamp: new Date(2026, 4, 5, 8, 9, 59).getTime(),
          status: "PENDING",
        },
      ],
    });

    render(
      createElement(LanguageProvider, null, createElement(OwnerBillingPage))
    );

    expect(screen.getByText("Withdrawal processing")).toBeTruthy();
    expect(screen.queryByText("Pending / Syncing")).toBeNull();
    expect(screen.getByText("$185.99")).toBeTruthy();
  });

  it("renders pending withdrawal copy in Chinese", () => {
    globalThis.localStorage.setItem(I18N_STORAGE_KEY, "zh");
    useFundsDataMock.mockReturnValue({
      loading: false,
      records: [
        {
          id: "withdraw-pending-cn-1",
          type: "Withdraw",
          amount: 185.99,
          txHash: null,
          timestamp: new Date(2026, 4, 5, 8, 9, 59).getTime(),
          status: "PENDING",
        },
      ],
    });

    render(
      createElement(LanguageProvider, null, createElement(OwnerBillingPage))
    );

    expect(screen.getByText("提现处理中")).toBeTruthy();
    expect(screen.queryByText("同步中")).toBeNull();
  });
});
