// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";

import OwnerCreditsPage from "@/components/dashboard-workspace/OwnerCreditsPage";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY } from "@/i18n/config";
import { renderWithLanguage } from "@/test/renderWithLanguage";

const {
  authorizeMock,
  getOwnerSpendingLimitMock,
  listConsumerWithdrawalsMock,
  redeemCreditVoucherMock,
  ownerStatsState,
  handleRefreshMock,
  openConnectModalMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  authorizeMock: vi.fn(async () => true),
  getOwnerSpendingLimitMock: vi.fn(),
  listConsumerWithdrawalsMock: vi.fn(),
  redeemCreditVoucherMock: vi.fn(),
  ownerStatsState: {
    value: {
      ownerBalance: "20",
      consumerAvailableBalance: "20",
      consumerWithdrawableBalance: "7.50",
      consumerPendingBalance: "12.50",
      consumerFrozenBalance: "3.25",
      consumerWithdrawMinUsdc: "10.00",
      consumerWithdrawMaturitySeconds: 604800,
    },
  },
  handleRefreshMock: vi.fn(),
  openConnectModalMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@rainbow-me/rainbowkit", () => ({
  useConnectModal: () => ({
    openConnectModal: openConnectModalMock,
  }),
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
    stats: ownerStatsState.value,
    handleRefresh: handleRefreshMock,
    isBootstrapping: false,
  }),
}));

vi.mock("@/hooks/useVaultDeposit", () => ({
  useVaultDeposit: () => ({
    isOpen: false,
    openModal: vi.fn(),
    closeModal: vi.fn(),
    depositAmount: "20",
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
    redeemCreditVoucher: redeemCreditVoucherMock,
  };
});

describe("OwnerCreditsPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    delete process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
    delete process.env.NEXT_PUBLIC_SUPPORT_PORTAL_URL;
    globalThis.localStorage.setItem(I18N_STORAGE_KEY, "en");
    ownerStatsState.value = {
      ownerBalance: "20",
      consumerAvailableBalance: "20",
      consumerWithdrawableBalance: "7.50",
      consumerPendingBalance: "12.50",
      consumerFrozenBalance: "3.25",
      consumerWithdrawMinUsdc: "10.00",
      consumerWithdrawMaturitySeconds: 604800,
    };
    listConsumerWithdrawalsMock.mockResolvedValue([]);
    getOwnerSpendingLimitMock.mockResolvedValue({
      ownerAddress: "0xabc",
      spendingLimitUsdc: null,
      allowUnlimited: true,
      cycleInterval: "monthly",
      currentCycleSpendUsdc: 0,
      remainingSpendUsdc: null,
      updatedAt: null,
    });
    redeemCreditVoucherMock.mockResolvedValue({
      redemption: {
        redemptionId: "vrd-1",
        voucherCodeId: "vc-1",
        campaignId: "camp-1",
        campaignCode: "APRIL26",
        campaignDisplayName: "April Credits",
        voucherCodeLast4: "EFGH",
        grantedAmountUsdc: 15,
        ownerAddress: "0xabc",
        ledgerEntryId: "ledger-1",
        targetAccountId: "consumer_wallet::0xabc",
        promoAccountId: "platform_promo::camp-1",
        status: "COMPLETED",
        beforeBalanceUsdc: 20,
        afterBalanceUsdc: 35,
        redeemedAt: "2026-04-02 10:00:00",
      },
      balance: {
        ownerBalance: 35,
        providerReceivable: 0,
        consumerAvailableBalance: 35,
        consumerWithdrawableBalance: 35,
        consumerPendingBalance: 0,
        consumerFrozenBalance: 0,
        consumerWithdrawMinUsdc: 10,
        consumerWithdrawMaturitySeconds: 604800,
        platformFeeAccrued: 0,
      },
    });
  });

  it("opens the redeem voucher modal, formats voucher input, and redeems successfully", async () => {
    const user = userEvent.setup();

    render(
      createElement(LanguageProvider, null, createElement(OwnerCreditsPage))
    );

    expect(await screen.findByText("Spendable credits")).toBeTruthy();
    expect(screen.getAllByText("$20.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("Withdrawable credits")).toBeNull();
    expect(screen.queryByText("$7.50")).toBeNull();
    expect(screen.getByText("Pending deposit credits")).toBeTruthy();
    expect(screen.getByText("$12.50")).toBeTruthy();
    expect(screen.getByText("Frozen / review credits")).toBeTruthy();
    expect(screen.getByText("$3.25")).toBeTruthy();
    expect(
      screen.getByText(/SynapseNetwork may give out free credits/i)
    ).toBeTruthy();
    const oldVoucherCopy = ["X may", "give out free credits"].join(" ");
    expect(screen.queryByText(new RegExp(oldVoucherCopy, "i"))).toBeNull();
    expect(
      screen.getByRole("button", { name: "Purchase credits" })
    ).toBeTruthy();

    await waitFor(() => {
      expect(getOwnerSpendingLimitMock).toHaveBeenCalledWith("0xabc");
    });

    await user.click(screen.getByRole("button", { name: "Redeem Voucher" }));

    expect(
      await screen.findByRole("heading", { name: "Redeem Voucher Code" })
    ).toBeTruthy();

    const input = screen.getByRole("textbox", { name: "Redeem Voucher" });
    await user.type(input, "abcd1234efgh");

    expect((input as HTMLInputElement).value).toBe("ABCD-1234-EFGH");

    const redeemButtons = screen.getAllByRole("button", {
      name: "Redeem Voucher",
    });
    await user.click(redeemButtons[redeemButtons.length - 1]);

    await waitFor(() => {
      expect(redeemCreditVoucherMock).toHaveBeenCalledWith(
        "0xabc",
        "ABCD-1234-EFGH"
      );
    });
    await waitFor(() => {
      expect(handleRefreshMock).toHaveBeenCalled();
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Voucher redeemed. $15.00 was added to your balance."
    );
  });

  it("shows a support contact entry when support email is configured", async () => {
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL = "support@synapse.test";

    render(
      createElement(LanguageProvider, null, createElement(OwnerCreditsPage))
    );

    expect(
      (await screen.findAllByText("Need help with deposit or billing?")).length
    ).toBeGreaterThan(0);
    const supportLink = screen.getByRole("link", { name: "Contact Support" });
    expect(supportLink.getAttribute("href")).toContain(
      "mailto:support@synapse.test"
    );
  });

  it("renders the credits surface in Chinese without stale platform copy", async () => {
    renderWithLanguage(createElement(OwnerCreditsPage), "zh");

    expect(await screen.findByText("可消费 credits")).toBeTruthy();
    expect(screen.getByText("$20.00")).toBeTruthy();
    expect(screen.queryByText("可取现 credits")).toBeNull();
    expect(screen.queryByText("$7.50")).toBeNull();
    expect(screen.getByText("同步中的充值 credits")).toBeTruthy();
    expect(screen.getByText("$12.50")).toBeTruthy();
    expect(screen.getByText("冻结 / 审核中的 credits")).toBeTruthy();
    expect(screen.getByRole("button", { name: "购买 credits" })).toBeTruthy();
    expect(screen.getByText("免费 Credits Voucher")).toBeTruthy();
    expect(screen.getByText(/平台可能会向开发者发放免费 credits/)).toBeTruthy();
    expect(screen.queryByText(/X may give out free credits/)).toBeNull();
  });

  it("does not render withdrawal processing as a credits-page bucket", async () => {
    ownerStatsState.value = {
      ...ownerStatsState.value,
      ownerBalance: "0",
      consumerPendingBalance: "185.99",
      consumerFrozenBalance: "0",
    };
    listConsumerWithdrawalsMock.mockResolvedValue([
      {
        id: "cw-1",
        amountUsdc: "185.99",
        status: "REQUESTED",
        claimable: true,
        ticket: {
          ticketId:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          amount: "185990000000000000000",
          fee: "1000000000000000000",
          deadline: 1800000000,
          signature: "0xsigned",
          chainId: 31337,
          contractAddress: "0x00000000000000000000000000000000000000aa",
        },
      },
    ]);

    render(
      createElement(LanguageProvider, null, createElement(OwnerCreditsPage))
    );

    await screen.findByText("Spendable credits");
    expect(
      screen.queryByText("Need to withdraw? Go to Account Withdraw")
    ).toBeNull();
    expect(screen.queryByText("Claimable withdrawal credits")).toBeNull();
    expect(screen.queryByText("Withdrawal processing credits")).toBeNull();
    expect(screen.queryByText("Pending deposit credits")).toBeNull();
    expect(
      screen.queryByText(/Gateway is indexing the on-chain deposit/i)
    ).toBeNull();
  });

  it("keeps mixed pending display focused on deposit sync only", async () => {
    ownerStatsState.value = {
      ...ownerStatsState.value,
      ownerBalance: "2",
      consumerPendingBalance: "20",
      consumerFrozenBalance: "0",
    };
    listConsumerWithdrawalsMock.mockResolvedValue([
      {
        id: "cw-1",
        amountUsdc: "8.50",
        status: "TICKET_READY",
        claimable: true,
        ticket: {
          ticketId:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          amount: "8500000000000000000",
          fee: "1000000000000000000",
          deadline: 1800000000,
          signature: "0xsigned",
          chainId: 31337,
          contractAddress: "0x00000000000000000000000000000000000000aa",
        },
      },
    ]);

    render(
      createElement(LanguageProvider, null, createElement(OwnerCreditsPage))
    );

    expect(await screen.findByText("Pending deposit credits")).toBeTruthy();
    expect(screen.getByText("$11.50")).toBeTruthy();
    expect(screen.queryByText("Claimable withdrawal credits")).toBeNull();
    expect(screen.queryByText("Withdrawal processing credits")).toBeNull();
  });

  it("keeps manual review withdrawal funds in the frozen bucket", async () => {
    ownerStatsState.value = {
      ...ownerStatsState.value,
      ownerBalance: "2",
      consumerPendingBalance: "0",
      consumerFrozenBalance: "12.50",
    };
    listConsumerWithdrawalsMock.mockResolvedValue([
      {
        id: "cw-1",
        amountUsdc: "12.50",
        status: "PENDING_MANUAL_REVIEW",
      },
    ]);

    render(
      createElement(LanguageProvider, null, createElement(OwnerCreditsPage))
    );

    expect(await screen.findByText("Frozen / review credits")).toBeTruthy();
    expect(screen.getByText("$12.50")).toBeTruthy();
    expect(screen.queryByText("Withdrawal processing credits")).toBeNull();
    expect(screen.queryByText("Pending deposit credits")).toBeNull();
  });

  it("keeps approved withdrawals out of the credits-page primary actions", async () => {
    ownerStatsState.value = {
      ...ownerStatsState.value,
      ownerBalance: "249",
      consumerPendingBalance: "501",
      consumerFrozenBalance: "0",
    };
    listConsumerWithdrawalsMock.mockResolvedValue([
      {
        id: "cw-claim-1",
        amountUsdc: "501.00",
        status: "REQUESTED",
        claimable: true,
        ticket: {
          ticketId:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          amount: "501000000000000000000",
          fee: "1000000000000000000",
          deadline: 1800000000,
          signature: "0xsigned",
          chainId: 31337,
          contractAddress: "0x00000000000000000000000000000000000000aa",
        },
      },
    ]);

    render(
      createElement(LanguageProvider, null, createElement(OwnerCreditsPage))
    );

    await screen.findByText("Spendable credits");
    expect(
      screen.queryByText("Need to withdraw? Go to Account Withdraw")
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Claim now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
  });
});
