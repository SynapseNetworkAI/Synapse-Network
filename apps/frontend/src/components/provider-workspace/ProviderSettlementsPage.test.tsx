// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";

import ProviderSettlementsPage from "@/components/provider-workspace/ProviderSettlementsPage";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY } from "@/i18n/config";
import { ProviderWithdrawApiError } from "@/utils/providerWithdrawApi";

const {
  toastError,
  toastLoading,
  toastSuccess,
  createProviderWithdrawIntentMock,
  getProviderWithdrawCapabilityMock,
  listProviderWithdrawalsMock,
  completeProviderWithdrawalMock,
  reloadDashboardMock,
  readContractMock,
} = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastLoading: vi.fn(() => "toast-provider-withdraw"),
  toastSuccess: vi.fn(),
  createProviderWithdrawIntentMock: vi.fn(),
  getProviderWithdrawCapabilityMock: vi.fn(),
  listProviderWithdrawalsMock: vi.fn(),
  completeProviderWithdrawalMock: vi.fn(),
  reloadDashboardMock: vi.fn(),
  readContractMock: vi.fn(),
}));

vi.mock("react-hot-toast", () => ({
  default: {
    error: toastError,
    loading: toastLoading,
    success: toastSuccess,
  },
}));

vi.mock("@/hooks/useDashboardData", () => ({
  useDashboardData: () => ({
    providerStats: {
      totalApiCalls: 0,
      totalEarned: 0,
      totalFees: 0,
      totalRoutingTax: 0,
      netEarned: 0,
      receivable: 12,
      paidCount24h: 0,
      duplicateRowsDropped: 0,
    },
    paidEvents: [],
    handleRefresh: reloadDashboardMock,
  }),
}));

vi.mock("@rainbow-me/rainbowkit", () => ({
  useConnectModal: () => ({
    openConnectModal: vi.fn(),
  }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xabc", isConnected: true }),
  useBalance: () => ({ data: { value: 10n ** 18n, symbol: "ETH", decimals: 18 } }),
  useChainId: () => 31337,
  usePublicClient: () => ({
    readContract: readContractMock,
    getBalance: vi.fn(),
    estimateContractGas: vi.fn(),
    estimateFeesPerGas: vi.fn(),
  }),
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
  useWriteContract: () => ({
    data: undefined,
    writeContractAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/contract-config.json", () => ({
  default: {
    SynapseCore: "0x00000000000000000000000000000000000000aa",
    MockUSDC: "0x00000000000000000000000000000000000000bb",
  },
}));

vi.mock("@/utils/providerWithdrawApi", async () => {
  const actual = await vi.importActual<typeof import("@/utils/providerWithdrawApi")>(
    "@/utils/providerWithdrawApi",
  );
  return {
    ...actual,
    createProviderWithdrawIntent: createProviderWithdrawIntentMock,
    getProviderWithdrawCapability: getProviderWithdrawCapabilityMock,
    listProviderWithdrawals: listProviderWithdrawalsMock,
    completeProviderWithdrawal: completeProviderWithdrawalMock,
  };
});

describe("ProviderSettlementsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.localStorage.setItem(I18N_STORAGE_KEY, "zh");
    readContractMock.mockResolvedValue(20n * 10n ** 18n);
    getProviderWithdrawCapabilityMock.mockResolvedValue({
      ticketSigningEnabled: true,
      code: null,
      message: "ready",
      contractAddress: "0x00000000000000000000000000000000000000aa",
    });
    listProviderWithdrawalsMock.mockResolvedValue([]);
    completeProviderWithdrawalMock.mockResolvedValue(undefined);
    createProviderWithdrawIntentMock.mockRejectedValue(
      new ProviderWithdrawApiError(
        "Gateway cannot verify on-chain vault liquidity right now. Retry after the chain RPC reconnects.",
        "WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE",
        503,
      ),
    );
  });

  it("shows zh toast copy when withdraw intent returns vault liquidity check unavailable", async () => {
    const user = userEvent.setup();

    render(createElement(LanguageProvider, null, createElement(ProviderSettlementsPage)));

    await waitFor(() => {
      expect(getProviderWithdrawCapabilityMock).toHaveBeenCalledWith("0xabc");
    });

    const amountInput = await screen.findByPlaceholderText("提现金额（留空 = 全部 12.000000 USDC）");
    await user.type(amountInput, "8.5");

    const createButton = screen.getByRole("button", { name: "生成并提现" });
    await waitFor(() => {
      expect(createButton.disabled).toBe(false);
    });

    await user.click(createButton);

    await waitFor(() => {
      expect(createProviderWithdrawIntentMock).toHaveBeenCalledWith("0xabc", 8.5);
    });
    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "网关当前无法校验链上金库余额，请等待 RPC 恢复后再重试。",
        { id: "toast-provider-withdraw" },
      );
    });
  });
});