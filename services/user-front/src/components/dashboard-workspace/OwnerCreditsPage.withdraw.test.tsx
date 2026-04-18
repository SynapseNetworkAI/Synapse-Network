// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";

import OwnerCreditsPage, { WithdrawBalanceModal } from "@/components/dashboard-workspace/OwnerCreditsPage";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY } from "@/i18n/config";

const {
  authorizeMock,
  getOwnerSpendingLimitMock,
  listConsumerWithdrawalsMock,
  ownerBalanceState,
  requestConsumerWithdrawMock,
  handleRefreshMock,
  toastSuccessMock,
  toastErrorMock,
  completeV2RefundMock,
  failV2RefundMock,
} = vi.hoisted(() => ({
  authorizeMock: vi.fn(async () => true),
  getOwnerSpendingLimitMock: vi.fn(),
  listConsumerWithdrawalsMock: vi.fn(),
  ownerBalanceState: { value: "20" },
  requestConsumerWithdrawMock: vi.fn(),
  handleRefreshMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  completeV2RefundMock: vi.fn(),
  failV2RefundMock: vi.fn(),
}));

vi.mock("@rainbow-me/rainbowkit", () => ({
  useConnectModal: () => ({ openConnectModal: vi.fn() }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xabc", isConnected: true }),
  useChainId: () => 11155111,
  useWriteContract: () => ({
    data: undefined,
    writeContractAsync: vi.fn(),
  }),
  useWaitForTransactionReceipt: () => ({
    isSuccess: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("@/components/WalletAuthGuard", () => ({
  useAuth: () => ({
    isSessionAuthenticated: true,
    authorize: authorizeMock,
  }),
}));

vi.mock("@/hooks/useOwnerData", () => ({
  useOwnerData: () => ({
    stats: { ownerBalance: ownerBalanceState.value },
    handleRefresh: handleRefreshMock,
    isBootstrapping: false,
  }),
}));

vi.mock("@/hooks/useVaultDeposit", () => ({
  useVaultDeposit: () => ({
    isOpen: false,
    openModal: vi.fn(),
    closeModal: vi.fn(),
    depositAmount: "0",
    setDepositAmount: vi.fn(),
    depositError: null,
    depositStep: "input",
    handleDeposit: vi.fn(),
    isPending: false,
    isConfirming: false,
    walletUsdcBalance: "0",
    vaultAddress: "0xvault",
    walletAddress: "0xabc",
    shortAddress: "0xabc",
  }),
}));

vi.mock("react-hot-toast", () => ({
  default: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

vi.mock("@/utils/balanceApi", async () => {
  const actual = await vi.importActual<typeof import("@/utils/balanceApi")>(
    "@/utils/balanceApi"
  );
  return {
    ...actual,
    getOwnerSpendingLimit: getOwnerSpendingLimitMock,
    listConsumerWithdrawals: listConsumerWithdrawalsMock,
    requestConsumerWithdraw: requestConsumerWithdrawMock,
    completeV2Refund: completeV2RefundMock,
    failV2Refund: failV2RefundMock,
  };
});

const requestTicket = {
  amount: "42000000000000000000",
  fee: "500000000000000000",
  nonce: 1,
  deadline: 9999999999,
  signature: "0xabc123",
  chainId: 11155111,
  contractAddress: "0x0000000000000000000000000000000000000001",
};

const spendingLimitDefault = {
  ownerAddress: "0xabc",
  spendingLimitUsdc: null,
  allowUnlimited: true,
  cycleInterval: "monthly",
  currentCycleSpendUsdc: 0,
  remainingSpendUsdc: null,
  updatedAt: null,
};

function renderPage() {
  return render(
    createElement(LanguageProvider, null, createElement(OwnerCreditsPage))
  );
}

function renderWithdrawModal(overrides: { availableBalance?: number } = {}) {
  const onClose = vi.fn();
  const onSuccess = vi.fn().mockResolvedValue(undefined);
  render(
    createElement(WithdrawBalanceModal, {
      availableBalance: overrides.availableBalance ?? 20,
      userAddress: "0xabc",
      onClose,
      onSuccess,
    }),
  );
  return { onClose, onSuccess };
}

describe("OwnerCreditsPage — Withdraw", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    ownerBalanceState.value = "20";
    globalThis.localStorage.setItem(I18N_STORAGE_KEY, "en");
    globalThis.sessionStorage.clear();
    getOwnerSpendingLimitMock.mockResolvedValue(spendingLimitDefault);
    listConsumerWithdrawalsMock.mockResolvedValue([]);
  });

  it("shows the Withdraw button and the current balance", async () => {
    renderPage();

    await screen.findByRole("button", { name: "Withdraw" });
    expect(screen.getAllByText("Remaining balance:").length).toBeGreaterThan(0);
    expect(screen.getByText("$20.00")).toBeTruthy();
  });

  it("opens withdraw modal when Withdraw button is clicked", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("button", { name: "Withdraw" });
    await user.click(screen.getByRole("button", { name: /^withdraw$/i }));

    expect(
      await screen.findByRole("heading", { name: "Withdraw Balance" })
    ).toBeTruthy();
    expect(screen.getByText(/Available:/)).toBeTruthy();
  });

  it("pre-fills the amount field with the full available balance", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("button", { name: "Withdraw" });
    await user.click(screen.getByRole("button", { name: /^withdraw$/i }));

    await screen.findByRole("heading", { name: "Withdraw Balance" });
    const amountInput = screen.getByRole("spinbutton");
    expect((amountInput as HTMLInputElement).value).toBe("20.00");
  });

  it("calls requestConsumerWithdraw with correct args on submit", async () => {
    const user = userEvent.setup();
    requestConsumerWithdrawMock.mockResolvedValue({
      withdrawId: "wd-req-1",
      status: "REQUESTED",
      amountUsdc: 20,
      netUsdc: 19.5,
      riskReasonCode: null,
      ticket: requestTicket,
    });
    handleRefreshMock.mockResolvedValue(undefined);

    renderPage();

    await screen.findByRole("button", { name: "Withdraw" });
    await user.click(screen.getByRole("button", { name: /^withdraw$/i }));
    await screen.findByRole("heading", { name: "Withdraw Balance" });

    const withdrawButtons = screen.getAllByRole("button", {
      name: /^withdraw$/i,
    });
    // The last "Withdraw" button is inside the modal
    await user.click(withdrawButtons.at(-1)!);

    await waitFor(() => {
      expect(requestConsumerWithdrawMock).toHaveBeenCalledWith("0xabc", {
        amountUsdc: "20",
        reason: undefined,
      });
    });
  });

  it("calls handleRefresh after a successful withdrawal", async () => {
    const user = userEvent.setup();
    requestConsumerWithdrawMock.mockResolvedValue({
      withdrawId: "wd-1",
      status: "REQUESTED",
      amountUsdc: 20,
      netUsdc: 19.5,
      riskReasonCode: null,
      ticket: requestTicket,
    });
    handleRefreshMock.mockResolvedValue(undefined);

    renderPage();

    await screen.findByRole("button", { name: "Withdraw" });
    await user.click(screen.getByRole("button", { name: /^withdraw$/i }));
    await screen.findByRole("heading", { name: "Withdraw Balance" });

    const withdrawButtons = screen.getAllByRole("button", { name: /^withdraw$/i });
    await user.click(withdrawButtons.at(-1)!);

    await waitFor(() => {
      expect(handleRefreshMock).toHaveBeenCalled();
    });
  });

  it("submits a manual-review withdrawal and closes the modal on success", async () => {
    const user = userEvent.setup();
    requestConsumerWithdrawMock.mockResolvedValue({
      withdrawId: "wd-success",
      status: "PENDING_MANUAL_REVIEW",
      amountUsdc: 600,
      netUsdc: 599.5,
      riskReasonCode: "HIGH_AMOUNT",
    });

    const { onClose, onSuccess } = renderWithdrawModal();
    const withdrawButtons = screen.getAllByRole("button", { name: /^withdraw$/i });
    await user.click(withdrawButtons.at(-1)!);

    await waitFor(() => {
      expect(requestConsumerWithdrawMock).toHaveBeenCalledWith("0xabc", {
        amountUsdc: "20",
        reason: undefined,
      });
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("shows a success toast with the withdrawn amount", async () => {
    const user = userEvent.setup();
    requestConsumerWithdrawMock.mockResolvedValue({
      withdrawId: "wd-2",
      status: "REQUESTED",
      amountUsdc: 42.5,
      netUsdc: 42,
      riskReasonCode: null,
      ticket: requestTicket,
    });

    renderWithdrawModal();

    const withdrawButtons = screen.getAllByRole("button", { name: /^withdraw$/i });
    await user.click(withdrawButtons.at(-1)!);

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith(
        expect.stringContaining("Transaction submitted")
      );
    });
  });

  it("shows pending_manual_review toast for large withdrawals", async () => {
    const user = userEvent.setup();
    requestConsumerWithdrawMock.mockResolvedValue({
      withdrawId: "wd-review",
      status: "PENDING_MANUAL_REVIEW",
      amountUsdc: 500,
      riskReasonCode: "HIGH_AMOUNT",
    });

    renderWithdrawModal();

    const withdrawButtons = screen.getAllByRole("button", { name: /^withdraw$/i });
    await user.click(withdrawButtons.at(-1)!);

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith(
        expect.stringContaining("under review")
      );
    });
  });

  it("shows an error toast when withdrawal API fails", async () => {
    const user = userEvent.setup();
    requestConsumerWithdrawMock.mockRejectedValue(
      new Error("Insufficient balance")
    );

    renderWithdrawModal();

    const withdrawButtons = screen.getAllByRole("button", { name: /^withdraw$/i });
    await user.click(withdrawButtons.at(-1)!);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Insufficient balance");
    });
  });

  it("does not call requestConsumerWithdraw when amount is zero", async () => {
    const user = userEvent.setup();

    renderWithdrawModal();

    const amountInput = screen.getByRole("spinbutton");
    await user.clear(amountInput);
    await user.type(amountInput, "0");

    const withdrawButtons = screen.getAllByRole("button", { name: /^withdraw$/i });
    await user.click(withdrawButtons.at(-1)!);

    expect(requestConsumerWithdrawMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("Enter a valid amount.");
  });
});
