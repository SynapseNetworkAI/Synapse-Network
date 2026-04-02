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
} = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastDefault: vi.fn(),
  createDepositIntentMock: vi.fn(),
  getDepositSyncStatusMock: vi.fn(),
  recordDepositAttemptMock: vi.fn(),
  refetchWalletBalanceMock: vi.fn(),
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
    data: { value: 10n ** 18n },
  }),
  useChainId: () => 31337,
  useReadContract: ({ functionName }: { functionName: string }) => {
    if (functionName === "nonces") {
      return { data: 0n };
    }
    return { data: 20n * 10n ** 18n, refetch: refetchWalletBalanceMock };
  },
  useSignTypedData: () => ({
    signTypedDataAsync: vi.fn(),
  }),
  useWriteContract: () => ({
    data: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    writeContractAsync: vi.fn(),
    isPending: false,
  }),
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    isSuccess: true,
    isError: false,
    error: null,
  }),
}));

import { useVaultDeposit } from "@/hooks/useVaultDeposit";

describe("useVaultDeposit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createDepositIntentMock.mockResolvedValue({
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "pending",
    });
    getDepositSyncStatusMock.mockResolvedValue({
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      found: true,
      synced: true,
      status: "SYNCED",
      confirmed: true,
      canRefreshBalance: true,
    });
    recordDepositAttemptMock.mockResolvedValue(undefined);
    refetchWalletBalanceMock.mockResolvedValue(undefined);
  });

  it("processes a confirmed deposit hash only once across rerenders", async () => {
    const onDepositSyncedA = vi.fn().mockResolvedValue(undefined);
    const onDepositSyncedB = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ onDepositSynced }: { onDepositSynced: () => Promise<void> }) =>
        useVaultDeposit({ initialAmount: "10", onDepositSynced }),
      {
        initialProps: { onDepositSynced: onDepositSyncedA },
      },
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
    expect(toastSuccess).toHaveBeenNthCalledWith(1, "Deposit confirmed on-chain. Syncing gateway balance...");
    expect(toastSuccess).toHaveBeenNthCalledWith(2, "Gateway balance synced.");
  });
});