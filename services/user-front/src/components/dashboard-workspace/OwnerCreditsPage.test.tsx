// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";

import OwnerCreditsPage from "@/components/dashboard-workspace/OwnerCreditsPage";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY } from "@/i18n/config";

const {
  authorizeMock,
  getOwnerSpendingLimitMock,
  redeemCreditVoucherMock,
  handleRefreshMock,
  openConnectModalMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  authorizeMock: vi.fn(async () => true),
  getOwnerSpendingLimitMock: vi.fn(),
  redeemCreditVoucherMock: vi.fn(),
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
    stats: {
      ownerBalance: "20",
    },
    handleRefresh: handleRefreshMock,
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
    redeemCreditVoucher: redeemCreditVoucherMock,
  };
});

describe("OwnerCreditsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    delete process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
    delete process.env.NEXT_PUBLIC_SUPPORT_PORTAL_URL;
    globalThis.localStorage.setItem(I18N_STORAGE_KEY, "en");
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
        platformFeeAccrued: 0,
      },
    });
  });

  it("opens the redeem voucher modal, formats voucher input, and redeems successfully", async () => {
    const user = userEvent.setup();

    render(
      createElement(LanguageProvider, null, createElement(OwnerCreditsPage))
    );

    expect(await screen.findByText("Remaining balance:")).toBeTruthy();
    expect(screen.getByText("$20.00")).toBeTruthy();
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

    expect((await screen.findAllByText("Need help with deposit or billing?")).length).toBeGreaterThan(0);
    const supportLink = screen.getByRole("link", { name: "Contact Support" });
    expect(supportLink.getAttribute("href")).toContain("mailto:support@synapse.test");
  });
});
