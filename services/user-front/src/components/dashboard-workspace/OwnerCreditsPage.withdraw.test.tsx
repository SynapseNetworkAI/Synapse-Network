// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";

import ConsumerWithdrawPage from "@/components/dashboard-workspace/ConsumerWithdrawPage";
import { WithdrawBalanceModal } from "@/components/dashboard-workspace/OwnerCreditsPage";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY } from "@/i18n/config";
import { ConsumerWithdrawApiError } from "@/utils/balanceApi";

const {
  authorizeMock,
  getOwnerSpendingLimitMock,
  listConsumerWithdrawalsMock,
  ownerBalanceState,
  withdrawableBalanceState,
  requestConsumerWithdrawMock,
  handleRefreshMock,
  toastSuccessMock,
  toastErrorMock,
  completeV2RefundMock,
  failV2RefundMock,
  writeContractAsyncMock,
} = vi.hoisted(() => ({
  authorizeMock: vi.fn(async () => true),
  getOwnerSpendingLimitMock: vi.fn(),
  listConsumerWithdrawalsMock: vi.fn(),
  ownerBalanceState: { value: "20" },
  withdrawableBalanceState: { value: "20" },
  requestConsumerWithdrawMock: vi.fn(),
  handleRefreshMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  completeV2RefundMock: vi.fn(),
  failV2RefundMock: vi.fn(),
  writeContractAsyncMock: vi.fn(),
}));

vi.mock("@rainbow-me/rainbowkit", () => ({
  useConnectModal: () => ({ openConnectModal: vi.fn() }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xabc", isConnected: true }),
  useChainId: () => 11155111,
  useWriteContract: () => ({
    data: undefined,
    writeContractAsync: writeContractAsyncMock,
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
    stats: {
      ownerBalance: ownerBalanceState.value,
      consumerAvailableBalance: ownerBalanceState.value,
      consumerWithdrawableBalance: withdrawableBalanceState.value,
      consumerPendingBalance: "0",
      consumerFrozenBalance: "0",
      consumerWithdrawMinUsdc: "10.00",
      consumerWithdrawMaturitySeconds: 604800,
    },
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
  ticketId:
    "0xabc0000000000000000000000000000000000000000000000000000000000000",
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
    createElement(LanguageProvider, null, createElement(ConsumerWithdrawPage))
  );
}

function renderWithdrawModal(
  overrides: {
    availableBalance?: number;
    withdrawableBalance?: number;
    minWithdrawAmount?: number;
    existingWithdrawal?: {
      id: string;
      amountUsdc: string;
      status: string;
      ticket?: typeof requestTicket;
    };
  } = {}
) {
  const onClose = vi.fn();
  const onSuccess = vi.fn().mockResolvedValue(undefined);
  render(
    createElement(
      LanguageProvider,
      null,
      createElement(WithdrawBalanceModal, {
        availableBalance: overrides.availableBalance ?? 20,
        withdrawableBalance:
          overrides.withdrawableBalance ?? overrides.availableBalance ?? 20,
        minWithdrawAmount: overrides.minWithdrawAmount ?? 10,
        userAddress: "0xabc",
        existingWithdrawal: overrides.existingWithdrawal ?? null,
        onClose,
        onSuccess,
      })
    )
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
    withdrawableBalanceState.value = "20";
    globalThis.localStorage.setItem(I18N_STORAGE_KEY, "en");
    globalThis.sessionStorage.clear();
    getOwnerSpendingLimitMock.mockResolvedValue(spendingLimitDefault);
    listConsumerWithdrawalsMock.mockResolvedValue([]);
  });

  it("shows the standalone withdraw page and current balances", async () => {
    renderPage();

    await screen.findByRole("heading", { name: "Withdraw" });
    expect(screen.getAllByText("Withdrawable credits").length).toBeGreaterThan(
      0
    );
    expect(screen.queryByText("Spendable credits")).toBeNull();
    expect(
      screen.getAllByText("Withdrawal processing credits").length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("$20.00").length).toBeGreaterThan(0);
  });

  it("opens the withdraw flow in a modal from the standalone page", async () => {
    const user = userEvent.setup();
    renderPage();

    const openButton = await screen.findByRole("button", { name: "Withdraw" });
    expect(
      screen.queryByRole("heading", { name: "Withdraw Balance" })
    ).toBeNull();

    await user.click(openButton);

    expect(
      await screen.findByRole("heading", { name: "Withdraw Balance" })
    ).toBeTruthy();
    expect(screen.getByText(/Withdrawable:/)).toBeTruthy();
  });

  it("shows manual review state instead of a new withdraw form", async () => {
    listConsumerWithdrawalsMock.mockResolvedValue([
      {
        id: "cw-review",
        amountUsdc: "500.00",
        status: "PENDING_MANUAL_REVIEW",
      },
    ]);

    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Withdrawal in progress" })
    ).toBeTruthy();
    expect(
      screen.getByText(
        "This withdrawal is under security review. We will update the status when review is complete."
      )
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Withdraw Balance" })
    ).toBeNull();
  });

  it("continues an approved withdrawal from the standalone page", async () => {
    const user = userEvent.setup();
    listConsumerWithdrawalsMock.mockResolvedValue([
      {
        id: "cw-approved",
        amountUsdc: "501.00",
        status: "REQUESTED",
        ticket: requestTicket,
      },
    ]);

    renderPage();

    const continueButton = await screen.findByRole("button", {
      name: "Continue Withdrawal",
    });
    expect(
      screen.queryByRole("heading", { name: "Claim Withdrawal" })
    ).toBeNull();

    await user.click(continueButton);

    expect(
      await screen.findByRole("heading", { name: "Claim Withdrawal" })
    ).toBeTruthy();
    expect(
      screen.getAllByText("Claim amount: 501.00 USDC").length
    ).toBeGreaterThan(0);
  });

  it("disables withdrawal and explains maturity gap when withdrawable is below minimum", async () => {
    renderWithdrawModal({ availableBalance: 15, withdrawableBalance: 5 });

    expect(
      screen.getByText(
        "Recent deposits are available for API usage, but require T+7 before withdrawal."
      )
    ).toBeTruthy();
    expect(
      screen.getByText("Minimum withdrawal amount: 10.00 USDC")
    ).toBeTruthy();
    const withdrawButtons = screen.getAllByRole("button", {
      name: /^withdraw$/i,
    });
    expect(withdrawButtons.at(-1)!).toHaveProperty("disabled", true);
  });

  it("disables withdrawal without maturity warning when both balances are below minimum", async () => {
    renderWithdrawModal({ availableBalance: 5, withdrawableBalance: 5 });

    expect(
      screen.queryByText(
        "Recent deposits are available for API usage, but require T+7 before withdrawal."
      )
    ).toBeNull();
    expect(
      screen.getByText("Minimum withdrawal amount: 10.00 USDC")
    ).toBeTruthy();
    const withdrawButtons = screen.getAllByRole("button", {
      name: /^withdraw$/i,
    });
    expect(withdrawButtons.at(-1)!).toHaveProperty("disabled", true);
  });

  it("uses withdrawable balance as max and allows submit when mature funds exceed minimum", async () => {
    renderWithdrawModal({ availableBalance: 20, withdrawableBalance: 15 });

    expect(
      screen.getByText(
        "Recent deposits are available for API usage, but require T+7 before withdrawal."
      )
    ).toBeTruthy();
    const amountInput = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(amountInput.value).toBe("15.00");
    expect(amountInput.getAttribute("max")).toBe("15");
    const withdrawButtons = screen.getAllByRole("button", {
      name: /^withdraw$/i,
    });
    expect(withdrawButtons.at(-1)!).toHaveProperty("disabled", false);
  });

  it("hides maturity warning when spendable and withdrawable balances match", async () => {
    renderWithdrawModal({ availableBalance: 20, withdrawableBalance: 20 });

    expect(
      screen.queryByText(
        "Recent deposits are available for API usage, but require T+7 before withdrawal."
      )
    ).toBeNull();
    const amountInput = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(amountInput.value).toBe("20.00");
    const withdrawButtons = screen.getAllByRole("button", {
      name: /^withdraw$/i,
    });
    expect(withdrawButtons.at(-1)!).toHaveProperty("disabled", false);
  });

  it("shows the maturity gap on the standalone withdraw page", async () => {
    ownerBalanceState.value = "15";
    withdrawableBalanceState.value = "5";
    renderPage();

    expect(
      await screen.findByText(
        "Only matured credits can be withdrawn. Newly deposited credits become withdrawable after the T+7 maturity window."
      )
    ).toBeTruthy();
  });

  it("shows an expiry-safe state instead of continue withdrawal when the ticket is near expiry", async () => {
    listConsumerWithdrawalsMock.mockResolvedValue([
      {
        id: "cw-expiring",
        amountUsdc: "501.00",
        status: "REQUESTED",
        claimable: true,
        ticket: {
          ...requestTicket,
          deadline: Math.floor(Date.now() / 1000) + 60,
        },
      },
    ]);

    renderPage();

    expect(
      await screen.findByRole("heading", {
        name: "Withdrawal approval expiring",
      })
    ).toBeTruthy();
    expect(
      screen.getByText(
        "This withdrawal approval is about to expire. The system will release the funds back to your withdrawable balance after the on-chain safety window passes."
      )
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Continue Withdrawal" })
    ).toBeNull();
  });

  it("pre-fills the amount field with the full available balance", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Withdraw" }));
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

    await user.click(await screen.findByRole("button", { name: "Withdraw" }));
    await screen.findByRole("heading", { name: "Withdraw Balance" });

    const withdrawButtons = screen.getAllByRole("button", {
      name: /^withdraw$/i,
    });
    await user.click(withdrawButtons.at(-1)!);

    await waitFor(() => {
      expect(requestConsumerWithdrawMock).toHaveBeenCalledWith("0xabc", {
        amountUsdc: "20",
        reason: undefined,
      });
    });
  });

  it("continues an approved pending withdrawal using its locked amount", async () => {
    const user = userEvent.setup();
    requestConsumerWithdrawMock.mockResolvedValue({
      withdrawId: "wd-approved",
      status: "REQUESTED",
      amountUsdc: "501",
      netUsdc: "500.5",
      existingWithdrawal: true,
      ticket: requestTicket,
    });

    renderWithdrawModal({
      availableBalance: 499,
      withdrawableBalance: 499,
      existingWithdrawal: {
        id: "wd-approved",
        amountUsdc: "501.00",
        status: "REQUESTED",
        ticket: requestTicket,
      },
    });

    expect(screen.getByText("Claim amount: 501.00 USDC")).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "Continue Withdrawal" })
    );

    await waitFor(() => {
      expect(writeContractAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "withdraw",
        })
      );
    });
    expect(requestConsumerWithdrawMock).not.toHaveBeenCalled();
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

    await user.click(await screen.findByRole("button", { name: "Withdraw" }));
    await screen.findByRole("heading", { name: "Withdraw Balance" });

    const withdrawButtons = screen.getAllByRole("button", {
      name: /^withdraw$/i,
    });
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
    const withdrawButtons = screen.getAllByRole("button", {
      name: /^withdraw$/i,
    });
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

    const withdrawButtons = screen.getAllByRole("button", {
      name: /^withdraw$/i,
    });
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

    const withdrawButtons = screen.getAllByRole("button", {
      name: /^withdraw$/i,
    });
    await user.click(withdrawButtons.at(-1)!);

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith(
        "Withdrawal submitted for security review. We will update the status when review is complete."
      );
    });
  });

  it("shows an error toast when withdrawal API fails", async () => {
    const user = userEvent.setup();
    requestConsumerWithdrawMock.mockRejectedValue(
      new Error("Insufficient balance")
    );

    renderWithdrawModal();

    const withdrawButtons = screen.getAllByRole("button", {
      name: /^withdraw$/i,
    });
    await user.click(withdrawButtons.at(-1)!);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Unable to prepare the withdrawal right now. Please retry in a moment."
      );
    });
  });

  const consumerWithdrawErrorCases = [
    {
      code: "CHAIN_RPC_UNAVAILABLE",
      en: "The withdrawal network is temporarily unavailable. Please retry in a moment.",
      zh: "提现网络服务暂时不可用，请稍后重试。",
    },
    {
      code: "WITHDRAW_CONTRACT_NOT_CONFIGURED",
      en: "Withdrawals are not available in this environment yet.",
      zh: "当前环境暂不支持提现。",
    },
    {
      code: "MIN_WITHDRAWAL_AMOUNT_NOT_MET",
      en: "Minimum consumer withdrawal amount is 10.00 USDC.",
      zh: "Consumer 最小提现金额为 10.00 USDC。",
    },
    {
      code: "AMOUNT_TOO_LOW_FOR_FEE",
      en: "Withdrawal amount must be greater than the platform fee.",
      zh: "提现金额必须大于平台手续费。",
    },
    {
      code: "INSUFFICIENT_CONSUMER_BALANCE",
      en: "Spendable credits are insufficient for this withdrawal.",
      zh: "可用 credits 不足，无法发起本次提现。",
    },
    {
      code: "INSUFFICIENT_MATURE_CONSUMER_BALANCE",
      en: "These funds are not mature yet. Consumer withdrawals require the T+7 matured funds window.",
      zh: "这笔资金尚未成熟。Consumer 提现需要经过 T+7 资金成熟期。",
    },
    {
      code: "UNKNOWN_RAW_BACKEND_ERROR",
      en: "Unable to prepare the withdrawal right now. Please retry in a moment.",
      zh: "暂时无法准备提现，请稍后重试。",
    },
  ];

  it.each(consumerWithdrawErrorCases)(
    "maps consumer withdrawal error code $code to English copy",
    async ({ code, en }) => {
      const user = userEvent.setup();
      requestConsumerWithdrawMock.mockRejectedValue(
        new ConsumerWithdrawApiError(
          "503: {'code': 'CHAIN_RPC_UNAVAILABLE', 'message': 'HTTPException'}",
          code,
          503
        )
      );

      renderWithdrawModal();

      const withdrawButtons = screen.getAllByRole("button", {
        name: /^withdraw$/i,
      });
      await user.click(withdrawButtons.at(-1)!);

      await waitFor(() => {
        expect(toastErrorMock).toHaveBeenCalledWith(en);
      });
      expect(toastErrorMock).not.toHaveBeenCalledWith(
        expect.stringContaining("503:")
      );
      expect(toastErrorMock).not.toHaveBeenCalledWith(
        expect.stringContaining("HTTPException")
      );
    }
  );

  it.each(consumerWithdrawErrorCases)(
    "maps consumer withdrawal error code $code to Chinese copy",
    async ({ code, zh }) => {
      const user = userEvent.setup();
      globalThis.localStorage.setItem(I18N_STORAGE_KEY, "zh");
      requestConsumerWithdrawMock.mockRejectedValue(
        new ConsumerWithdrawApiError(
          "503: {'code': 'CHAIN_RPC_UNAVAILABLE', 'message': 'HTTPException'}",
          code,
          503
        )
      );

      renderWithdrawModal();

      const withdrawButtons = screen.getAllByRole("button", {
        name: "提现",
      });
      await user.click(withdrawButtons.at(-1)!);

      await waitFor(() => {
        expect(toastErrorMock).toHaveBeenCalledWith(zh);
      });
      expect(toastErrorMock).not.toHaveBeenCalledWith(
        expect.stringContaining("503:")
      );
      expect(toastErrorMock).not.toHaveBeenCalledWith(
        expect.stringContaining("HTTPException")
      );
    }
  );

  it("does not call requestConsumerWithdraw when amount is zero", async () => {
    const user = userEvent.setup();

    renderWithdrawModal();

    const amountInput = screen.getByRole("spinbutton");
    await user.clear(amountInput);
    await user.type(amountInput, "0");

    const withdrawButtons = screen.getAllByRole("button", {
      name: /^withdraw$/i,
    });
    await user.click(withdrawButtons.at(-1)!);

    expect(requestConsumerWithdrawMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("Enter a valid amount.");
  });

  it("renders the withdrawal modal and validation toast in Chinese", async () => {
    const user = userEvent.setup();
    globalThis.localStorage.setItem(I18N_STORAGE_KEY, "zh");

    renderWithdrawModal();

    expect(screen.getByRole("heading", { name: "提现余额" })).toBeTruthy();
    expect(screen.getByText(/可取现金额：20\.00 USDC/)).toBeTruthy();
    expect(screen.getByText("金额 (USDC)")).toBeTruthy();
    expect(screen.getByText("原因（可选）")).toBeTruthy();
    expect(screen.getByPlaceholderText("为什么要提现？")).toBeTruthy();
    expect(screen.getByText(/每 24 小时最多 3 次提现/)).toBeTruthy();

    const amountInput = screen.getByRole("spinbutton");
    await user.clear(amountInput);
    await user.type(amountInput, "0");
    await user.click(screen.getAllByRole("button", { name: "提现" }).at(-1)!);

    expect(requestConsumerWithdrawMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("请输入有效金额。");
  });
});
