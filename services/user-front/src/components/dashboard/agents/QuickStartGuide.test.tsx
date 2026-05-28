// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";

import QuickStartGuide from "@/components/dashboard/agents/QuickStartGuide";
import { renderWithLanguage } from "@/test/renderWithLanguage";

const { toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("react-hot-toast", () => ({
  default: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0x0000000000000000000000000000000000000001",
    isConnected: true,
  }),
  useChainId: () => 31337,
  useReadContract: ({ functionName }: { functionName?: string } = {}) => ({
    data:
      functionName === "decimals"
        ? 18
        : functionName === "name"
          ? "MockUSDC"
          : 100n * 10n ** 18n,
    refetch: vi.fn(),
  }),
  useSignTypedData: () => ({
    signTypedDataAsync: vi.fn(),
  }),
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    isSuccess: false,
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

vi.mock("@/utils/balanceApi", () => ({
  createDepositIntent: vi.fn(),
}));

describe("QuickStartGuide i18n", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the quick-start flow in English", () => {
    renderWithLanguage(createElement(QuickStartGuide), "en");

    expect(
      screen.getByRole("region", { name: "Agent quick start" }),
    ).toBeTruthy();
    expect(screen.getByText("Deposit")).toBeTruthy();
    expect(screen.getByText("Create Agent")).toBeTruthy();
    expect(screen.getByText("Discover Services")).toBeTruthy();
    expect(screen.getByText("Step 1: Deposit USDC")).toBeTruthy();
    expect(screen.queryByText("Agent 快速开始")).toBeNull();
  });

  it("renders Chinese copy and validation messages in the deposit modal", async () => {
    const user = userEvent.setup();
    renderWithLanguage(createElement(QuickStartGuide), "zh");

    expect(screen.getByRole("region", { name: "Agent 快速开始" })).toBeTruthy();
    expect(screen.getByText("充值")).toBeTruthy();
    expect(screen.getByText("Step 1：充值 USDC")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /立即充值 USDC/ }));

    expect(screen.getByRole("heading", { name: "充值 USDC" })).toBeTruthy();
    const amountInput = screen.getByLabelText(
      "金额 (USDC)",
    ) as HTMLInputElement;
    await user.clear(amountInput);
    await user.type(amountInput, "0");
    await user.click(screen.getAllByRole("button", { name: "充值" }).at(-1)!);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "请输入有效的充值金额。",
    );
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
