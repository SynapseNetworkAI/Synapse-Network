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
  PAYMENTS_RENDER_LIMIT: 50,
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
      paymentHistoryMayBeTruncated: false,
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
    expect(screen.getByText("Type")).toBeTruthy();
    expect(screen.getByText("Voucher")).toBeTruthy();
    expect(
      screen.getByText(
        "Network gas is paid by your wallet in the chain's native token. Use the explorer link to inspect gas details."
      )
    ).toBeTruthy();
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
      paymentHistoryMayBeTruncated: false,
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
      paymentHistoryMayBeTruncated: false,
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
      paymentHistoryMayBeTruncated: false,
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
      paymentHistoryMayBeTruncated: false,
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

  it("renders payment table labels, action types, and date picker controls in Chinese", () => {
    globalThis.localStorage.setItem(I18N_STORAGE_KEY, "zh");
    useFundsDataMock.mockReturnValue({
      loading: false,
      paymentHistoryMayBeTruncated: false,
      records: [
        {
          id: "deposit-cn-1",
          type: "Deposit",
          amount: 100,
          txHash: "0xbeadfeed",
          timestamp: new Date(2026, 4, 4, 12, 14, 24).getTime(),
          status: "COMPLETED",
        },
        {
          id: "withdraw-cn-1",
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

    expect(screen.getByRole("button", { name: "开始日期" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "结束日期" })).toBeTruthy();
    expect(screen.getByText("交易 ID")).toBeTruthy();
    expect(screen.getByText("类型")).toBeTruthy();
    expect(screen.getByText("支付方式")).toBeTruthy();
    expect(screen.getByText("金额")).toBeTruthy();
    expect(screen.getByText("日期")).toBeTruthy();
    expect(screen.getByText("凭证")).toBeTruthy();
    expect(screen.getByText("充值")).toBeTruthy();
    expect(screen.getByText("提现")).toBeTruthy();
    expect(screen.getAllByText("钱包")).toHaveLength(2);
    expect(
      screen.getByText(
        "链上网络费由你的钱包以原生代币支付，可通过区块浏览器查看具体 gas 明细。"
      )
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "开始日期" }));

    expect(screen.getByRole("button", { name: "上个月" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "下个月" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "今天" })).toBeTruthy();
  });

  it("renders only the latest 50 payment rows and shows the export hint", () => {
    useFundsDataMock.mockReturnValue({
      loading: false,
      paymentHistoryMayBeTruncated: true,
      records: Array.from({ length: 51 }, (_, index) => ({
        id: `row-${String(index).padStart(2, "0")}`,
        type: "Deposit",
        amount: index + 1,
        txHash: null,
        timestamp: new Date(2026, 4, 5, 12, 0, 0).getTime() - index,
        status: "COMPLETED",
      })),
    });

    render(
      createElement(LanguageProvider, null, createElement(OwnerBillingPage))
    );

    expect(screen.getByText("row-00")).toBeTruthy();
    expect(screen.getByText("row-49")).toBeTruthy();
    expect(screen.queryByText("row-50")).toBeNull();
    expect(
      screen.getByText(
        "Showing the latest 50 records. Contact support if you need a full export."
      )
    ).toBeTruthy();
  });
});
