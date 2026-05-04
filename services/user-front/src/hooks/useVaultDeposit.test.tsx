// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  toastSuccess,
  toastError,
  toastDefault,
  createDepositIntentMock,
  getDepositSyncStatusMock,
  recordDepositAttemptMock,
  refetchWalletBalanceMock,
  signTypedDataAsyncMock,
  writeContractAsyncMock,
  walletBalanceRawState,
  nativeBalanceRawState,
  tokenDecimalsState,
  receiptSuccessState,
} = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastDefault: vi.fn(),
  createDepositIntentMock: vi.fn(),
  getDepositSyncStatusMock: vi.fn(),
  recordDepositAttemptMock: vi.fn(),
  refetchWalletBalanceMock: vi.fn(),
  signTypedDataAsyncMock: vi.fn(),
  writeContractAsyncMock: vi.fn(),
  walletBalanceRawState: { value: 20n * 10n ** 18n },
  nativeBalanceRawState: { value: 10n ** 18n },
  tokenDecimalsState: { value: 18 },
  receiptSuccessState: { value: true },
}));

vi.mock("react-hot-toast", () => ({
  default: Object.assign(toastDefault, {
    success: toastSuccess,
    error: toastError,
  }),
}));

vi.mock("@/components/WalletAuthGuard", () => ({
  useAuth: () => ({
    isSessionAuthenticated: true,
  }),
}));

vi.mock("@/contract-config.json", () => ({
  default: {
    SynapseCore: "0x00000000000000000000000000000000000000aa",
    MockUSDC: "0x00000000000000000000000000000000000000bb",
  },
}));

vi.mock("@/utils/balanceApi", () => ({
  createDepositIntent: createDepositIntentMock,
  getDepositSyncStatus: getDepositSyncStatusMock,
  recordDepositAttempt: recordDepositAttemptMock,
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0x123400000000000000000000000000000000abcd",
    isConnected: true,
  }),
  useBalance: () => ({
    data: { value: nativeBalanceRawState.value, decimals: 18, symbol: "ETH" },
  }),
  useChainId: () => 31337,
  useReadContract: ({ functionName }: { functionName: string }) => {
    if (functionName === "nonces") {
      return { data: 0n };
    }
    if (functionName === "decimals") {
      return { data: tokenDecimalsState.value };
    }
    return {
      data: walletBalanceRawState.value,
      refetch: refetchWalletBalanceMock,
    };
  },
  useSignTypedData: () => ({
    signTypedDataAsync: signTypedDataAsyncMock,
  }),
  useWriteContract: () => ({
    data: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    writeContractAsync: writeContractAsyncMock,
    isPending: false,
  }),
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    isSuccess: receiptSuccessState.value,
    isError: false,
    error: null,
  }),
}));

import { useVaultDeposit } from "@/hooks/useVaultDeposit";

describe("useVaultDeposit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createDepositIntentMock.mockResolvedValue({
      txHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "pending",
    });
    getDepositSyncStatusMock.mockResolvedValue({
      txHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      found: true,
      synced: true,
      status: "SYNCED",
      confirmed: true,
      canRefreshBalance: true,
    });
    recordDepositAttemptMock.mockResolvedValue(undefined);
    refetchWalletBalanceMock.mockResolvedValue(undefined);
    signTypedDataAsyncMock.mockResolvedValue(
      `0x${"11".repeat(32)}${"22".repeat(32)}1b`
    );
    writeContractAsyncMock.mockResolvedValue(
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    );
    walletBalanceRawState.value = 20n * 10n ** 18n;
    nativeBalanceRawState.value = 10n ** 18n;
    tokenDecimalsState.value = 18;
    receiptSuccessState.value = true;
  });

  it("processes a confirmed deposit hash only once across rerenders", async () => {
    const onDepositSyncedA = vi.fn().mockResolvedValue(undefined);
    const onDepositSyncedB = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ onDepositSynced }: { onDepositSynced: () => Promise<void> }) =>
        useVaultDeposit({ initialAmount: "10", onDepositSynced }),
      {
        initialProps: { onDepositSynced: onDepositSyncedA },
      }
    );

    await waitFor(() => {
      expect(createDepositIntentMock).toHaveBeenCalledTimes(1);
    });

    rerender({ onDepositSynced: onDepositSyncedB });

    await waitFor(() => {
      expect(createDepositIntentMock).toHaveBeenCalledTimes(1);
      expect(getDepositSyncStatusMock).toHaveBeenCalledTimes(1);
      expect(onDepositSyncedA).toHaveBeenCalledTimes(1);
    });

    expect(onDepositSyncedB).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledTimes(2);
    expect(toastSuccess).toHaveBeenNthCalledWith(
      1,
      "Deposit confirmed on-chain. Syncing gateway balance..."
    );
    expect(toastSuccess).toHaveBeenNthCalledWith(2, "Gateway balance synced.");
  });

  it("blocks wallet prompts when wallet USDC is insufficient", async () => {
    receiptSuccessState.value = false;
    walletBalanceRawState.value = 80n * 10n ** 18n;

    const { result } = renderHook(() =>
      useVaultDeposit({ initialAmount: "100" })
    );

    await result.current.handleDeposit();

    expect(signTypedDataAsyncMock).not.toHaveBeenCalled();
    expect(writeContractAsyncMock).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Insufficient wallet USDC. Need 100 USDC, wallet has 80.00 USDC."
    );
  });

  it("blocks wallet prompts when native gas is insufficient", async () => {
    receiptSuccessState.value = false;
    nativeBalanceRawState.value = 0n;

    const { result } = renderHook(() =>
      useVaultDeposit({ initialAmount: "10" })
    );

    await result.current.handleDeposit();

    expect(signTypedDataAsyncMock).not.toHaveBeenCalled();
    expect(writeContractAsyncMock).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Deposit requires native gas for the vault transaction. Keep at least 0.001 ETH in this wallet."
    );
  });

  it("uses token decimals for permit and deposit amounts", async () => {
    receiptSuccessState.value = false;
    tokenDecimalsState.value = 6;
    walletBalanceRawState.value = 200n * 10n ** 6n;

    const { result } = renderHook(() =>
      useVaultDeposit({ initialAmount: "100" })
    );

    await result.current.handleDeposit();

    expect(signTypedDataAsyncMock).toHaveBeenCalledTimes(1);
    expect(signTypedDataAsyncMock.mock.calls[0][0].message.value).toBe(
      100000000n
    );
    await waitFor(() => {
      expect(writeContractAsyncMock).toHaveBeenCalledTimes(1);
    });
    expect(writeContractAsyncMock.mock.calls[0][0].args[0]).toBe(100000000n);
  });
});
