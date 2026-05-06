// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  toastSuccess,
  toastError,
  toastDefault,
  createDepositIntentMock,
  getDepositSyncStatusMock,
  recordDepositAttemptMock,
  refetchWalletBalanceMock,
  refetchAllowanceMock,
  refetchNativeBalanceMock,
  signTypedDataAsyncMock,
  writeContractAsyncMock,
  waitForTransactionReceiptMock,
  walletBalanceRawState,
  allowanceRawState,
  nativeBalanceRawState,
  tokenDecimalsState,
  receiptSuccessState,
  chainIdState,
} = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastDefault: vi.fn(),
  createDepositIntentMock: vi.fn(),
  getDepositSyncStatusMock: vi.fn(),
  recordDepositAttemptMock: vi.fn(),
  refetchWalletBalanceMock: vi.fn(),
  refetchAllowanceMock: vi.fn(),
  refetchNativeBalanceMock: vi.fn(),
  signTypedDataAsyncMock: vi.fn(),
  writeContractAsyncMock: vi.fn(),
  waitForTransactionReceiptMock: vi.fn(),
  walletBalanceRawState: { value: 20n * 10n ** 18n },
  allowanceRawState: { value: 0n },
  nativeBalanceRawState: { value: 10n ** 18n },
  tokenDecimalsState: { value: 18 },
  receiptSuccessState: { value: true },
  chainIdState: { value: 31337 },
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

vi.mock("@/utils/runtimeEnv", () => ({
  getRuntimeEnvironmentConfig: () => ({
    appEnv: "local",
    gatewayBaseUrl: "http://127.0.0.1:8000",
    docsBaseUrl: "http://localhost:3100",
    txExplorerBaseUrl: "http://localhost:5100",
    rpcUrl: "http://127.0.0.1:8545",
    chainId: 31337,
    chainName: "Hardhat Local",
  }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0x123400000000000000000000000000000000abcd",
    isConnected: true,
  }),
  useBalance: () => ({
    data: { value: nativeBalanceRawState.value, decimals: 18, symbol: "ETH" },
    refetch: refetchNativeBalanceMock,
  }),
  useChainId: () => chainIdState.value,
  useReadContract: ({ functionName }: { functionName: string }) => {
    if (functionName === "nonces") {
      return { data: 0n };
    }
    if (functionName === "decimals") {
      return { data: tokenDecimalsState.value };
    }
    if (functionName === "name") {
      return { data: "Synapse Test USDC" };
    }
    if (functionName === "symbol") {
      return { data: "USDC" };
    }
    if (functionName === "allowance") {
      return {
        data: allowanceRawState.value,
        refetch: refetchAllowanceMock,
      };
    }
    return {
      data: walletBalanceRawState.value,
      refetch: refetchWalletBalanceMock,
    };
  },
  usePublicClient: () => ({
    waitForTransactionReceipt: waitForTransactionReceiptMock,
  }),
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
    walletBalanceRawState.value = 20n * 10n ** 18n;
    allowanceRawState.value = 0n;
    nativeBalanceRawState.value = 10n ** 18n;
    tokenDecimalsState.value = 18;
    receiptSuccessState.value = true;
    chainIdState.value = 31337;
    delete (globalThis as typeof globalThis & { ethereum?: unknown }).ethereum;
    recordDepositAttemptMock.mockResolvedValue(undefined);
    refetchWalletBalanceMock.mockImplementation(async () => ({
      data: walletBalanceRawState.value,
    }));
    refetchNativeBalanceMock.mockImplementation(async () => ({
      data: { value: nativeBalanceRawState.value, decimals: 18, symbol: "ETH" },
    }));
    refetchAllowanceMock.mockImplementation(async () => ({
      data: allowanceRawState.value,
    }));
    signTypedDataAsyncMock.mockResolvedValue(
      `0x${"11".repeat(32)}${"22".repeat(32)}1b`
    );
    writeContractAsyncMock.mockResolvedValue(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    waitForTransactionReceiptMock.mockResolvedValue({ status: "success" });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as typeof globalThis & { ethereum?: unknown }).ethereum;
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

  it("blocks wallet prompts when deposit amount is below minimum", async () => {
    receiptSuccessState.value = false;

    const { result } = renderHook(() =>
      useVaultDeposit({ initialAmount: "9.99" })
    );

    await result.current.handleDeposit();

    expect(signTypedDataAsyncMock).not.toHaveBeenCalled();
    expect(writeContractAsyncMock).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Minimum deposit amount is 10.00 USDC."
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
    await waitFor(() => {
      expect(result.current.isReviewingDeposit).toBe(true);
    });
    await result.current.handleDeposit();

    expect(signTypedDataAsyncMock).toHaveBeenCalledTimes(1);
    expect(signTypedDataAsyncMock.mock.calls[0][0].domain.name).toBe(
      "Synapse Test USDC"
    );
    expect(signTypedDataAsyncMock.mock.calls[0][0].message.value).toBe(
      100000000n
    );
    await waitFor(() => {
      expect(writeContractAsyncMock).toHaveBeenCalledTimes(1);
    });
    expect(writeContractAsyncMock.mock.calls[0][0].args[0]).toBe(100000000n);
  });

  it("skips permit and approve when allowance already covers the amount", async () => {
    receiptSuccessState.value = false;
    allowanceRawState.value = 100n * 10n ** 18n;

    const { result } = renderHook(() =>
      useVaultDeposit({ initialAmount: "10" })
    );

    await result.current.handleDeposit();
    await waitFor(() => {
      expect(result.current.isReviewingDeposit).toBe(true);
    });
    await result.current.handleDeposit();

    expect(signTypedDataAsyncMock).not.toHaveBeenCalled();
    expect(writeContractAsyncMock).toHaveBeenCalledTimes(1);
    expect(writeContractAsyncMock.mock.calls[0][0].functionName).toBe(
      "deposit"
    );
  });

  it("uses approve fallback before deposit when selected", async () => {
    receiptSuccessState.value = false;

    const { result } = renderHook(() =>
      useVaultDeposit({ initialAmount: "10" })
    );

    await result.current.handleDeposit();
    await waitFor(() => {
      expect(result.current.isReviewingDeposit).toBe(true);
    });
    result.current.handleUseApproveFallback();
    await waitFor(() => {
      expect(result.current.depositFlowMode).toBe("approveFallback");
    });
    await result.current.handleDeposit();

    expect(signTypedDataAsyncMock).not.toHaveBeenCalled();
    expect(writeContractAsyncMock).toHaveBeenCalledTimes(2);
    expect(writeContractAsyncMock.mock.calls[0][0].functionName).toBe(
      "approve"
    );
    expect(writeContractAsyncMock.mock.calls[1][0].functionName).toBe(
      "deposit"
    );
    expect(waitForTransactionReceiptMock).toHaveBeenCalledTimes(1);
  });

  it("switches to the required network before opening review", async () => {
    chainIdState.value = 1;
    const request = vi.fn().mockResolvedValue(null);
    (globalThis as typeof globalThis & { ethereum?: unknown }).ethereum = {
      request,
    };

    const { result } = renderHook(() =>
      useVaultDeposit({ initialAmount: "10" })
    );

    await result.current.handleDeposit();

    expect(request).toHaveBeenCalledWith({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x7a69" }],
    });
    expect(result.current.isReviewingDeposit).toBe(false);
    expect(signTypedDataAsyncMock).not.toHaveBeenCalled();
  });

  it("adds the required network when wallet reports the chain is unknown", async () => {
    chainIdState.value = 1;
    const request = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("unknown chain"), { code: 4902 })
      )
      .mockResolvedValueOnce(null);
    (globalThis as typeof globalThis & { ethereum?: unknown }).ethereum = {
      request,
    };

    const { result } = renderHook(() =>
      useVaultDeposit({ initialAmount: "10" })
    );

    await result.current.handleDeposit();

    expect(request).toHaveBeenNthCalledWith(1, {
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x7a69" }],
    });
    expect(request.mock.calls[1][0].method).toBe("wallet_addEthereumChain");
    expect(request.mock.calls[1][0].params[0].chainName).toBe(
      "GoChain Testnet"
    );
  });

  it("shows a neutral pending-switch hint for duplicate switch requests", async () => {
    chainIdState.value = 1;
    const request = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("request already pending"), { code: -32002 })
      );
    (globalThis as typeof globalThis & { ethereum?: unknown }).ethereum = {
      request,
    };

    const { result } = renderHook(() =>
      useVaultDeposit({ initialAmount: "10" })
    );

    await result.current.handleDeposit();

    await waitFor(() => {
      expect(result.current.depositError).toBe(
        "Open your wallet extension to finish the network switch."
      );
    });
    expect(toastDefault).toHaveBeenCalledWith(
      "Open your wallet extension to finish the network switch.",
      { icon: "ℹ️" }
    );
  });

  it("blocks review when just-in-time balance refresh detects stale wallet data", async () => {
    receiptSuccessState.value = false;
    refetchWalletBalanceMock.mockResolvedValueOnce({
      data: 5n * 10n ** 18n,
    });

    const { result } = renderHook(() =>
      useVaultDeposit({ initialAmount: "10" })
    );

    await result.current.handleDeposit();

    expect(result.current.isReviewingDeposit).toBe(false);
    expect(toastError).toHaveBeenCalledWith(
      "Wallet balance changed. Please review the amount again."
    );
    expect(signTypedDataAsyncMock).not.toHaveBeenCalled();
    expect(writeContractAsyncMock).not.toHaveBeenCalled();
  });

  it("times out permit signing and unlocks approve fallback", async () => {
    vi.useFakeTimers();
    receiptSuccessState.value = false;
    signTypedDataAsyncMock.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() =>
      useVaultDeposit({ initialAmount: "10" })
    );

    await act(async () => {
      await result.current.handleDeposit();
    });
    expect(result.current.isReviewingDeposit).toBe(true);

    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = result.current.handleDeposit();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_001);
    });
    await pending;

    expect(result.current.depositStep).toBe("permit_timed_out");
    expect(result.current.depositFlowMode).toBe("approveFallback");
    expect(result.current.depositError).toBe(
      "Wallet did not respond. If you use a hardware wallet, try Approve transaction instead."
    );
    expect(writeContractAsyncMock).not.toHaveBeenCalled();
  });

  it("does not show a red error when the user rejects the wallet action", async () => {
    receiptSuccessState.value = false;
    signTypedDataAsyncMock.mockRejectedValue(
      Object.assign(new Error("User rejected"), { code: 4001 })
    );

    const { result } = renderHook(() =>
      useVaultDeposit({ initialAmount: "10" })
    );

    await result.current.handleDeposit();
    await waitFor(() => {
      expect(result.current.isReviewingDeposit).toBe(true);
    });
    await result.current.handleDeposit();

    expect(toastError).not.toHaveBeenCalledWith(
      expect.stringContaining("User")
    );
    expect(toastDefault).toHaveBeenCalledWith("Request cancelled", {
      icon: "ℹ️",
    });
  });
});
